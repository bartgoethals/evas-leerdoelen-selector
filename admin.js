const GOOGLE_DOCS_DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive.file",
];

const state = {
  auth: {
    authenticated: false,
    isAdmin: false,
    isSuperAdmin: false,
    role: "editor",
    user: null,
    googleClientId: "",
  },
  admin: {
    loading: false,
    accounts: [],
    logs: [],
  },
};

const els = {
  authStatus: document.getElementById("authStatus"),
  googleSignInHost: document.getElementById("googleSignInHost"),
  logoutBtn: document.getElementById("logoutBtn"),
  adminNoAccess: document.getElementById("adminNoAccess"),
  adminContent: document.getElementById("adminContent"),
  adminNewEmailInput: document.getElementById("adminNewEmailInput"),
  adminNewRoleSelect: document.getElementById("adminNewRoleSelect"),
  adminAddEmailBtn: document.getElementById("adminAddEmailBtn"),
  adminAccountsList: document.getElementById("adminAccountsList"),
  adminRefreshLogsBtn: document.getElementById("adminRefreshLogsBtn"),
  adminLogsList: document.getElementById("adminLogsList"),
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function isAdminUser() {
  return Boolean(state.auth.authenticated && state.auth.isAdmin);
}

async function apiFetchJson(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  const init = {
    method: options.method || "GET",
    credentials: "include",
    headers,
  };

  if (Object.prototype.hasOwnProperty.call(options, "body")) {
    init.body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
    init.headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, init);
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const err = new Error(payload?.error || `Request mislukt (${response.status})`);
    err.status = response.status;
    throw err;
  }
  return payload;
}

function hasAllGrantedScopes(tokenResponse, scopes) {
  const oauth2 = window.google?.accounts?.oauth2;
  if (oauth2?.hasGrantedAllScopes) {
    return oauth2.hasGrantedAllScopes(tokenResponse, ...scopes);
  }
  const granted = new Set(
    String(tokenResponse?.scope || "")
      .split(/\s+/)
      .filter(Boolean)
  );
  return scopes.every((scope) => granted.has(scope));
}

async function requestDocsDriveConsentAtLogin() {
  return new Promise((resolve) => {
    const oauth2 = window.google?.accounts?.oauth2;
    if (!state.auth.googleClientId || !oauth2?.initTokenClient) {
      resolve(false);
      return;
    }

    const client = oauth2.initTokenClient({
      client_id: state.auth.googleClientId,
      scope: GOOGLE_DOCS_DRIVE_SCOPES.join(" "),
      include_granted_scopes: true,
      callback: (tokenResponse) => {
        if (tokenResponse?.error) {
          resolve(false);
          return;
        }
        resolve(hasAllGrantedScopes(tokenResponse, GOOGLE_DOCS_DRIVE_SCOPES));
      },
      error_callback: () => resolve(false),
    });

    try {
      client.requestAccessToken({
        prompt: "consent",
        hint: state.auth.user?.email || undefined,
      });
    } catch (err) {
      console.error("Kon Docs/Drive-toestemming niet aanvragen", err);
      resolve(false);
    }
  });
}

