(function () {
  "use strict";

  const STORAGE_KEY = "colegio-el-porvenir-data-v1";
  const NAV_ITEMS = [
    { id: "bus", label: "🗺️ Rastreo de Bus", roles: ["guardian"] },
    { id: "teacher-loans", label: "📚 Libros prestados de 4to A", roles: ["teacher"] },
    { id: "notices", label: "📢 Portal de Comunicados", roles: ["guardian", "teacher"] },
    { id: "library", label: "📚 Gestión de Biblioteca", roles: ["library"] }
  ];
  const DEFAULT_DATA = {
    loans: [
      { id: "loan-quijote", book: "El Quijote", student: "Juan Pérez", grade: "4to A", guardianId: "juan.perez", due: "Esta semana", status: "Prestado" },
      { id: "loan-ciencias", book: "Ciencias Naturales 2", student: "Sofía Rojas", grade: "2do Básico", guardianId: "ana.rojas", due: "30 nov 2026", status: "Prestado" }
    ],
    notices: [
      { id: "notice-general", title: "Reunión de apoderados", message: "Les invitamos a la reunión de apoderados este jueves a las 18:00 horas.", date: "20 nov 2026", targetUserId: null, targetLabel: "Todos los apoderados" }
    ]
  };
  const state = { user: null, activeTab: null, selectedLoanId: null, toastTimer: null };
  const loginScreen = document.getElementById("login-screen");
  const appScreen = document.getElementById("app-screen");
  const nav = document.getElementById("main-nav");
  const content = document.getElementById("content");

  async function apiRequest(path, payload) {
    const options = { credentials: "same-origin" };
    if (payload !== undefined) {
      options.method = "POST";
      options.headers = { "Content-Type": "application/json" };
      options.body = JSON.stringify(payload);
    }
    const response = await fetch(path, options);
    let result;
    try {
      result = await response.json();
    } catch (error) {
      throw new Error("El servidor devolvió una respuesta inválida.", { cause: error });
    }
    if (!response.ok) throw new Error(result.error || "No se pudo completar la solicitud.");
    return result;
  }

  function readData() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_DATA));
      return JSON.parse(JSON.stringify(DEFAULT_DATA));
    }
    try {
      const data = JSON.parse(stored);
      if (!data || !Array.isArray(data.loans) || !Array.isArray(data.notices)) {
        throw new Error("La estructura de datos guardada no es válida.");
      }
      return data;
    } catch (error) {
      throw new Error("No se pudieron leer los datos locales de la plataforma.", { cause: error });
    }
  }

  function saveData(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      throw new Error("No se pudieron guardar los cambios en el almacenamiento local.", { cause: error });
    }
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
    });
  }

  function getNoticeTimestamp(notice) {
    if (Number.isFinite(notice.createdAt)) return notice.createdAt;
    const normalizedDate = String(notice.date || "").toLocaleLowerCase("es")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const match = normalizedDate.match(/^(\d{1,2})\s+(?:de\s+)?([a-z.]+)\s+(?:de\s+)?(\d{4})$/);
    if (!match) return 0;
    const months = {
      ene: 0, enero: 0, feb: 1, febrero: 1, mar: 2, marzo: 2, abr: 3, abril: 3,
      may: 4, mayo: 4, jun: 5, junio: 5, jul: 6, julio: 6, ago: 7, agosto: 7,
      sep: 8, sept: 8, septiembre: 8, oct: 9, octubre: 9, nov: 10, noviembre: 10,
      dic: 11, diciembre: 11
    };
    const month = months[match[2].replace(".", "")];
    return month === undefined ? 0 : Date.UTC(Number(match[3]), month, Number(match[1]));
  }

  function formatNoticeArrival(notice) {
    if (!Number.isFinite(notice.createdAt)) return notice.date + " · Hora no registrada";
    return new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" })
      .format(new Date(notice.createdAt));
  }

  function getVisibleTabs() {
    return NAV_ITEMS.filter(function (item) { return item.roles.includes(state.user.role); });
  }

  function renderNavigation() {
    nav.innerHTML = getVisibleTabs().map(function (item) {
      return '<button class="nav-item' + (item.id === state.activeTab ? " active" : "") +
        '" type="button" data-tab="' + item.id + '" aria-current="' +
        (item.id === state.activeTab ? "page" : "false") + '">' + item.label + "</button>";
    }).join("");
  }

  function setPage(title, subtitle, body, action) {
    content.innerHTML = '<div class="page-heading"><div><h1>' + title + "</h1><p>" + subtitle +
      "</p></div>" + (action || "") + "</div>" + body;
    content.focus();
  }

  function renderBus() {
    const user = state.user;
    const student = user.role === "guardian" ? user.student : "Ruta escolar principal";
    const body = '<div class="grid grid-two">' +
      '<section class="card card-pad"><p class="section-label">Ubicación en tiempo real (demo)</p>' +
      '<div class="map-panel"><span class="map-caption">Ruta Escuela Subteniente Luis Cruz Martínez · Actualizado hace 2 min</span>' +
      '<span class="map-pin" aria-label="Ubicación del bus"><span>🚌</span></span><span class="map-label">Bus escolar</span></div></section>' +
      '<div class="grid"><section class="card card-pad"><p class="section-label">Estado del recorrido</p>' +
      '<div class="status-row"><span class="status-dot"></span>En ruta hacia el colegio</div>' +
      '<p class="muted" style="margin:12px 0 0;font-size:11px">Estudiante asociado: ' + escapeHtml(student) + '</p>' +
      '<p class="muted" style="margin:5px 0 0;font-size:11px">Llegada estimada: 08:15 hrs</p></section>' +
      '<section class="card card-pad"><p class="section-label">Identificación del bus</p>' +
      '<div class="qr-box" role="img" aria-label="Código QR de demostración"><span>BUS · EP</span></div>' +
      '<p class="muted" style="margin:0;text-align:center;font-size:10px">QR de verificación · Unidad 03</p></section></div></div>';
    setPage("Rastreo de Bus", "Consulta el recorrido y estado del transporte escolar.", body);
  }

  function visibleNotices() {
    const data = readData();
    return data.notices.filter(function (notice) {
      if (state.user.role === "guardian") {
        if (notice.targetUserId) return notice.targetUserId === state.user.id;
        if (notice.targetGrade) return normalizeCourse(notice.targetGrade) === normalizeCourse(state.user.grade);
        return notice.targetUserId === null;
      }
      if (state.user.role === "teacher") {
        if (notice.targetTeacherGrade) {
          return normalizeCourse(notice.targetTeacherGrade) === normalizeCourse(state.user.grade);
        }
        if (notice.targetUserId) return false;
        if (notice.targetGrade) return normalizeCourse(notice.targetGrade) === normalizeCourse(state.user.grade);
      }
      return true;
    }).sort(function (a, b) { return getNoticeTimestamp(b) - getNoticeTimestamp(a); });
  }

  function renderNotices() {
    const notices = visibleNotices();
    const courseOptions = state.user.grade
      ? '<option value="' + escapeHtml(state.user.grade) + '">' + escapeHtml(state.user.grade) + "</option>"
      : "";
    const canSend = state.user.role === "teacher";
    const composer = canSend
      ? '<section class="card card-pad notice-composer"><p class="section-label">Enviar comunicado</p>' +
        '<form id="notice-form" class="form-grid">' +
        '<label>Título<input name="title" autocomplete="off" required></label>' +
        '<label class="notice-message-field">Mensaje<textarea name="message" rows="3" required></textarea></label>' +
        '<label>Destinatarios<select id="notice-audience" name="audience" required>' +
        '<option value="community">Toda la comunidad escolar</option><option value="course">Un curso</option></select></label>' +
        '<label id="notice-course-field" hidden>Curso<select name="targetGrade" disabled>' +
        '<option value="">Selecciona un curso</option>' + courseOptions + '</select></label>' +
        '<button class="button button-primary" type="submit">📢 Enviar comunicado</button></form></section>'
      : "";
    const list = notices.length
      ? '<div class="notice-list">' + notices.map(function (notice) {
        return '<article class="notice"><h3>' + escapeHtml(notice.title) + '</h3><p>' + escapeHtml(notice.message) +
          '</p><footer><span>Recibido: ' + escapeHtml(formatNoticeArrival(notice)) + '</span><span class="notice-target">' +
          escapeHtml(notice.targetLabel) + "</span></footer></article>";
      }).join("") + "</div>"
      : '<div class="card empty-state">No tienes comunicados disponibles por el momento.</div>';
    setPage("Portal de Comunicados", "Avisos generales y comunicados dirigidos por curso.", composer + list);
  }

  function normalizeCourse(value) {
    return String(value || "").trim().normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
  }

  function renderTeacherLoans() {
    const data = readData();
    const teacherCourse = state.user.grade;
    const loans = sortLoansByStartDate(data.loans.filter(function (loan) {
      if (loan.status !== "Prestado") return false;
      return normalizeCourse(loan.grade) === normalizeCourse(teacherCourse);
    }));
    const rows = loans.map(function (loan) {
      return "<tr><td><strong>" + escapeHtml(loan.student) + "</strong></td><td>" +
        escapeHtml(teacherCourse) + "</td><td>" + escapeHtml(loan.book) + "</td><td>" +
        escapeHtml(formatLoanStart(loan)) + "</td><td>" + escapeHtml(formatLoanDue(loan.due)) + "</td></tr>";
    }).join("");
    const body = loans.length
      ? '<section class="card library-loans"><div class="table-wrap"><table><thead><tr>' +
        "<th>Alumno</th><th>Curso</th><th>Libro prestado</th><th>Inicio</th><th>Devolución</th>" +
        "</tr></thead><tbody>" + rows + "</tbody></table></div></section>"
      : '<div class="card empty-state">No hay alumnos de este curso con libros prestados actualmente.</div>';
    setPage("Libros prestados de " + escapeHtml(teacherCourse),
      "Vista de consulta, ordenada del préstamo más antiguo al más reciente.", body);
  }

  function renderLibrary() {
    const data = readData();
    const loans = sortLoansByStartDate(data.loans);
    const selected = data.loans.find(function (loan) { return loan.id === state.selectedLoanId; });
    const action = selected && selected.status === "Prestado"
      ? isLoanOverdue(selected)
        ? selected.guardianId
          ? '<button id="send-reminder" class="button button-primary" type="button">📧 Avisar a apoderado y profesora jefe</button>'
          : '<button class="button button-secondary" type="button" disabled>Apoderado no vinculado</button>'
        : '<span class="muted overdue-hint">El aviso estará disponible cuando venza el plazo.</span>'
      : "";
    const rows = loans.map(function (loan) {
      const isSelected = loan.id === state.selectedLoanId;
      const isActive = loan.status === "Prestado";
      const isOverdue = isLoanOverdue(loan);
      const status = '<span class="pill' + (isOverdue ? " pending overdue" : isActive ? " pending" : "") +
        '">' + (isOverdue ? "Atrasado" : escapeHtml(loan.status)) + "</span>";
      const returnAction = isActive
        ? '<button class="button button-secondary button-small" type="button" data-return-loan="' +
          escapeHtml(loan.id) + '">Marcar devuelto</button>'
        : '<span class="muted returned-date">' + escapeHtml(loan.returnedAt || "") + "</span>";
      const reminderAction = isActive
        ? isOverdue && loan.guardianId
          ? '<button class="button button-primary button-small" type="button" data-send-reminder="' +
            escapeHtml(loan.id) + '" aria-label="Avisar al apoderado y a la profesora jefe">📧 Avisar responsables</button>'
          : '<button class="button button-secondary button-small" type="button" disabled>' +
            (isOverdue ? "Apoderado no vinculado" : "Avisar al vencer") + "</button>"
        : "";
      const rowAction = isActive
        ? '<div class="loan-actions">' + returnAction + reminderAction + "</div>"
        : returnAction;
      return '<tr data-loan-id="' + escapeHtml(loan.id) + '" class="' + (isSelected ? "selected" : "") +
        '" aria-selected="' + isSelected + '"><td><strong>' + escapeHtml(loan.book) + '</strong></td><td>' +
        escapeHtml(loan.student) + '</td><td>' + escapeHtml(loan.grade) + '</td><td>' +
        escapeHtml(formatLoanStart(loan)) + '</td><td>' + escapeHtml(formatLoanDue(loan.due)) +
        "</td><td>" + status + "</td><td>" + rowAction + "</td></tr>";
    }).join("");
    const body = '<div class="grid grid-two" style="margin-bottom:20px">' +
      '<article class="card metric-card"><span>Libros en catálogo</span><strong>248</strong><small>Inventario de demostración</small></article>' +
      '<article class="card metric-card"><span>Préstamos activos</span><strong>' +
      data.loans.filter(function (loan) { return loan.status === "Prestado"; }).length +
      '</strong><small>Los préstamos devueltos quedan en el historial</small></article></div>' +
      '<section class="card card-pad library-form"><p class="section-label">Registrar préstamo</p>' +
      '<form id="add-loan-form" class="form-grid">' +
      '<label>Libro<input name="book" autocomplete="off" required></label>' +
      '<label>Nombre del alumno<input name="studentName" autocomplete="off" required></label>' +
      '<label>Curso<input name="grade" placeholder="Ej.: 4to Básico" required></label>' +
      '<label>Fecha inicial (dd/mm/aaaa)<input name="startDate" type="text" inputmode="numeric" placeholder="dd/mm/aaaa" required></label>' +
      '<label>Fecha de devolución (dd/mm/aaaa)<input name="due" type="text" inputmode="numeric" placeholder="dd/mm/aaaa" required></label>' +
      '<button class="button button-primary" type="submit">Registrar préstamo</button></form></section>' +
      '<section class="card library-loans"><div class="card-pad" style="padding-bottom:4px"><p class="section-label">Préstamos e inventario</p>' +
      '<p class="muted" style="font-size:11px">Orden cronológico por fecha: del préstamo más antiguo al más reciente. Selecciona un préstamo atrasado para avisar al apoderado y a la profesora jefe.</p></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Libro</th><th>Alumno</th><th>Curso</th><th>Inicio del préstamo</th><th>Devolución</th><th>Estado</th><th>Acción</th></tr></thead>' +
      "<tbody>" + rows + "</tbody></table></div></section>";
    setPage("Gestión de Biblioteca", "Panel de control, catálogo, préstamos e inventario.", body, action);
  }

  function makeId(prefix) {
    return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  function formatLoanDate(dateValue) {
    return String(dateValue.day).padStart(2, "0") + "/" +
      String(dateValue.month).padStart(2, "0") + "/" + dateValue.year;
  }

  function parseChileanDate(value) {
    const rawValue = String(value).trim();
    let match = rawValue.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (!match) {
      const normalizedValue = rawValue.toLocaleLowerCase("es").normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      match = normalizedValue.match(/^(\d{1,2})\s+(?:de\s+)?([a-z.]+)\s+(?:de\s+)?(\d{4})$/);
      if (!match) return null;
      const months = {
        ene: 1, enero: 1, feb: 2, febrero: 2, mar: 3, marzo: 3, abr: 4, abril: 4,
        may: 5, mayo: 5, jun: 6, junio: 6, jul: 7, julio: 7, ago: 8, agosto: 8,
        sep: 9, sept: 9, septiembre: 9, oct: 10, octubre: 10, nov: 11,
        noviembre: 11, dic: 12, diciembre: 12
      };
      const month = months[match[2].replace(".", "")];
      if (!month) return null;
      match = [match[0], match[1], String(month), match[3]];
    }
    const date = {
      day: Number(match[1]),
      month: Number(match[2]),
      year: Number(match[3])
    };
    const parsedDate = new Date(date.year, date.month - 1, date.day);
    if (parsedDate.getFullYear() !== date.year || parsedDate.getMonth() !== date.month - 1 ||
      parsedDate.getDate() !== date.day) return null;
    date.timestamp = Date.UTC(date.year, date.month - 1, date.day);
    return date;
  }

  function formatLoanDue(value) {
    const date = parseChileanDate(value);
    return date ? formatLoanDate(date) : value;
  }

  function isLoanOverdue(loan) {
    if (loan.status !== "Prestado") return false;
    const dueDate = parseChileanDate(loan.due);
    if (!dueDate) return false;
    const today = new Date();
    const todayTimestamp = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    return dueDate.timestamp < todayTimestamp;
  }

  function formatDateInput(input) {
    const value = input.value;
    const cursor = input.selectionStart === null ? value.length : input.selectionStart;
    const digitsBeforeCursor = value.slice(0, cursor).replace(/\D/g, "").length;
    const digits = value.replace(/\D/g, "").slice(0, 8);
    let formatted = digits.slice(0, 2);
    if (digits.length > 2) formatted += "/" + digits.slice(2, 4);
    if (digits.length > 4) formatted += "/" + digits.slice(4, 8);
    const nextCursor = digitsBeforeCursor +
      (digitsBeforeCursor > 2 ? 1 : 0) + (digitsBeforeCursor > 4 ? 1 : 0);
    input.value = formatted;
    input.setSelectionRange(nextCursor, nextCursor);
  }

  function formatLoanStart(loan) {
    if (Number.isFinite(loan.startAt)) {
      const date = new Date(loan.startAt);
      const dateValue = { day: date.getDate(), month: date.getMonth() + 1, year: date.getFullYear() };
      return formatLoanDate(dateValue);
    }
    if (loan.startDate) {
      const legacyDate = parseChileanDate(loan.startDate.split(/\s+/)[0]);
      return legacyDate
        ? formatLoanDate(legacyDate)
        : loan.startDate;
    }
    return "Sin registro anterior";
  }

  function getLoanStartTimestamp(loan) {
    if (Number.isFinite(loan.startAt)) {
      const date = new Date(loan.startAt);
      return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    }
    const legacyDate = parseChileanDate(String(loan.startDate || "").split(/\s+/)[0]);
    return legacyDate ? legacyDate.timestamp : null;
  }

  function sortLoansByStartDate(loans) {
    return loans.map(function (loan, index) {
      return { loan: loan, index: index };
    }).sort(function (a, b) {
      const aTime = getLoanStartTimestamp(a.loan);
      const bTime = getLoanStartTimestamp(b.loan);
      const aHasDate = aTime !== null;
      const bHasDate = bTime !== null;
      if (aHasDate !== bHasDate) return aHasDate ? 1 : -1;
      if (!aHasDate) return a.index - b.index;
      return aTime - bTime || a.index - b.index;
    }).map(function (entry) {
      return entry.loan;
    });
  }

  function sendAnnouncement(form) {
    if (!state.user || state.user.role !== "teacher") return;
    const formData = new FormData(form);
    const title = formData.get("title").trim();
    const message = formData.get("message").trim();
    const audience = formData.get("audience");
    const targetGrade = audience === "course" ? formData.get("targetGrade") : null;
    if (!title || !message || (audience !== "community" && audience !== "course") ||
      (audience === "course" && !targetGrade)) {
      showToast("Completa el título, mensaje y curso destinatario.");
      return;
    }

    const data = readData();
    data.notices.push({
      id: makeId("notice"),
      title: title,
      message: message,
      date: new Intl.DateTimeFormat("es-CL", { dateStyle: "long" }).format(new Date()),
      createdAt: Date.now(),
      targetUserId: null,
      targetGrade: targetGrade,
      targetLabel: targetGrade ? "Apoderados de " + targetGrade : "Toda la comunidad escolar",
      author: state.user.name
    });
    try {
      saveData(data);
    } catch (error) {
      console.error(error);
      showToast(error.message);
      return;
    }
    renderNotices();
    showToast(targetGrade
      ? "Comunicado enviado a los apoderados de " + targetGrade + "."
      : "Comunicado enviado a toda la comunidad escolar.");
  }

  async function registerLoan(form) {
    if (!state.user || state.user.role !== "library") return;
    const formData = new FormData(form);
    const data = readData();
    const student = formData.get("studentName").trim();
    const grade = formData.get("grade").trim();
    const book = formData.get("book").trim();
    const startValue = formData.get("startDate");
    const dueValue = formData.get("due");
    const startDate = parseChileanDate(startValue);
    const dueDate = parseChileanDate(dueValue);
    if (!student || !grade || !book || !startDate || !dueDate) {
      showToast("Ingresa los datos requeridos y ambas fechas con formato dd/mm/aaaa.");
      return;
    }
    if (dueDate.timestamp < startDate.timestamp) {
      showToast("La fecha de devolución no puede ser anterior a la fecha inicial.");
      return;
    }
    let guardian = null;
    try {
      const result = await apiRequest("/api/guardians/lookup", { studentName: student });
      guardian = result.guardian;
    } catch (error) {
      showToast(error.message);
      return;
    }
    const startAt = new Date(startDate.year, startDate.month - 1, startDate.day).getTime();
    data.loans.push({
      id: makeId("loan"),
      book: book,
      student: student,
      grade: grade,
      guardianId: guardian ? guardian.id : null,
      startDate: formatLoanDate(startDate),
      startAt: startAt,
      due: formatLoanDate(dueDate),
      status: "Prestado"
    });
    try {
      saveData(data);
    } catch (error) {
      console.error(error);
      showToast(error.message);
      return;
    }
    state.selectedLoanId = null;
    renderLibrary();
    showToast(guardian
      ? "Préstamo registrado correctamente."
      : "Préstamo guardado. No se encontró un apoderado registrado con ese alumno.");
  }

  function markLoanReturned(loanId) {
    if (!state.user || state.user.role !== "library") return;
    const data = readData();
    const loan = data.loans.find(function (item) { return item.id === loanId; });
    if (!loan || loan.status !== "Prestado") return;
    loan.status = "Devuelto";
    loan.returnedAt = new Intl.DateTimeFormat("es-CL", { dateStyle: "medium" }).format(new Date());
    try {
      saveData(data);
    } catch (error) {
      console.error(error);
      showToast(error.message);
      return;
    }
    state.selectedLoanId = null;
    renderLibrary();
    showToast("Devolución registrada para «" + loan.book + "».");
  }

  function renderActiveTab() {
    const allowed = getVisibleTabs().some(function (item) { return item.id === state.activeTab; });
    if (!allowed) state.activeTab = getVisibleTabs()[0].id;
    renderNavigation();
    if (state.activeTab === "bus") renderBus();
    else if (state.activeTab === "teacher-loans" && state.user.role === "teacher") renderTeacherLoans();
    else if (state.activeTab === "notices") renderNotices();
    else if (state.activeTab === "library" && state.user.role === "library") renderLibrary();
  }

  function activateUser(user) {
    state.user = user;
    state.activeTab = getVisibleTabs()[0].id;
    state.selectedLoanId = null;
    loginScreen.hidden = true;
    appScreen.hidden = false;
    document.getElementById("user-badge").textContent =
      user.role === "library" ? "Biblioteca · " + user.name :
        user.role === "teacher" ? "Docente · " + user.name : "Apoderado · " + user.student;
    renderActiveTab();
  }

  function sendReturnNotice(loanId) {
    if (!state.user || state.user.role !== "library") return;
    const data = readData();
    const loan = data.loans.find(function (item) {
      return item.id === (loanId || state.selectedLoanId);
    });
    if (!loan) {
      showToast("Selecciona un préstamo antes de enviar el aviso.");
      return;
    }
    if (!isLoanOverdue(loan)) {
      showToast("Este préstamo todavía no está atrasado.");
      return;
    }
    if (!loan.guardianId) {
      showToast("No se encontró un apoderado asociado a este alumno; no se envió el aviso.");
      return;
    }
    state.selectedLoanId = loan.id;
    const loanPeriod = loan.startDate
      ? " fue prestado el " + formatLoanStart(loan) + " y su plazo de devolución venció el " + formatLoanDue(loan.due) + "."
      : " debía ser devuelto a más tardar el " + formatLoanDue(loan.due) + ".";
    const notice = {
      id: "notice-" + Date.now(),
      title: "Aviso de libro atrasado",
      message: "Estimado apoderado y profesora jefe de " + loan.grade + ": el alumno " + loan.student +
        " mantiene pendiente el libro '" + loan.book + "'" + loanPeriod + " Agradecemos gestionar su devolución.",
      date: new Intl.DateTimeFormat("es-CL", { dateStyle: "long" }).format(new Date()),
      createdAt: Date.now(),
      targetUserId: loan.guardianId,
      targetTeacherGrade: loan.grade,
      targetLabel: "Apoderado de " + loan.student + " y profesora jefe de " + loan.grade
    };
    data.notices.push(notice);
    try {
      saveData(data);
    } catch (error) {
      console.error(error);
      showToast(error.message);
      return;
    }
    showToast("Aviso enviado al apoderado de " + loan.student + " y a la profesora jefe de " + loan.grade + ".");
    renderLibrary();
  }

  function setFieldsDisabled(container, disabled) {
    container.querySelectorAll("input, select").forEach(function (field) {
      field.disabled = disabled;
    });
  }

  function updateRegistrationFields() {
    const isTeacher = document.getElementById("register-role").value === "teacher";
    const isLibrary = document.getElementById("staff-area").value === "library";
    const guardianFields = document.getElementById("guardian-fields");
    const teacherFields = document.getElementById("teacher-fields");
    const teacherGradeField = document.getElementById("teacher-grade-field");
    const staffKey = document.getElementById("staff-key");
    const teacherGrade = document.getElementById("teacher-grade");

    guardianFields.hidden = isTeacher;
    teacherFields.hidden = !isTeacher;
    setFieldsDisabled(guardianFields, isTeacher);
    setFieldsDisabled(teacherFields, !isTeacher);
    teacherGradeField.hidden = !isTeacher || isLibrary;
    teacherGrade.disabled = !isTeacher || isLibrary;
    teacherGrade.required = isTeacher && !isLibrary;
    staffKey.required = isTeacher;
  }

  async function restoreSession() {
    try {
      const result = await apiRequest("/api/auth/session");
      if (result.user) activateUser(result.user);
    } catch (error) {
      console.error(error);
      document.getElementById("server-error").textContent =
        "No se pudo conectar al servidor. Inicia start.ps1 y abre http://127.0.0.1:8000.";
    }
  }

  function showToast(message) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.classList.add("visible");
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(function () { toast.classList.remove("visible"); }, 4000);
  }

  document.getElementById("login-form").addEventListener("submit", function (event) {
    event.preventDefault();
    const identifier = document.getElementById("login-id").value;
    const error = document.getElementById("login-error");
    apiRequest("/api/auth/login", {
      username: identifier
    }).then(function (result) {
      error.textContent = "";
      document.getElementById("server-error").textContent = "";
      activateUser(result.user);
    }).catch(function (loginError) {
      error.textContent = loginError.message;
    });
  });

  document.getElementById("register-form").addEventListener("submit", function (event) {
    event.preventDefault();
    const error = document.getElementById("register-error");
    const payload = Object.fromEntries(new FormData(event.target).entries());
    apiRequest("/api/auth/register", payload).then(function (result) {
      error.textContent = "";
      document.getElementById("server-error").textContent = "";
      activateUser(result.user);
    }).catch(function (registrationError) {
      error.textContent = registrationError.message;
    });
  });

  document.getElementById("show-register").addEventListener("click", function () {
    document.getElementById("login-form").hidden = true;
    document.getElementById("register-form").hidden = false;
    document.getElementById("server-error").textContent = "";
    updateRegistrationFields();
    document.getElementById("register-role").focus();
  });

  document.getElementById("show-login").addEventListener("click", function () {
    document.getElementById("register-form").hidden = true;
    document.getElementById("login-form").hidden = false;
    document.getElementById("register-error").textContent = "";
    document.getElementById("login-id").focus();
  });

  document.getElementById("register-role").addEventListener("change", updateRegistrationFields);
  document.getElementById("staff-area").addEventListener("change", updateRegistrationFields);

  nav.addEventListener("click", function (event) {
    const button = event.target.closest("[data-tab]");
    if (!button || !getVisibleTabs().some(function (item) { return item.id === button.dataset.tab; })) return;
    state.activeTab = button.dataset.tab;
    renderActiveTab();
  });

  content.addEventListener("submit", function (event) {
    if (event.target.id === "notice-form") {
      event.preventDefault();
      sendAnnouncement(event.target);
    } else if (event.target.id === "add-loan-form") {
      event.preventDefault();
      registerLoan(event.target).catch(function (error) {
        console.error(error);
        showToast(error.message);
      });
    }
  });

  content.addEventListener("input", function (event) {
    if (event.target.name === "startDate" || event.target.name === "due") {
      formatDateInput(event.target);
    }
  });

  content.addEventListener("change", function (event) {
    if (event.target.id !== "notice-audience") return;
    const courseField = content.querySelector("#notice-course-field");
    const courseSelect = courseField.querySelector("select");
    const showCourse = event.target.value === "course";
    courseField.hidden = !showCourse;
    courseSelect.disabled = !showCourse;
    courseSelect.required = showCourse;
  });

  content.addEventListener("click", function (event) {
    const reminderButton = event.target.closest("[data-send-reminder]");
    if (reminderButton) {
      sendReturnNotice(reminderButton.dataset.sendReminder);
      return;
    }
    const returnButton = event.target.closest("[data-return-loan]");
    if (returnButton) {
      markLoanReturned(returnButton.dataset.returnLoan);
      return;
    }
    const loanRow = event.target.closest("[data-loan-id]");
    if (loanRow && state.user.role === "library") {
      state.selectedLoanId = loanRow.dataset.loanId;
      renderLibrary();
      return;
    }
    if (event.target.closest("#send-reminder")) sendReturnNotice();
  });

  document.getElementById("logout-button").addEventListener("click", function () {
    const logoutRequest = apiRequest("/api/auth/logout", {});
    state.user = null;
    state.activeTab = null;
    state.selectedLoanId = null;
    appScreen.hidden = true;
    loginScreen.hidden = false;
    document.getElementById("login-form").hidden = false;
    document.getElementById("register-form").hidden = true;
    document.getElementById("login-form").reset();
    document.getElementById("register-form").reset();
    document.getElementById("login-error").textContent = "";
    document.getElementById("register-error").textContent = "";
    document.getElementById("server-error").textContent = "";
    updateRegistrationFields();
    document.getElementById("login-id").focus();
    logoutRequest.catch(function (error) {
      console.error(error);
      document.getElementById("server-error").textContent =
        "Se volvió al inicio de sesión, pero no se pudo cerrar la sesión en el servidor. Verifica que el servidor esté activo.";
    });
  });

  updateRegistrationFields();
  restoreSession();
}());
