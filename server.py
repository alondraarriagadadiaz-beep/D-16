import argparse
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import sqlite3
import time
import unicodedata
from contextlib import contextmanager
from http.cookies import CookieError, SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parent
DATABASE = Path(os.environ.get("SCHOOL_DB_PATH", str(ROOT / "data" / "school.db")))
SESSION_COOKIE = "school_session"
SESSION_LIFETIME = 12 * 60 * 60
STAFF_REGISTRATION_KEY = os.environ.get("STAFF_REGISTRATION_KEY", "")


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


@contextmanager
def database():
    DATABASE.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def initialize_database():
    with database() as connection:
        users_exist = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'"
        ).fetchone()
        if users_exist:
            columns = {
                row["name"] for row in connection.execute("PRAGMA table_info(users)")
            }
            if {"password_salt", "password_hash"} & columns:
                connection.execute("DROP TABLE IF EXISTS sessions")
                connection.execute(
                    """
                    CREATE TABLE users_without_password (
                        id INTEGER PRIMARY KEY,
                        username TEXT NOT NULL,
                        username_normalized TEXT NOT NULL UNIQUE,
                        full_name TEXT NOT NULL,
                        role TEXT NOT NULL CHECK (role IN ('guardian', 'teacher', 'library')),
                        student_name TEXT,
                        grade TEXT,
                        created_at INTEGER NOT NULL
                    )
                    """
                )
                connection.execute(
                    """
                    INSERT INTO users_without_password(
                        id, username, username_normalized, full_name, role,
                        student_name, grade, created_at
                    )
                    SELECT id, username, username_normalized, full_name, role,
                           student_name, grade, created_at
                    FROM users
                    """
                )
                connection.execute("DROP TABLE users")
                connection.execute(
                    "ALTER TABLE users_without_password RENAME TO users"
                )

        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY,
                username TEXT NOT NULL,
                username_normalized TEXT NOT NULL UNIQUE,
                full_name TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('guardian', 'teacher', 'library')),
                student_name TEXT,
                grade TEXT,
                created_at INTEGER NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at INTEGER NOT NULL
            )
            """
        )
        connection.execute("CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at)")


def normalize(value):
    return unicodedata.normalize("NFKC", value).strip().casefold()


def required_text(value, label, maximum=120):
    if not isinstance(value, str):
        raise ApiError(400, "Completa el campo " + label + ".")
    value = value.strip()
    if not value or len(value) > maximum:
        raise ApiError(400, "El campo " + label + " no es válido.")
    return value


def public_user(row):
    return {
        "id": row["username_normalized"],
        "username": row["username"],
        "name": row["full_name"],
        "role": row["role"],
        "student": row["student_name"],
        "grade": row["grade"],
    }


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    static_files = {"index.html", "app.js", "styles.css", "logo-escuela.jpg"}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def translate_path(self, path):
        requested = urlsplit(path).path.lstrip("/")
        if requested in ("", "index.html"):
            return str(ROOT / "index.html")
        if requested in self.static_files:
            return str(ROOT / requested)
        return str(ROOT / "__not_found__")

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        super().end_headers()

    def send_json(self, status, payload, cookie=None):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if cookie is not None:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise ApiError(400, "La solicitud no tiene un tamaño válido.") from error
        if length <= 0 or length > 1024 * 1024:
            raise ApiError(400, "El cuerpo de la solicitud no es válido.")
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ApiError(400, "El contenido enviado no es JSON válido.") from error
        if not isinstance(payload, dict):
            raise ApiError(400, "El contenido enviado no es válido.")
        return payload

    def current_user(self):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except CookieError:
            return None
        morsel = cookie.get(SESSION_COOKIE)
        if morsel is None:
            return None
        token_hash = hashlib.sha256(morsel.value.encode("utf-8")).hexdigest()
        now = int(time.time())
        with database() as connection:
            row = connection.execute(
                """
                SELECT users.*
                FROM sessions JOIN users ON users.id = sessions.user_id
                WHERE sessions.token_hash = ? AND sessions.expires_at > ?
                """,
                (token_hash, now),
            ).fetchone()
            connection.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))
        return public_user(row) if row else None

    def create_session(self, connection, user_id):
        token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        expires_at = int(time.time()) + SESSION_LIFETIME
        connection.execute(
            "INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)",
            (token_hash, user_id, expires_at),
        )
        return token

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/api/auth/session":
            self.send_json(200, {"user": self.current_user()})
            return
        return super().do_GET()

    def do_POST(self):
        path = urlsplit(self.path).path
        try:
            payload = self.read_json()
            if path == "/api/auth/register":
                self.register(payload)
            elif path == "/api/auth/login":
                self.login(payload)
            elif path == "/api/auth/logout":
                self.logout()
            elif path == "/api/guardians/lookup":
                self.guardian_lookup(payload)
            else:
                self.send_json(404, {"error": "No se encontró el servicio solicitado."})
        except ApiError as error:
            self.send_json(error.status, {"error": error.message})
        except sqlite3.IntegrityError:
            self.send_json(409, {"error": "Ese nombre de usuario o RUT ya está registrado."})
        except sqlite3.Error:
            logging.exception("Fallo de base de datos")
            self.send_json(500, {"error": "No se pudo completar la operación en la base de datos."})

    def register(self, payload):
        role = payload.get("role")
        if role not in ("guardian", "teacher"):
            raise ApiError(400, "Selecciona Apoderado o Docente.")

        username = required_text(payload.get("username"), "usuario o RUT", 64)
        if not re.fullmatch(r"[A-Za-z0-9._-]{3,64}", username):
            raise ApiError(400, "El usuario o RUT solo puede incluir letras, números, punto y guion.")
        full_name = required_text(payload.get("fullName"), "nombre", 120)

        student_name = None
        grade = None
        stored_role = "guardian"
        if role == "guardian":
            student_name = required_text(payload.get("studentName"), "nombre del alumno", 120)
            grade = required_text(payload.get("grade"), "curso", 80)
        else:
            if not STAFF_REGISTRATION_KEY:
                raise ApiError(503, "El registro de personal no está habilitado en el servidor.")
            submitted_key = payload.get("staffKey")
            if not isinstance(submitted_key, str) or not hmac.compare_digest(
                submitted_key, STAFF_REGISTRATION_KEY
            ):
                raise ApiError(403, "La clave de registro de personal no es correcta.")
            area = payload.get("area")
            if area == "teaching":
                stored_role = "teacher"
                grade = required_text(payload.get("grade"), "curso a cargo", 80)
            elif area == "library":
                stored_role = "library"
            else:
                raise ApiError(400, "Selecciona Docencia o Biblioteca.")

        with database() as connection:
            connection.execute(
                """
                INSERT INTO users(
                    username, username_normalized, full_name, role,
                    student_name, grade, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    username,
                    normalize(username),
                    full_name,
                    stored_role,
                    student_name,
                    grade,
                    int(time.time()),
                ),
            )
            row = connection.execute(
                "SELECT * FROM users WHERE username_normalized = ?",
                (normalize(username),),
            ).fetchone()
            token = self.create_session(connection, row["id"])
        self.send_json(
            201,
            {"user": public_user(row)},
            cookie=(
                SESSION_COOKIE + "=" + token +
                "; Path=/; HttpOnly; SameSite=Strict; Max-Age=" + str(SESSION_LIFETIME)
            ),
        )

    def login(self, payload):
        username = required_text(payload.get("username"), "usuario o RUT", 64)
        with database() as connection:
            row = connection.execute(
                "SELECT * FROM users WHERE username_normalized = ?",
                (normalize(username),),
            ).fetchone()
            if row is None:
                raise ApiError(401, "No encontramos ese usuario o RUT.")
            token = self.create_session(connection, row["id"])
        self.send_json(
            200,
            {"user": public_user(row)},
            cookie=(
                SESSION_COOKIE + "=" + token +
                "; Path=/; HttpOnly; SameSite=Strict; Max-Age=" + str(SESSION_LIFETIME)
            ),
        )

    def logout(self):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except CookieError:
            cookie = SimpleCookie()
        morsel = cookie.get(SESSION_COOKIE)
        if morsel is not None:
            token_hash = hashlib.sha256(morsel.value.encode("utf-8")).hexdigest()
            with database() as connection:
                connection.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
        self.send_json(
            200,
            {"ok": True},
            cookie=SESSION_COOKIE + "=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
        )

    def guardian_lookup(self, payload):
        current = self.current_user()
        if current is None or current["role"] != "library":
            raise ApiError(403, "Solo Biblioteca puede consultar apoderados para los préstamos.")
        student_name = required_text(payload.get("studentName"), "nombre del alumno", 120)
        with database() as connection:
            rows = connection.execute(
                """
                SELECT * FROM users
                WHERE role = 'guardian' AND student_name IS NOT NULL
                """
            ).fetchall()
        matches = [row for row in rows if normalize(row["student_name"]) == normalize(student_name)]
        if len(matches) > 1:
            raise ApiError(409, "Hay más de un apoderado para ese alumno; revisa los datos registrados.")
        self.send_json(
            200,
            {"guardian": public_user(matches[0]) if matches else None},
        )

    def log_message(self, format_string, *args):
        message = format_string % args
        if "/api/" not in message:
            super().log_message("%s", message)


def main():
    parser = argparse.ArgumentParser(description="Servidor local de la Plataforma Escolar")
    parser.add_argument("--host", default="127.0.0.1", help="Interfaz local (por defecto 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8000, help="Puerto HTTP (por defecto 8000)")
    args = parser.parse_args()
    if not STAFF_REGISTRATION_KEY:
        raise SystemExit(
            "Falta STAFF_REGISTRATION_KEY. Inicia el servidor con start.ps1 para definirla."
        )
    initialize_database()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print("Plataforma disponible en http://127.0.0.1:" + str(args.port))
    print("Base de usuarios SQLite: " + str(DATABASE))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor detenido.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
