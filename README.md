# Plataforma Escolar D-16

## Iniciar en el computador del colegio

Se requiere Python 3.10 o posterior. En PowerShell, abre esta carpeta y ejecuta:

```powershell
.\start.ps1
```

Al iniciar, escribe la clave compartida que entregarás solamente a docentes y a la persona de Biblioteca. Mantén la misma clave cada vez que reinicies el servidor. La clave no se guarda en el código ni en la base de datos.

Abre `http://127.0.0.1:8000` en el navegador. Cierra el servidor con `Ctrl+C`.

## Registro de cuentas

- **Apoderado:** crea usuario, nombre del alumno y curso; inicia sesión solo con su usuario.
- **Docente:** selecciona el área Docencia, ingresa la clave compartida y su curso.
- **Biblioteca:** selecciona el área Biblioteca e ingresa la misma clave compartida. Su cuenta obtiene acceso únicamente a Gestión de Biblioteca.

La clave compartida se pide solo al crear cuentas de Docente o Biblioteca, no al iniciar sesión. El inicio de sesión usa únicamente el nombre de usuario o RUT. Esto es menos seguro: cualquier persona que conozca un usuario registrado podría ingresar con esa cuenta; la clave compartida solo limita quién puede crear cuentas de personal. Las sesiones usan una cookie `HttpOnly`.

## Almacenamiento y alcance

Las cuentas se guardan en `data\school.db` (SQLite). Conserva una copia de ese archivo para respaldar las cuentas; no lo compartas públicamente.

Los préstamos y comunicados de esta versión todavía se guardan en el almacenamiento local del navegador, no en SQLite. El servidor escucha solo en `127.0.0.1`; para usar la plataforma desde otros equipos hace falta desplegarla en un servidor con HTTPS.

En Biblioteca, la columna Acción muestra el aviso junto a cada préstamo activo: queda deshabilitado hasta que venza el plazo y se habilita para préstamos atrasados con apoderado vinculado. El aviso aparece en Comunicados para ese apoderado y para docentes asociados al mismo curso.