function scheduleGoogleButtonRender(attempt = 0) {
  if (state.auth.authenticated) return;
  if (!state.auth.googleClientId || !els.googleSignInHost) return;

  if (window.google?.accounts?.id) {
    els.googleSignInHost.innerHTML = "";
    window.google.accounts.id.initialize({
      client_id: state.auth.googleClientId,
      callback: handleGoogleCredentialResponse,
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    window.google.accounts.id.renderButton(els.googleSignInHost, {
      theme: "outline",
      size: "medium",
      shape: "pill",
      text: "signin_with",
      locale: "nl",
      width: 220,
    });
    return;
  }

  if (attempt >= 24) return;
  window.setTimeout(() => scheduleGoogleButtonRender(attempt + 1), 250);
}

function updateAuthUi() {
  const loggedIn = Boolean(state.auth.authenticated);
  if (els.authStatus) {
    if (!loggedIn) {
      els.authStatus.textContent = state.auth.googleClientId
        ? "Login vereist voor admin-toegang."
        : "Google-login is nog niet geconfigureerd.";
    } else if (state.auth.isAdmin) {
      els.authStatus.textContent = `Ingelogd als ${state.auth.user?.email || "onbekend"} (${state.auth.role})`;
    } else {
      els.authStatus.textContent = `Ingelogd als ${state.auth.user?.email || "onbekend"}, maar zonder adminrechten.`;
    }
  }

  els.logoutBtn?.classList.toggle("hidden", !loggedIn);

  if (els.googleSignInHost) {
    els.googleSignInHost.classList.toggle("hidden", loggedIn || !state.auth.googleClientId);
    if (loggedIn) {
      els.googleSignInHost.innerHTML = "";
    } else {
      scheduleGoogleButtonRender();
    }
  }

  if (els.adminContent) {
    els.adminContent.classList.toggle("hidden", !isAdminUser());
  }

  if (els.adminNoAccess) {
    els.adminNoAccess.classList.toggle("hidden", isAdminUser());
    if (!isAdminUser()) {
      if (!loggedIn) {
        els.adminNoAccess.innerHTML = "<h2>Admin-toegang vereist</h2><p>Log in met een account dat adminrechten heeft.</p>";
      } else {
        els.adminNoAccess.innerHTML = "<h2>Geen adminrechten</h2><p>Dit account heeft geen toegang tot het admin-paneel.</p>";
      }
    }
  }
}

async function loadAuthConfig() {
  try {
    const data = await apiFetchJson("/api/config");
    state.auth.googleClientId = String(data?.googleClientId || "");
  } catch (err) {
    console.error("Kon auth-config niet laden", err);
    state.auth.googleClientId = "";
  }
}

async function refreshSession() {
  try {
    const data = await apiFetchJson("/api/auth/me");
    state.auth.authenticated = Boolean(data?.authenticated);
    state.auth.isAdmin = Boolean(data?.isAdmin);
    state.auth.isSuperAdmin = Boolean(data?.isSuperAdmin);
    state.auth.role = String(data?.role || "editor");
    state.auth.user = data?.user || null;
  } catch (err) {
    console.error("Kon sessie niet laden", err);
    state.auth.authenticated = false;
    state.auth.isAdmin = false;
    state.auth.isSuperAdmin = false;
    state.auth.role = "editor";
    state.auth.user = null;
  }
}

async function loadAdminData() {
  if (!isAdminUser()) {
    state.admin.accounts = [];
    state.admin.logs = [];
    state.admin.loading = false;
    return;
  }

  state.admin.loading = true;
  render();
  try {
    const [accessData, logsData] = await Promise.all([
      apiFetchJson("/api/admin/access"),
      apiFetchJson("/api/admin/logs?limit=400"),
    ]);
    state.admin.accounts = Array.isArray(accessData?.accounts) ? accessData.accounts : [];
    state.admin.logs = Array.isArray(logsData?.logs) ? logsData.logs : [];
  } catch (err) {
    console.error("Kon admin-data niet laden", err);
    state.admin.accounts = [];
    state.admin.logs = [];
    if (err.status === 401 || err.status === 403) {
      await refreshSession();
    }
  } finally {
    state.admin.loading = false;
  }
}

async function handleGoogleCredentialResponse(response) {
  const credential = response?.credential;
  if (!credential) return;

  try {
    const data = await apiFetchJson("/api/auth/login", {
      method: "POST",
      body: { credential },
    });

    state.auth.authenticated = false;
    state.auth.isAdmin = Boolean(data?.isAdmin);
    state.auth.isSuperAdmin = Boolean(data?.isSuperAdmin);
    state.auth.role = String(data?.role || "editor");
    state.auth.user = data?.user || null;

    const scopesGranted = await requestDocsDriveConsentAtLogin();
    if (!scopesGranted) {
      try {
        await apiFetchJson("/api/auth/logout", { method: "POST" });
      } catch (logoutErr) {
        console.error("Kon sessie niet afsluiten na geweigerde Docs/Drive-toestemming", logoutErr);
      }
      state.auth.authenticated = false;
      state.auth.isAdmin = false;
      state.auth.isSuperAdmin = false;
      state.auth.role = "editor";
      state.auth.user = null;
      updateAuthUi();
      render();
      alert("Inloggen vereist toestemming voor Google Docs en Drive.");
      return;
    }

    state.auth.authenticated = true;
    await loadAdminData();
    render();
  } catch (err) {
    console.error("Aanmelden mislukt", err);
    state.auth.authenticated = false;
    state.auth.isAdmin = false;
    state.auth.isSuperAdmin = false;
    state.auth.role = "editor";
    state.auth.user = null;
    updateAuthUi();
    render();
    alert(err.message || "Aanmelden is mislukt.");
  }
}

async function logout() {
  try {
    await apiFetchJson("/api/auth/logout", { method: "POST" });
  } catch (err) {
    console.error("Uitloggen mislukt", err);
  }

  state.auth.authenticated = false;
  state.auth.isAdmin = false;
  state.auth.isSuperAdmin = false;
  state.auth.role = "editor";
  state.auth.user = null;
  state.admin.accounts = [];
  state.admin.logs = [];
  state.admin.loading = false;
  render();
}

function formatLogTimestamp(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("nl-BE");
}

function actionTypeLabel(actionType) {
  if (actionType === "export_txt") return "export naar txt";
  if (actionType === "export_docs") return "export naar docs";
  if (actionType === "edit_voorbeelden") return "aanpassing voorbeelden";
  if (actionType === "edit_toelichting") return "aanpassing extra toelichting";
  if (actionType === "edit_woordenschat") return "aanpassing woordenschat";
  if (actionType === "access_add") return "toegang toegevoegd";
  if (actionType === "access_remove") return "toegang verwijderd";
  if (actionType === "access_role_update") return "rol aangepast";
  if (actionType === "revert_version") return "herstel naar versie";
  return actionType || "wijziging";
}

function buildExportDetailsHtml(payload) {
  const data = payload && typeof payload === "object" ? payload : {};
  const count = Number(data.count || 0);
  const items = Array.isArray(data.items) ? data.items : [];
  const docUrl = String(data.docUrl || "").trim();
  const header = `<p><strong>Aantal geëxporteerde doelen:</strong> ${count || items.length}</p>`;
  const list = items.length
    ? `<ul class=\"admin-export-list\">${items
        .map((item) => `<li>${escapeHtml(item.leerplandoel || item.goalTitle || "-")} <span>(${escapeHtml(item.vak || "-")})</span></li>`)
        .join("")}</ul>`
    : "<p>Geen detailitems beschikbaar.</p>";
  const link = docUrl
    ? `<p><a href=\"${escapeHtml(docUrl)}\" target=\"_blank\" rel=\"noreferrer\">Open Google Doc</a></p>`
    : "";
  return `${header}${link}${list}`;
}

function buildLogDetailsHtml(log) {
  const metadata = log?.metadata && typeof log.metadata === "object" ? log.metadata : {};

  if (String(log.actionType || "").startsWith("edit_")) {
    return `
      <p><strong>Doel:</strong> ${escapeHtml(log.goalTitle || log.goalId || "-")}</p>
      <p><strong>Veld:</strong> ${escapeHtml(actionTypeLabel(log.actionType))}</p>
      <p><strong>Originele tekst:</strong></p>
      <pre class="admin-log-text">${escapeHtml(log.beforeText || "")}</pre>
      <p><strong>Aangepaste tekst:</strong></p>
      <pre class="admin-log-text">${escapeHtml(log.afterText || "")}</pre>
    `;
  }

  if (log.actionType === "export_txt" || log.actionType === "export_docs") {
    return buildExportDetailsHtml(metadata.payload);
  }

  if (log.actionType === "access_add" || log.actionType === "access_remove") {
    return `<p><strong>E-mailadres:</strong> ${escapeHtml(metadata.email || "-")}</p>`;
  }

  if (log.actionType === "access_role_update") {
    return `
      <p><strong>E-mailadres:</strong> ${escapeHtml(metadata.email || "-")}</p>
      <p><strong>Nieuwe rol:</strong> ${escapeHtml(metadata.role || "-")}</p>
    `;
  }

  if (log.actionType === "revert_version") {
    return `
      <p><strong>Doel:</strong> ${escapeHtml(log.goalTitle || log.goalId || "-")}</p>
      <p><strong>Hersteld vanaf log:</strong> #${escapeHtml(String(metadata.reverted_log_id || "-"))}</p>
    `;
  }

  return `<pre class="admin-log-text">${escapeHtml(JSON.stringify(metadata, null, 2))}</pre>`;
}

function renderAccounts() {
  if (!els.adminAccountsList) return;

  if (!isAdminUser()) {
    els.adminAccountsList.innerHTML = "";
    return;
  }

  if (state.admin.loading) {
    els.adminAccountsList.innerHTML = '<p class="placeholder">Accountlijst laden...</p>';
    return;
  }

  if (!state.admin.accounts.length) {
    els.adminAccountsList.innerHTML = '<p class="placeholder">Geen accounts gevonden.</p>';
    return;
  }

  const ownEmail = String(state.auth.user?.email || "").toLowerCase();
  els.adminAccountsList.innerHTML = state.admin.accounts
    .map((account) => {
      const email = String(account.email || "").toLowerCase();
      const role = String(account.role || "editor");
      const isSuperAdmin = Boolean(account.isSuperAdmin);
      const canRemove = !isSuperAdmin && email && email !== ownEmail;

      const roleBadgeLabel = isSuperAdmin
        ? "superadmin"
        : role === "admin"
          ? "admin"
          : "editor";
      const roleBadgeClass = isSuperAdmin
        ? "admin-role-badge superadmin"
        : role === "admin"
          ? "admin-role-badge admin"
          : "admin-role-badge editor";

      const roleControl = isSuperAdmin
        ? '<span class="admin-account-lock">vast account</span>'
        : `
          <select class="admin-role-select" data-role-email="${escapeHtml(email)}" aria-label="Rol voor ${escapeHtml(email)}">
            <option value="editor" ${role === "editor" ? "selected" : ""}>Editor</option>
            <option value="admin" ${role === "admin" ? "selected" : ""}>Admin</option>
          </select>
        `;

      const removeControl = canRemove
        ? `<button type="button" class="mini-danger-btn" data-remove-email="${escapeHtml(email)}" aria-label="Verwijder ${escapeHtml(email)}">🗑</button>`
        : "";

      return `
        <div class="admin-account-row">
          <div class="admin-account-main">
            <span class="admin-account-email">${escapeHtml(email)}</span>
            <span class="${roleBadgeClass}">${roleBadgeLabel}</span>
          </div>
          <div class="admin-account-actions">
            ${roleControl}
            ${removeControl}
          </div>
        </div>
      `;
    })
    .join("");
}

function renderLogs() {
  if (!els.adminLogsList) return;

  if (!isAdminUser()) {
    els.adminLogsList.innerHTML = "";
    return;
  }

  if (state.admin.loading) {
    els.adminLogsList.innerHTML = '<p class="placeholder">Logs laden...</p>';
    return;
  }

  if (!state.admin.logs.length) {
    els.adminLogsList.innerHTML = '<p class="placeholder">Nog geen log-items.</p>';
    return;
  }

  els.adminLogsList.innerHTML = state.admin.logs
    .map((log) => {
      const actor = log.actorName || log.actorEmail || "onbekend";
      const summary = `${formatLogTimestamp(log.createdAt)} • ${actor} • ${actionTypeLabel(log.actionType)}`;
      const revertButton = log.canRevert
        ? `<button type="button" class="ghost-btn small admin-revert-btn" data-revert-log-id="${Number(log.id)}">Herstel naar deze versie</button>`
        : "";

      return `
        <details class="admin-log-item">
          <summary>${escapeHtml(summary)}</summary>
          <div class="admin-log-body">
            ${buildLogDetailsHtml(log)}
            ${revertButton}
          </div>
        </details>
      `;
    })
    .join("");
}

function render() {
  updateAuthUi();
  renderAccounts();
  renderLogs();
}

async function adminRefreshAll() {
  await loadAdminData();
  render();
}

async function adminAddEmail() {
  if (!isAdminUser()) return;

  const email = String(els.adminNewEmailInput?.value || "").trim().toLowerCase();
  const role = String(els.adminNewRoleSelect?.value || "editor").trim().toLowerCase();
  if (!email) return;

  try {
    await apiFetchJson("/api/admin/access", {
      method: "POST",
      body: { email, role },
    });
    if (els.adminNewEmailInput) els.adminNewEmailInput.value = "";
    await adminRefreshAll();
  } catch (err) {
    console.error("Toevoegen van account mislukt", err);
    alert(err.message || "Toevoegen van account mislukt.");
  }
}

async function adminRemoveEmail(email) {
  if (!isAdminUser()) return;

  try {
    await apiFetchJson("/api/admin/access", {
      method: "DELETE",
      body: { email },
    });
    await adminRefreshAll();
  } catch (err) {
    console.error("Verwijderen van account mislukt", err);
    alert(err.message || "Verwijderen van account mislukt.");
  }
}

async function adminUpdateRole(email, role) {
  if (!isAdminUser()) return;

  try {
    await apiFetchJson("/api/admin/access", {
      method: "PATCH",
      body: { email, role },
    });
    await adminRefreshAll();
  } catch (err) {
    console.error("Aanpassen van rol mislukt", err);
    alert(err.message || "Aanpassen van rol mislukt.");
  }
}

async function adminRevertLog(logId) {
  if (!isAdminUser()) return;

  try {
    await apiFetchJson("/api/admin/revert", {
      method: "POST",
      body: { logId },
    });
    await adminRefreshAll();
  } catch (err) {
    console.error("Herstellen van versie mislukt", err);
    alert(err.message || "Herstellen van versie mislukt.");
  }
}

function bindEvents() {
  els.logoutBtn?.addEventListener("click", logout);
  els.adminAddEmailBtn?.addEventListener("click", () => {
    void adminAddEmail();
  });
  els.adminRefreshLogsBtn?.addEventListener("click", () => {
    void adminRefreshAll();
  });

  els.adminNewEmailInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void adminAddEmail();
    }
  });

  els.adminAccountsList?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest("[data-remove-email]");
    if (!(button instanceof HTMLElement)) return;
    const email = button.dataset.removeEmail;
    if (!email) return;
    void adminRemoveEmail(email);
  });

  els.adminAccountsList?.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    const email = target.dataset.roleEmail;
    if (!email) return;
    const role = String(target.value || "").trim().toLowerCase();
    if (!role) return;
    void adminUpdateRole(email, role);
  });

  els.adminLogsList?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest("[data-revert-log-id]");
    if (!(button instanceof HTMLElement)) return;
    const logId = Number(button.dataset.revertLogId || "");
    if (!Number.isFinite(logId) || logId <= 0) return;
    void adminRevertLog(logId);
  });

  window.addEventListener("load", () => {
    if (!state.auth.authenticated) {
      scheduleGoogleButtonRender();
    }
  });
}

async function init() {
  await loadAuthConfig();
  await refreshSession();
  await loadAdminData();
  bindEvents();
  render();
}

init().catch((err) => {
  console.error(err);
  if (els.adminNoAccess) {
    els.adminNoAccess.classList.remove("hidden");
    els.adminNoAccess.innerHTML = "<h2>Fout</h2><p>Admin-paneel kon niet geladen worden.</p>";
  }
});
