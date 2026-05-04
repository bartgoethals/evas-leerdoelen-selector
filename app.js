const state = {
  doelen: [],
  doelMap: new Map(),
  bronnen: [],
  filtered: [],
  selectedId: null,
  selection: [],
  userNotes: {},
  detailEditors: {},
  suggestionIndex: null,
  auth: {
    authenticated: false,
    isAdmin: false,
    isSuperAdmin: false,
    role: "editor",
    user: null,
    googleClientId: "",
    docsScopesGranted: null,
    googleDocsAccessToken: "",
    googleDocsAccessTokenExpiresAt: 0,
  },
  admin: {
    adminEmail: "",
    allowedEmails: [],
    logs: [],
    loading: false,
  },
  filters: {
    vak: [],
    fase: [],
    domein: [],
    subdomein: [],
    cluster: [],
    doelsoort: [],
  },
  availableOptions: {
    vak: [],
    fase: [],
    domein: [],
    subdomein: [],
    cluster: [],
    doelsoort: [],
  },
};

const EDITABLE_FIELDS = ["voorbeelden", "toelichting", "woordenschat"];
const LOGIN_REQUIRED_TEXT = "Publiek raadplegen, selecteren en exporteren. Login vereist voor bewerken.";
const GOOGLE_DOCS_DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive.file",
];
const MAX_VISIBLE_SELECTION_ITEMS = 25;
const NL_STOPWORDS = new Set([
  "de", "het", "een", "en", "van", "in", "op", "te", "met", "voor", "door", "tot", "bij", "aan", "of",
  "als", "dat", "die", "dit", "deze", "zijn", "haar", "hun", "je", "jij", "hij", "zij", "we", "wij",
  "is", "was", "wordt", "kan", "kunnen", "moet", "moeten", "om", "ook", "nog", "niet", "wel", "dan",
  "naar", "uit", "over", "onder", "tussen", "rond", "hier", "nu", "met", "zonder", "leerling", "leerlingen",
  "ondersteuning", "ondersteund", "doel", "doelen"
]);
const NON_CHILD_WORDS = new Set([
  "modeling", "transfer", "expliciete", "begeleide", "denkhandelingen", "differentieer", "zelfstandigheid",
  "inoefening", "contexten", "observeer", "uitvoering", "stapsgewijs", "subdomein", "doelsoort"
]);

const FILTER_DEFS = [
  { key: "vak", prop: "vak", el: "vakFilter", allLabel: "Alle disciplines" },
  { key: "fase", prop: "fase", el: "faseFilter", allLabel: "Alle fases" },
  { key: "domein", prop: "domein", el: "domeinFilter", allLabel: "Alle domeinen" },
  { key: "subdomein", prop: "subdomein", el: "subdomeinFilter", allLabel: "Alle subdomeinen" },
  { key: "cluster", prop: "cluster", el: "clusterFilter", allLabel: "Alle clusters" },
  { key: "doelsoort", prop: "doelsoort", el: "doelsoortFilter", allLabel: "Alle doel-soorten" },
];

const els = {
  metaStats: document.getElementById("metaStats"),
  resultCount: document.getElementById("resultCount"),
  resultList: document.getElementById("resultList"),
  detailView: document.getElementById("detailView"),
  activeFilters: document.getElementById("activeFilters"),
  searchInput: document.getElementById("searchInput"),
  resetFilters: document.getElementById("resetFilters"),
  selectedCountTop: document.getElementById("selectedCountTop"),
  selectionCount: document.getElementById("selectionCount"),
  selectionList: document.getElementById("selectionList"),
  exportSelectionBtn: document.getElementById("exportSelectionBtn"),
  exportSelectionDocsBtn: document.getElementById("exportSelectionDocsBtn"),
  addAllResultsBtn: document.getElementById("addAllResultsBtn"),
  adminPanel: document.getElementById("adminPanel"),
  adminAccountsList: document.getElementById("adminAccountsList"),
  adminNewEmailInput: document.getElementById("adminNewEmailInput"),
  adminAddEmailBtn: document.getElementById("adminAddEmailBtn"),
  adminLogsList: document.getElementById("adminLogsList"),
  adminRefreshLogsBtn: document.getElementById("adminRefreshLogsBtn"),
  authStatus: document.getElementById("authStatus"),
  googleSignInHost: document.getElementById("googleSignInHost"),
  adminLink: document.getElementById("adminLink"),
  logoutBtn: document.getElementById("logoutBtn"),
};

function uniq(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "nl"));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function canEditNotes() {
  return Boolean(state.auth.authenticated);
}

function isAdminUser() {
  return Boolean(state.auth.authenticated && state.auth.isAdmin);
}

function sanitizeNote(note) {
  if (!note || typeof note !== "object") return null;
  const next = {};
  EDITABLE_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(note, field)) {
      next[field] = String(note[field] ?? "");
    }
  });
  return Object.keys(next).length ? next : null;
}

function normalizeUserNotes(raw) {
  if (!raw || typeof raw !== "object") return {};
  const normalized = {};
  Object.entries(raw).forEach(([goalId, note]) => {
    const clean = sanitizeNote(note);
    if (clean) normalized[goalId] = clean;
  });
  return normalized;
}

function withUniqueRowKeys(goals) {
  const idCounters = new Map();
  return goals.map((goal, index) => {
    const baseId = String(goal?.id || `goal-${index + 1}`);
    const nextCount = (idCounters.get(baseId) || 0) + 1;
    idCounters.set(baseId, nextCount);
    const rowKey = nextCount === 1 ? baseId : `${baseId}__${nextCount}`;
    return {
      ...goal,
      rowKey,
    };
  });
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
    const message = payload?.error || `Request mislukt (${response.status})`;
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }
  return payload;
}

async function loadAdminData() {
  if (!isAdminUser()) {
    state.admin.adminEmail = "";
    state.admin.allowedEmails = [];
    state.admin.logs = [];
    state.admin.loading = false;
    return;
  }

  state.admin.loading = true;
  try {
    const [accessData, logsData] = await Promise.all([
      apiFetchJson("/api/admin/access"),
      apiFetchJson("/api/admin/logs?limit=400"),
    ]);
    state.admin.allowedEmails = Array.isArray(accessData?.accounts) ? accessData.accounts : [];
    state.admin.adminEmail = String(accessData?.adminEmail || "").toLowerCase();
    state.admin.logs = Array.isArray(logsData?.logs) ? logsData.logs : [];
  } catch (err) {
    console.error("Kon admin-data niet laden", err);
    state.admin.adminEmail = "";
    state.admin.allowedEmails = [];
    state.admin.logs = [];
  } finally {
    state.admin.loading = false;
  }
}

async function loadSharedOverrides() {
  try {
    const data = await apiFetchJson("/api/overrides");
    state.userNotes = normalizeUserNotes(data?.overrides);
  } catch (err) {
    console.error("Kon gedeelde aanpassingen niet laden", err);
    state.userNotes = {};
  }
}

async function saveSharedOverride(goalId, note, meta = {}) {
  const clean = sanitizeNote(note);
  try {
    await apiFetchJson("/api/overrides", {
      method: "POST",
      body: {
        goalId,
        note: clean,
        goalTitle: String(meta.goalTitle || ""),
        goalCode: String(meta.goalCode || ""),
        changes: Array.isArray(meta.changes) ? meta.changes : [],
      },
    });
    return true;
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      state.auth.authenticated = false;
      state.auth.isAdmin = false;
      state.auth.user = null;
      state.admin.adminEmail = "";
      state.admin.allowedEmails = [];
      state.admin.logs = [];
      state.admin.loading = false;
      updateAuthUi();
      render();
      alert("Je sessie is verlopen. Log opnieuw in om te bewerken.");
      return false;
    }
    console.error("Kon aanpassing niet bewaren", err);
    alert(err.message || "Bewaren is mislukt. Probeer opnieuw.");
    return false;
  }
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
      state.auth.docsScopesGranted = false;
      state.auth.googleDocsAccessToken = "";
      state.auth.googleDocsAccessTokenExpiresAt = 0;
      resolve(false);
      return;
    }

    const client = oauth2.initTokenClient({
      client_id: state.auth.googleClientId,
      scope: GOOGLE_DOCS_DRIVE_SCOPES.join(" "),
      include_granted_scopes: true,
      callback: (tokenResponse) => {
        if (tokenResponse?.error) {
          state.auth.docsScopesGranted = false;
          state.auth.googleDocsAccessToken = "";
          state.auth.googleDocsAccessTokenExpiresAt = 0;
          resolve(false);
          return;
        }

        const granted = hasAllGrantedScopes(tokenResponse, GOOGLE_DOCS_DRIVE_SCOPES);
        state.auth.docsScopesGranted = granted;
        if (granted && tokenResponse?.access_token) {
          state.auth.googleDocsAccessToken = String(tokenResponse.access_token);
          state.auth.googleDocsAccessTokenExpiresAt =
            Date.now() + Number(tokenResponse.expires_in || 0) * 1000;
        } else {
          state.auth.googleDocsAccessToken = "";
          state.auth.googleDocsAccessTokenExpiresAt = 0;
        }
        resolve(granted);
      },
      error_callback: () => {
        state.auth.docsScopesGranted = false;
        state.auth.googleDocsAccessToken = "";
        state.auth.googleDocsAccessTokenExpiresAt = 0;
        resolve(false);
      },
    });

    try {
      client.requestAccessToken({
        prompt: "consent",
        hint: state.auth.user?.email || undefined,
      });
    } catch (err) {
      console.error("Kon Docs/Drive-toestemming niet aanvragen", err);
      state.auth.docsScopesGranted = false;
      state.auth.googleDocsAccessToken = "";
      state.auth.googleDocsAccessTokenExpiresAt = 0;
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
  const isLoggedIn = Boolean(state.auth.authenticated);
  if (els.authStatus) {
    if (isLoggedIn) {
      const email = state.auth.user?.email || "onbekende gebruiker";
      els.authStatus.textContent = `Ingelogd als ${email}`;
    } else if (!state.auth.googleClientId) {
      els.authStatus.textContent = `${LOGIN_REQUIRED_TEXT} (Google-login niet geconfigureerd)`;
    } else {
      els.authStatus.textContent = LOGIN_REQUIRED_TEXT;
    }
  }

  if (els.logoutBtn) {
    els.logoutBtn.classList.toggle("hidden", !isLoggedIn);
  }
  if (els.adminLink) {
    els.adminLink.classList.toggle("hidden", !isAdminUser());
  }
  if (els.googleSignInHost) {
    els.googleSignInHost.classList.toggle("hidden", isLoggedIn || !state.auth.googleClientId);
    if (isLoggedIn) {
      els.googleSignInHost.innerHTML = "";
    } else {
      scheduleGoogleButtonRender();
    }
  }

  if (els.adminPanel) {
    els.adminPanel.classList.toggle("hidden", !isAdminUser());
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
    state.auth.docsScopesGranted = null;
    state.auth.googleDocsAccessToken = "";
    state.auth.googleDocsAccessTokenExpiresAt = 0;
  } catch (err) {
    console.error("Kon sessie niet laden", err);
    state.auth.authenticated = false;
    state.auth.isAdmin = false;
    state.auth.isSuperAdmin = false;
    state.auth.role = "editor";
    state.auth.user = null;
    state.auth.docsScopesGranted = null;
    state.auth.googleDocsAccessToken = "";
    state.auth.googleDocsAccessTokenExpiresAt = 0;
    state.admin.adminEmail = "";
    state.admin.allowedEmails = [];
    state.admin.logs = [];
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
    state.auth.docsScopesGranted = null;
    state.auth.googleDocsAccessToken = "";
    state.auth.googleDocsAccessTokenExpiresAt = 0;
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
      state.auth.docsScopesGranted = null;
      state.auth.googleDocsAccessToken = "";
      state.auth.googleDocsAccessTokenExpiresAt = 0;
      state.admin.adminEmail = "";
      state.admin.allowedEmails = [];
      state.admin.logs = [];
      state.admin.loading = false;
      updateAuthUi();
      render();
      alert("Inloggen vereist toestemming voor Google Docs en Drive.");
      return;
    }
    state.auth.authenticated = true;
    await loadSharedOverrides();
    await loadAdminData();
    updateAuthUi();
    render();
  } catch (err) {
    console.error("Aanmelden mislukt", err);
    state.auth.authenticated = false;
    state.auth.isAdmin = false;
    state.auth.isSuperAdmin = false;
    state.auth.role = "editor";
    state.auth.user = null;
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
  state.auth.docsScopesGranted = null;
  state.auth.googleDocsAccessToken = "";
  state.auth.googleDocsAccessTokenExpiresAt = 0;
  state.admin.adminEmail = "";
  state.admin.allowedEmails = [];
  state.admin.logs = [];
  state.admin.loading = false;
  updateAuthUi();
  render();
}

function splitSentences(text) {
  return String(text || "")
    .split(/[.!?]\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 18);
}

function pickTopWords(texts, limit = 8) {
  const freq = new Map();
  texts.forEach((text) => {
    String(text || "")
      .toLowerCase()
      .replace(/[^a-zà-ÿ0-9\s-]/gi, " ")
      .split(/\s+/)
      .map((w) => w.trim())
      .filter((w) => isChildFriendlyWord(w))
      .forEach((w) => freq.set(w, (freq.get(w) || 0) + 1));
  });
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word]) => word);
}

function isChildFriendlyWord(word) {
  const w = String(word || "").toLowerCase().trim();
  if (!w) return false;
  if (w.length < 3 || w.length > 10) return false;
  if (NL_STOPWORDS.has(w)) return false;
  if (NON_CHILD_WORDS.has(w)) return false;
  if (/\d/.test(w)) return false;
  if (w.endsWith("heid") || w.endsWith("atie") || w.endsWith("ering") || w.endsWith("isme")) return false;
  return true;
}

function buildSuggestionIndex(doelen) {
  const byVak = new Map();
  const bySubdomein = new Map();
  const byCluster = new Map();
  const byMd = new Map();
  const byNrmd = new Map();
  const byCodeStem = new Map();
  const byClusterSub = new Map();
  doelen.forEach((d) => {
    if (d.vak) {
      if (!byVak.has(d.vak)) byVak.set(d.vak, []);
      byVak.get(d.vak).push(d);
    }
    if (d.subdomein) {
      const key = `${d.vak}::${d.subdomein}`;
      if (!bySubdomein.has(key)) bySubdomein.set(key, []);
      bySubdomein.get(key).push(d);
    }
    if (d.cluster) {
      const key = `${d.vak}::${d.cluster}`;
      if (!byCluster.has(key)) byCluster.set(key, []);
      byCluster.get(key).push(d);
    }
    if (d.md) {
      const key = `${d.vak}::${d.md}`;
      if (!byMd.has(key)) byMd.set(key, []);
      byMd.get(key).push(d);
    }
    if (d.nrmd) {
      const key = `${d.vak}::${d.nrmd}`;
      if (!byNrmd.has(key)) byNrmd.set(key, []);
      byNrmd.get(key).push(d);
    }
    if (d.code) {
      const parts = String(d.code).split(".");
      const stem = parts.length > 1 ? parts.slice(0, -1).join(".") : d.code;
      const key = `${d.vak}::${stem}`;
      if (!byCodeStem.has(key)) byCodeStem.set(key, []);
      byCodeStem.get(key).push(d);
    }
    if (d.cluster || d.subdomein) {
      const key = `${d.vak}::${d.subdomein || ""}::${d.cluster || ""}`;
      if (!byClusterSub.has(key)) byClusterSub.set(key, []);
      byClusterSub.get(key).push(d);
    }
  });
  return { byVak, bySubdomein, byCluster, byMd, byNrmd, byCodeStem, byClusterSub };
}

function similarGoals(goal) {
  if (!state.suggestionIndex) return [];
  const subKey = `${goal.vak}::${goal.subdomein || ""}`;
  const clusterKey = `${goal.vak}::${goal.cluster || ""}`;
  const pool =
    state.suggestionIndex.bySubdomein.get(subKey) ||
    state.suggestionIndex.byCluster.get(clusterKey) ||
    state.suggestionIndex.byVak.get(goal.vak) ||
    [];
  return pool.filter((g) => g.id !== goal.id).slice(0, 50);
}

function generateVoorbeeldenSuggestion(goal) {
  const similars = similarGoals(goal);
  const baseSentences = similars.flatMap((g) => splitSentences(g.voorbeelden)).slice(0, 2);
  const original = (goal.voorbeelden || "").trim();
  const starter = goal.fase
    ? `In fase ${goal.fase.replace(".", "")} kan dit doel zichtbaar worden in herkenbare klas- en leefsituaties.`
    : "Dit doel kan zichtbaar worden in herkenbare klas- en leefsituaties.";
  const derived = baseSentences.length
    ? baseSentences.map((s, i) => `- ${s.trim().replace(/[.]+$/, "")}.`).join("\n")
    : "- Werk met korte, concrete opdrachten in een betekenisvolle context.\n- Laat de leerling verwoorden, tonen of toepassen wat begrepen werd.";

  if (original) {
    return [
      starter,
      "",
      "Originele voorbeelden:",
      original,
      "",
      "Aanvullende voorbeelden:",
      derived,
    ].join("\n");
  }

  return [starter, "", "Aanvullende voorbeelden:", derived].join("\n");
}

function generateToelichtingSuggestion(goal) {
  const similars = similarGoals(goal);
  const textPool = [
    goal.leerplandoel,
    goal.voorbeelden,
    goal.extra_toelichting,
    ...similars.map((g) => g.leerplandoel),
    ...similars.map((g) => g.extra_toelichting),
  ];
  const kern = [
    "Bouw dit doel op in kleine stappen: eerst sterk ondersteunen, daarna samen oefenen, en pas dan zelfstandig laten proberen.",
    "Koppel het doel aan herkenbare klasactiviteiten en observeer telkens wat de leerling al zonder hulp kan.",
    "Plan herhaling op verschillende momenten, zodat het gedrag of inzicht stabieler wordt.",
  ].filter(Boolean);
  const focus = goal.cluster ? `Focus binnen dit cluster: ${goal.cluster}.` : "";
  return `${kern.join(" ")} ${focus}`.trim();
}

function parseVocabList(text) {
  return String(text || "")
    .split(/[,\n;]+/)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => isChildFriendlyWord(w));
}

function normalizedStem(word) {
  let w = String(word || "").toLowerCase().trim();
  if (!w) return "";
  w = w.replace(/[^a-zà-ÿ0-9-]/gi, "");
  if (w.length > 4 && w.endsWith("en")) w = w.slice(0, -2);
  else if (w.length > 4 && w.endsWith("s")) w = w.slice(0, -1);
  else if (w.length > 4 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

function extractGoalTerms(goal) {
  return pickTopWords([goal.leerplandoel, goal.voorbeelden], 24);
}

function isRelatedToGoal(term, goalTerms) {
  const stem = normalizedStem(term);
  if (!stem) return false;
  return goalTerms.some((t) => {
    const ts = normalizedStem(t);
    return ts && (ts === stem || ts.includes(stem) || stem.includes(ts));
  });
}

function generateWoordenschatSuggestion(goal) {
  const ownVocab = parseVocabList(goal.woordenschat);
  if (ownVocab.length) return uniq(ownVocab).slice(0, 10).join(", ");

  if (!state.suggestionIndex) return "";
  const candidates = [];
  const addFrom = (list) => {
    (list || []).forEach((g) => {
      if (!g || g.id === goal.id) return;
      parseVocabList(g.woordenschat).forEach((w) => {
        if (isChildFriendlyWord(w)) candidates.push(w);
      });
    });
  };

  const mdKey = `${goal.vak}::${goal.md || ""}`;
  const nrmdKey = `${goal.vak}::${goal.nrmd || ""}`;
  const codeParts = String(goal.code || "").split(".");
  const codeStem = codeParts.length > 1 ? codeParts.slice(0, -1).join(".") : String(goal.code || "");
  const codeKey = `${goal.vak}::${codeStem}`;
  const clusterSubKey = `${goal.vak}::${goal.subdomein || ""}::${goal.cluster || ""}`;
  const subKey = `${goal.vak}::${goal.subdomein || ""}`;
  const clusterKey = `${goal.vak}::${goal.cluster || ""}`;

  // Van meest naar minst verwant, allemaal binnen hetzelfde vak.
  addFrom(state.suggestionIndex.byNrmd.get(nrmdKey));
  addFrom(state.suggestionIndex.byMd.get(mdKey));
  addFrom(state.suggestionIndex.byCodeStem.get(codeKey));
  addFrom(state.suggestionIndex.byClusterSub.get(clusterSubKey));
  addFrom(state.suggestionIndex.bySubdomein.get(subKey));
  addFrom(state.suggestionIndex.byCluster.get(clusterKey));

  const merged = uniq(candidates).slice(0, 10);
  if (!merged.length) return "";
  return merged.join(", ");
}

function generateAISuggestion(goal, field) {
  if (field === "voorbeelden") return generateVoorbeeldenSuggestion(goal);
  if (field === "woordenschat") return generateWoordenschatSuggestion(goal);
  return generateToelichtingSuggestion(goal);
}

function getActiveFilters() {
  return {
    q: els.searchInput.value.trim().toLowerCase(),
    vak: [...state.filters.vak],
    fase: [...state.filters.fase],
    domein: [...state.filters.domein],
    subdomein: [...state.filters.subdomein],
    cluster: [...state.filters.cluster],
    doelsoort: [...state.filters.doelsoort],
  };
}

function matchesFilters(d, f, ignoreKey = null) {
  if (ignoreKey !== "vak" && f.vak.length && !f.vak.includes(d.vak)) return false;
  if (ignoreKey !== "fase" && f.fase.length && !f.fase.includes(d.fase)) return false;
  if (ignoreKey !== "domein" && f.domein.length && !f.domein.includes(d.domein)) return false;
  if (ignoreKey !== "subdomein" && f.subdomein.length && !f.subdomein.includes(d.subdomein)) return false;
  if (ignoreKey !== "cluster" && f.cluster.length && !f.cluster.includes(d.cluster)) return false;
  if (ignoreKey !== "doelsoort" && f.doelsoort.length && !f.doelsoort.includes(d.doelsoort)) return false;

  if (f.q) {
    const haystack = [d.code, d.domein, d.subdomein, d.cluster, d.leerplandoel, d.voorbeelden, d.extra_toelichting, d.woordenschat]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(f.q)) return false;
  }

  return true;
}

function dropdownSummary(key, allLabel) {
  const selected = state.filters[key];
  if (!selected.length) return allLabel;
  if (selected.length <= 2) return selected.join(", ");
  return `${selected.length} geselecteerd`;
}

function closeAllDropdowns(exceptKey = null) {
  FILTER_DEFS.forEach((def) => {
    if (def.key === exceptKey) return;
    const root = document.getElementById(def.el);
    root.classList.remove("open");
  });
}

function renderDropdown(def) {
  const root = document.getElementById(def.el);
  const options = state.availableOptions[def.key] || [];
  const selected = state.filters[def.key] || [];

  root.innerHTML = `
    <button type="button" class="dropdown-toggle" aria-haspopup="listbox" aria-expanded="false">
      <span class="dropdown-label">${dropdownSummary(def.key, def.allLabel)}</span>
      <span class="dropdown-arrow">▾</span>
    </button>
    <div class="dropdown-menu" role="listbox" aria-multiselectable="true"></div>
  `;

  const toggle = root.querySelector(".dropdown-toggle");
  const menu = root.querySelector(".dropdown-menu");

  if (!options.length) {
    menu.innerHTML = '<div class="dropdown-empty">Geen opties beschikbaar</div>';
  } else {
    options.forEach((option) => {
      const value = option.value;
      const row = document.createElement("label");
      row.className = "dropdown-option";

      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = value;
      input.checked = selected.includes(value);

      const text = document.createElement("span");
      text.textContent = value;

      const count = document.createElement("span");
      count.className = "option-count";
      count.textContent = String(option.count);

      input.addEventListener("change", () => {
        const current = new Set(state.filters[def.key]);
        if (input.checked) current.add(value);
        else current.delete(value);
        state.filters[def.key] = [...current];
        applyFilters();
      });

      row.appendChild(input);
      row.appendChild(text);
      row.appendChild(count);
      menu.appendChild(row);
    });
  }

  toggle.addEventListener("click", () => {
    const willOpen = !root.classList.contains("open");
    closeAllDropdowns(def.key);
    root.classList.toggle("open", willOpen);
    toggle.setAttribute("aria-expanded", String(willOpen));
  });
}

function refreshFilterOptions(filters) {
  FILTER_DEFS.forEach((def) => {
    const candidates = state.doelen.filter((d) => matchesFilters(d, filters, def.key));
    const counts = new Map();
    candidates.forEach((d) => {
      const value = d[def.prop];
      if (!value) return;
      counts.set(value, (counts.get(value) || 0) + 1);
    });

    const options = [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], "nl"))
      .map(([value, count]) => ({ value, count }));

    state.availableOptions[def.key] = options;
    const availableValues = new Set(options.map((o) => o.value));
    state.filters[def.key] = state.filters[def.key].filter((value) => availableValues.has(value));
    renderDropdown(def);
  });
}

function applyFilters() {
  let f = getActiveFilters();
  refreshFilterOptions(f);
  f = getActiveFilters();
  state.filtered = state.doelen.filter((d) => matchesFilters(d, f));

  if (!state.filtered.some((d) => d.rowKey === state.selectedId)) {
    state.selectedId = state.filtered[0]?.rowKey || null;
  }

  render();
}

function renderFilterChips(filters) {
  els.activeFilters.innerHTML = "";
  const entries = Object.entries(filters).filter(([, value]) => {
    if (Array.isArray(value)) return value.length > 0;
    return Boolean(value);
  });

  const filterLabel = (key) => {
    if (key === "vak") return "Discipline";
    return key;
  };

  function makeChip(key, value) {
    const chip = document.createElement("span");
    chip.className = "chip removable";

    const text = document.createElement("span");
    text.textContent = `${filterLabel(key)}: ${value}`;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "chip-remove";
    removeBtn.textContent = "×";
    removeBtn.title = "Filter verwijderen";
    removeBtn.setAttribute("aria-label", "Filter verwijderen");
    removeBtn.addEventListener("click", () => {
      if (key === "q") {
        els.searchInput.value = "";
      } else if (Array.isArray(state.filters[key])) {
        state.filters[key] = state.filters[key].filter((entry) => entry !== value);
      }
      applyFilters();
    });

    chip.appendChild(text);
    chip.appendChild(removeBtn);
    els.activeFilters.appendChild(chip);
  }

  entries.forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        makeChip(key, entry);
      });
    } else {
      makeChip(key, value);
    }
  });
}

function removeGoalFromSelection(rowKey) {
  state.selection = state.selection.filter((key) => key !== rowKey);
}

function toggleGoalSelection(rowKey) {
  if (state.selection.includes(rowKey)) {
    removeGoalFromSelection(rowKey);
  } else {
    state.selection.push(rowKey);
  }
}

function addAllFilteredToSelection() {
  if (!state.filtered.length) return;
  const selectionSet = new Set(state.selection);
  state.filtered.forEach((goal) => {
    if (!selectionSet.has(goal.rowKey)) {
      selectionSet.add(goal.rowKey);
    }
  });
  state.selection = [...selectionSet];
}

function renderResults() {
  const selectedSet = new Set(state.selection);
  let selectedInFiltered = 0;
  state.filtered.forEach((goal) => {
    if (selectedSet.has(goal.rowKey)) selectedInFiltered += 1;
  });
  const remainingInFiltered = Math.max(0, state.filtered.length - selectedInFiltered);

  els.resultCount.textContent = `${state.filtered.length} resultaten`;
  els.selectedCountTop.textContent = `${state.selection.length} geselecteerd`;
  if (els.addAllResultsBtn) {
    els.addAllResultsBtn.disabled = remainingInFiltered <= 0;
    els.addAllResultsBtn.textContent =
      state.filtered.length > 0
        ? `Voeg alle resultaten toe (${state.filtered.length})`
        : "Geen resultaten";
    els.addAllResultsBtn.title =
      remainingInFiltered > 0
        ? `${remainingInFiltered} leerdoelen toevoegen aan selectie`
        : "Alle resultaten zitten al in de selectie";
  }
  els.resultList.innerHTML = "";

  const list = state.filtered.slice(0, 400);
  list.forEach((d) => {
    const card = document.createElement("article");
    card.className = `result-item ${d.rowKey === state.selectedId ? "active" : ""}`;
    const isSelected = selectedSet.has(d.rowKey);
    const btnClass = isSelected ? "select-btn selected" : "select-btn";
    const btnLabel = isSelected ? "🗑" : "+";
    const btnTitle = isSelected ? "Verwijder uit selectie" : "Voeg toe aan selectie";
    card.innerHTML = `
      <div class="result-item-head">
        <h3>${d.leerplandoel}</h3>
        <button type="button" class="${btnClass}" title="${btnTitle}" aria-label="${btnTitle}">${btnLabel}</button>
      </div>
      <div class="meta-row">
        <span class="meta-tag">${d.vak}</span>
        <span class="meta-tag">${d.fase || "-"}</span>
        <span class="meta-tag">${d.domein || "-"}</span>
      </div>
    `;

    const selectBtn = card.querySelector(".select-btn");
    selectBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleGoalSelection(d.rowKey);
      render();
    });

    card.addEventListener("click", () => {
      state.selectedId = d.rowKey;
      render();
    });
    els.resultList.appendChild(card);
  });

  if (state.filtered.length > 400) {
    const note = document.createElement("p");
    note.className = "placeholder";
    note.textContent = `Eerste 400 van ${state.filtered.length} resultaten getoond. Verfijn je filters.`;
    els.resultList.appendChild(note);
  }
}

function resourcesForVak(vak) {
  return state.bronnen.filter((b) => b.vak === vak);
}

function getOriginalField(goal, field) {
  if (field === "toelichting") return (goal.extra_toelichting || goal.toelichting || "").trim();
  if (field === "woordenschat") return (goal.woordenschat || "").trim();
  return (goal[field] || "").trim();
}

function getEffectiveField(goalId, goal, field) {
  const note = state.userNotes[goalId];
  if (note && Object.prototype.hasOwnProperty.call(note, field)) {
    return String(note[field] ?? "");
  }
  return getOriginalField(goal, field);
}

function getEditorState(goalId, field, effective) {
  if (!state.detailEditors[goalId]) state.detailEditors[goalId] = {};
  if (!state.detailEditors[goalId][field]) {
    state.detailEditors[goalId][field] = { editing: false, draft: effective };
  }
  return state.detailEditors[goalId][field];
}

function isFieldChanged(goalId, goal, field, editing = false, editorKey = goalId) {
  const original = getOriginalField(goal, field);
  if (editing) {
    const draft = state.detailEditors[editorKey]?.[field]?.draft || "";
    return draft.trim() !== original;
  }
  return getEffectiveField(goalId, goal, field).trim() !== original;
}

function formatMultiline(value) {
  return escapeHtml(String(value || "")).replaceAll("\n", "<br>");
}

function renderDetail() {
  const item = state.filtered.find((d) => d.rowKey === state.selectedId);
  if (!item) {
    els.detailView.innerHTML = '<p class="placeholder">Geen resultaat voor de huidige filters.</p>';
    return;
  }
  const editorKey = item.rowKey;
  const noteKey = item.id;
  const canEdit = canEditNotes();
  const effectiveVoorbeelden = getEffectiveField(noteKey, item, "voorbeelden");
  const effectiveToelichting = getEffectiveField(noteKey, item, "toelichting");
  const effectiveWoordenschat = getEffectiveField(noteKey, item, "woordenschat");
  const voorbeeldenState = getEditorState(editorKey, "voorbeelden", effectiveVoorbeelden);
  const toelichtingState = getEditorState(editorKey, "toelichting", effectiveToelichting);
  const woordenschatState = getEditorState(editorKey, "woordenschat", effectiveWoordenschat);
  if (!canEdit) {
    voorbeeldenState.editing = false;
    toelichtingState.editing = false;
    woordenschatState.editing = false;
  }
  if (!voorbeeldenState.editing) voorbeeldenState.draft = effectiveVoorbeelden;
  if (!toelichtingState.editing) toelichtingState.draft = effectiveToelichting;
  if (!woordenschatState.editing) woordenschatState.draft = effectiveWoordenschat;

  const voorbeeldenChanged = isFieldChanged(noteKey, item, "voorbeelden", voorbeeldenState.editing, editorKey);
  const toelichtingChanged = isFieldChanged(noteKey, item, "toelichting", toelichtingState.editing, editorKey);
  const woordenschatChanged = isFieldChanged(noteKey, item, "woordenschat", woordenschatState.editing, editorKey);
  const voorbeeldenRefreshClass = canEdit && voorbeeldenChanged ? "mini-icon-btn" : "mini-icon-btn hidden";
  const toelichtingRefreshClass = canEdit && toelichtingChanged ? "mini-icon-btn" : "mini-icon-btn hidden";
  const woordenschatRefreshClass = canEdit && woordenschatChanged ? "mini-icon-btn" : "mini-icon-btn hidden";
  const voorbeeldenPrimary = voorbeeldenState.editing ? "💾" : "✏️";
  const toelichtingPrimary = toelichtingState.editing ? "💾" : "✏️";
  const woordenschatPrimary = woordenschatState.editing ? "💾" : "✏️";
  const voorbeeldenPrimaryTitle = canEdit
    ? voorbeeldenState.editing
      ? "Bewaar voorbeelden"
      : "Bewerk voorbeelden"
    : "Login vereist om voorbeelden te bewerken";
  const toelichtingPrimaryTitle = canEdit
    ? toelichtingState.editing
      ? "Bewaar toelichting"
      : "Bewerk toelichting"
    : "Login vereist om toelichting te bewerken";
  const woordenschatPrimaryTitle = canEdit
    ? woordenschatState.editing
      ? "Bewaar woordenschat"
      : "Bewerk woordenschat"
    : "Login vereist om woordenschat te bewerken";
  const editBtnClass = canEdit ? "mini-icon-btn" : "mini-icon-btn is-disabled";
  const editBtnDisabledAttr = canEdit ? "" : "disabled";
  const readOnlyHint = canEdit
    ? ""
    : '<p class="placeholder lock-note">Log in om inhoud aan te passen.</p>';

  const resources = resourcesForVak(item.vak);
  const resourceHtml = resources.length
    ? `<ul class="resource-list">${resources
        .map((r) => `<li><a href="${encodeURI(r.url)}" target="_blank" rel="noreferrer">${r.titel}</a> (${r.grootte_kb} KB)</li>`)
        .join("")}</ul>`
    : '<p class="placeholder">Geen gekoppelde PDF-bronnen.</p>';

  els.detailView.innerHTML = `
    <h2>${item.leerplandoel}</h2>
    <div class="meta-row">
      <span class="meta-tag">${item.vak}</span>
      <span class="meta-tag">${item.doelsoort || "-"}</span>
      <span class="meta-tag">${item.fase || "-"}</span>
    </div>
    ${readOnlyHint}

    <section class="detail-block">
      <h4>Structuur</h4>
      <p><strong>Domein:</strong> ${item.domein || "-"}</p>
      <p><strong>Subdomein:</strong> ${item.subdomein || "-"}</p>
      <p><strong>Cluster:</strong> ${item.cluster || "-"}</p>
    </section>

    <section class="detail-block">
      <div class="detail-head">
        <h4>Voorbeelden</h4>
        <div class="detail-actions">
          <button id="toggleVoorbeeldenBtn" class="${editBtnClass}" type="button" title="${voorbeeldenPrimaryTitle}" aria-label="${voorbeeldenPrimaryTitle}" ${editBtnDisabledAttr}>${voorbeeldenPrimary}</button>
          <button id="resetVoorbeeldenBtn" class="${voorbeeldenRefreshClass}" type="button" title="Herstel originele voorbeelden" aria-label="Herstel originele voorbeelden">↻</button>
        </div>
      </div>
      ${
        canEdit && voorbeeldenState.editing
          ? `<textarea id="editVoorbeelden" class="inline-edit" rows="4" placeholder="Geen voorbeeld opgegeven.">${escapeHtml(voorbeeldenState.draft)}</textarea>`
          : `<p class="rich-text">${formatMultiline(effectiveVoorbeelden || "Geen voorbeeld opgegeven.")}</p>`
      }
    </section>

    <section class="detail-block">
      <div class="detail-head">
        <h4>Extra toelichting (voor leerkracht)</h4>
        <div class="detail-actions">
          <button id="toggleToelichtingBtn" class="${editBtnClass}" type="button" title="${toelichtingPrimaryTitle}" aria-label="${toelichtingPrimaryTitle}" ${editBtnDisabledAttr}>${toelichtingPrimary}</button>
          <button id="resetToelichtingBtn" class="${toelichtingRefreshClass}" type="button" title="Herstel originele toelichting" aria-label="Herstel originele toelichting">↻</button>
        </div>
      </div>
      ${
        canEdit && toelichtingState.editing
          ? `<textarea id="editToelichting" class="inline-edit" rows="4" placeholder="Geen extra toelichting opgegeven.">${escapeHtml(toelichtingState.draft)}</textarea>`
          : `<p class="rich-text">${formatMultiline(effectiveToelichting || "Geen extra toelichting opgegeven.")}</p>`
      }
    </section>

    <section class="detail-block">
      <div class="detail-head">
        <h4>Woordenschat (voor kinderen)</h4>
        <div class="detail-actions">
          <button id="toggleWoordenschatBtn" class="${editBtnClass}" type="button" title="${woordenschatPrimaryTitle}" aria-label="${woordenschatPrimaryTitle}" ${editBtnDisabledAttr}>${woordenschatPrimary}</button>
          <button id="resetWoordenschatBtn" class="${woordenschatRefreshClass}" type="button" title="Herstel originele woordenschat" aria-label="Herstel originele woordenschat">↻</button>
        </div>
      </div>
      ${
        canEdit && woordenschatState.editing
          ? `<textarea id="editWoordenschat" class="inline-edit" rows="3" placeholder="Geen woordenschat opgegeven.">${escapeHtml(woordenschatState.draft)}</textarea>`
          : `<p>${escapeHtml(effectiveWoordenschat || "Geen woordenschat opgegeven.")}</p>`
      }
    </section>

    <section class="detail-block">
      <h4>Bronnen en visieteksten (${item.vak})</h4>
      ${resourceHtml}
    </section>
  `;
  bindDetailEditors(item.rowKey);
}

function bindDetailEditors(goalKey) {
  const base = state.doelMap.get(goalKey);
  if (!base) return;
  if (!canEditNotes()) return;
  const noteKey = base.id;
  const toggleVoorbeeldenBtn = document.getElementById("toggleVoorbeeldenBtn");
  const toggleToelichtingBtn = document.getElementById("toggleToelichtingBtn");
  const toggleWoordenschatBtn = document.getElementById("toggleWoordenschatBtn");
  const resetVoorbeeldenBtn = document.getElementById("resetVoorbeeldenBtn");
  const resetToelichtingBtn = document.getElementById("resetToelichtingBtn");
  const resetWoordenschatBtn = document.getElementById("resetWoordenschatBtn");
  const voorbeeldenEl = document.getElementById("editVoorbeelden");
  const toelichtingEl = document.getElementById("editToelichting");
  const woordenschatEl = document.getElementById("editWoordenschat");

  const setFieldValue = (field, value) => {
    if (!state.userNotes[noteKey]) state.userNotes[noteKey] = {};
    state.userNotes[noteKey][field] = value.trim();
    const note = state.userNotes[noteKey];
    const effectiveNote = {
      voorbeelden: Object.prototype.hasOwnProperty.call(note, "voorbeelden")
        ? String(note.voorbeelden ?? "")
        : getOriginalField(base, "voorbeelden"),
      toelichting: Object.prototype.hasOwnProperty.call(note, "toelichting")
        ? String(note.toelichting ?? "")
        : getOriginalField(base, "toelichting"),
      woordenschat: Object.prototype.hasOwnProperty.call(note, "woordenschat")
        ? String(note.woordenschat ?? "")
        : getOriginalField(base, "woordenschat"),
    };
    if (
      effectiveNote.voorbeelden === getOriginalField(base, "voorbeelden") &&
      effectiveNote.toelichting === getOriginalField(base, "toelichting") &&
      effectiveNote.woordenschat === getOriginalField(base, "woordenschat")
    ) {
      delete state.userNotes[noteKey];
    }
  };

  if (toggleVoorbeeldenBtn) {
    toggleVoorbeeldenBtn.addEventListener("click", async () => {
      const editor = getEditorState(goalKey, "voorbeelden", getEffectiveField(noteKey, base, "voorbeelden"));
      if (!editor.editing) {
        editor.editing = true;
        editor.draft = getEffectiveField(noteKey, base, "voorbeelden");
        renderDetail();
      } else {
        const beforeText = getEffectiveField(noteKey, base, "voorbeelden");
        const afterText = String(editor.draft || "").trim();
        setFieldValue("voorbeelden", editor.draft);
        const saved = await saveSharedOverride(noteKey, state.userNotes[noteKey] || null, {
          goalTitle: base.leerplandoel,
          goalCode: base.code,
          changes: [{ field: "voorbeelden", beforeText, afterText }],
        });
        if (saved) {
          editor.editing = false;
        }
        render();
      }
    });
  }

  if (toggleToelichtingBtn) {
    toggleToelichtingBtn.addEventListener("click", async () => {
      const editor = getEditorState(goalKey, "toelichting", getEffectiveField(noteKey, base, "toelichting"));
      if (!editor.editing) {
        editor.editing = true;
        editor.draft = getEffectiveField(noteKey, base, "toelichting");
        renderDetail();
      } else {
        const beforeText = getEffectiveField(noteKey, base, "toelichting");
        const afterText = String(editor.draft || "").trim();
        setFieldValue("toelichting", editor.draft);
        const saved = await saveSharedOverride(noteKey, state.userNotes[noteKey] || null, {
          goalTitle: base.leerplandoel,
          goalCode: base.code,
          changes: [{ field: "toelichting", beforeText, afterText }],
        });
        if (saved) {
          editor.editing = false;
        }
        render();
      }
    });
  }

  if (toggleWoordenschatBtn) {
    toggleWoordenschatBtn.addEventListener("click", async () => {
      const editor = getEditorState(goalKey, "woordenschat", getEffectiveField(noteKey, base, "woordenschat"));
      if (!editor.editing) {
        editor.editing = true;
        editor.draft = getEffectiveField(noteKey, base, "woordenschat");
        renderDetail();
      } else {
        const beforeText = getEffectiveField(noteKey, base, "woordenschat");
        const afterText = String(editor.draft || "").trim();
        setFieldValue("woordenschat", editor.draft);
        const saved = await saveSharedOverride(noteKey, state.userNotes[noteKey] || null, {
          goalTitle: base.leerplandoel,
          goalCode: base.code,
          changes: [{ field: "woordenschat", beforeText, afterText }],
        });
        if (saved) {
          editor.editing = false;
        }
        render();
      }
    });
  }

  if (resetVoorbeeldenBtn) {
    resetVoorbeeldenBtn.addEventListener("click", async () => {
      const editor = getEditorState(goalKey, "voorbeelden", getEffectiveField(noteKey, base, "voorbeelden"));
      const beforeText = getEffectiveField(noteKey, base, "voorbeelden");
      const afterText = getOriginalField(base, "voorbeelden");
      editor.draft = getOriginalField(base, "voorbeelden");
      setFieldValue("voorbeelden", getOriginalField(base, "voorbeelden"));
      const saved = await saveSharedOverride(noteKey, state.userNotes[noteKey] || null, {
        goalTitle: base.leerplandoel,
        goalCode: base.code,
        changes: [{ field: "voorbeelden", beforeText, afterText }],
      });
      if (saved) {
        editor.editing = false;
        render();
      }
    });
  }

  if (resetToelichtingBtn) {
    resetToelichtingBtn.addEventListener("click", async () => {
      const editor = getEditorState(goalKey, "toelichting", getEffectiveField(noteKey, base, "toelichting"));
      const beforeText = getEffectiveField(noteKey, base, "toelichting");
      const afterText = getOriginalField(base, "toelichting");
      editor.draft = getOriginalField(base, "toelichting");
      setFieldValue("toelichting", getOriginalField(base, "toelichting"));
      const saved = await saveSharedOverride(noteKey, state.userNotes[noteKey] || null, {
        goalTitle: base.leerplandoel,
        goalCode: base.code,
        changes: [{ field: "toelichting", beforeText, afterText }],
      });
      if (saved) {
        editor.editing = false;
        render();
      }
    });
  }

  if (resetWoordenschatBtn) {
    resetWoordenschatBtn.addEventListener("click", async () => {
      const editor = getEditorState(goalKey, "woordenschat", getEffectiveField(noteKey, base, "woordenschat"));
      const beforeText = getEffectiveField(noteKey, base, "woordenschat");
      const afterText = getOriginalField(base, "woordenschat");
      editor.draft = getOriginalField(base, "woordenschat");
      setFieldValue("woordenschat", getOriginalField(base, "woordenschat"));
      const saved = await saveSharedOverride(noteKey, state.userNotes[noteKey] || null, {
        goalTitle: base.leerplandoel,
        goalCode: base.code,
        changes: [{ field: "woordenschat", beforeText, afterText }],
      });
      if (saved) {
        editor.editing = false;
        render();
      }
    });
  }

  if (voorbeeldenEl) {
    voorbeeldenEl.addEventListener("input", () => {
      state.detailEditors[goalKey].voorbeelden.draft = voorbeeldenEl.value;
      const original = getOriginalField(base, "voorbeelden");
      resetVoorbeeldenBtn?.classList.toggle("hidden", voorbeeldenEl.value.trim() === original);
    });
  }

  if (toelichtingEl) {
    toelichtingEl.addEventListener("input", () => {
      state.detailEditors[goalKey].toelichting.draft = toelichtingEl.value;
      const original = getOriginalField(base, "toelichting");
      resetToelichtingBtn?.classList.toggle("hidden", toelichtingEl.value.trim() === original);
    });
  }

  if (woordenschatEl) {
    woordenschatEl.addEventListener("input", () => {
      state.detailEditors[goalKey].woordenschat.draft = woordenschatEl.value;
      const original = getOriginalField(base, "woordenschat");
      resetWoordenschatBtn?.classList.toggle("hidden", woordenschatEl.value.trim() === original);
    });
  }
}

function renderSelection() {
  els.selectionCount.textContent = `${state.selection.length} items`;
  els.exportSelectionBtn.disabled = !state.selection.length;
  els.exportSelectionBtn.title = "Exporteer naar .txt";
  if (els.exportSelectionDocsBtn) {
    if (!state.selection.length) {
      els.exportSelectionDocsBtn.disabled = true;
      els.exportSelectionDocsBtn.title = "Selecteer eerst minstens 1 leerdoel";
    } else if (!state.auth.authenticated) {
      els.exportSelectionDocsBtn.disabled = true;
      els.exportSelectionDocsBtn.title = "Log in om naar Google Docs te exporteren";
    } else {
      els.exportSelectionDocsBtn.disabled = false;
      els.exportSelectionDocsBtn.title = "Exporteer naar Google Docs";
    }
  }
  els.selectionList.innerHTML = "";

  if (!state.selection.length) {
    els.selectionList.innerHTML = '<p class="placeholder">Nog geen doelen toegevoegd aan de selectie.</p>';
    return;
  }

  if (state.selection.length > MAX_VISIBLE_SELECTION_ITEMS) {
    els.selectionList.innerHTML = "<p class=\"placeholder\">meer dan 25 leerdoelen geselecteerd</p>";
    return;
  }

  const fragment = document.createDocumentFragment();
  const visibleSelectionKeys = state.selection.slice(0, MAX_VISIBLE_SELECTION_ITEMS);

  visibleSelectionKeys.forEach((rowKey) => {
    const goal = state.doelMap.get(rowKey);
    if (!goal) return;

    const row = document.createElement("div");
    row.className = "selection-item";

    const body = document.createElement("div");
    body.className = "selection-item-body";

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "selection-open-btn";
    openBtn.textContent = goal.leerplandoel;
    openBtn.addEventListener("click", () => {
      state.selectedId = goal.rowKey;
      render();
    });

    const meta = document.createElement("p");
    meta.textContent = `${goal.vak} • ${goal.fase || "-"}`;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "selection-remove-btn";
    removeBtn.textContent = "🗑";
    removeBtn.title = "Verwijder uit selectie";
    removeBtn.setAttribute("aria-label", "Verwijder uit selectie");
    removeBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      removeGoalFromSelection(goal.rowKey);
      render();
    });

    body.appendChild(openBtn);
    body.appendChild(meta);
    row.appendChild(body);
    row.appendChild(removeBtn);
    fragment.appendChild(row);
  });

  els.selectionList.appendChild(fragment);
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

  if (log.actionType === "revert_version") {
    return `
      <p><strong>Doel:</strong> ${escapeHtml(log.goalTitle || log.goalId || "-")}</p>
      <p><strong>Hersteld vanaf log:</strong> #${escapeHtml(String(metadata.reverted_log_id || "-"))}</p>
    `;
  }

  return `<pre class="admin-log-text">${escapeHtml(JSON.stringify(metadata, null, 2))}</pre>`;
}

function renderAdminPanel() {
  if (!els.adminPanel) return;
  if (!isAdminUser()) {
    els.adminPanel.classList.add("hidden");
    return;
  }

  els.adminPanel.classList.remove("hidden");

  if (els.adminAccountsList) {
    if (state.admin.loading) {
      els.adminAccountsList.innerHTML = '<p class="placeholder">Admin-data laden...</p>';
    } else if (!state.admin.allowedEmails.length) {
      els.adminAccountsList.innerHTML = '<p class="placeholder">Geen accounts gevonden.</p>';
    } else {
      const ownEmail = String(state.auth.user?.email || "").toLowerCase();
      els.adminAccountsList.innerHTML = state.admin.allowedEmails
        .map((email) => {
          const canRemove = email && email !== ownEmail && email !== state.admin.adminEmail;
          return `
            <div class="admin-account-row">
              <span>${escapeHtml(email)}</span>
              ${
                canRemove
                  ? `<button type="button" class="mini-danger-btn" data-remove-email="${escapeHtml(email)}" aria-label="Verwijder ${escapeHtml(email)}">🗑</button>`
                  : `<span class="admin-account-lock">behouden</span>`
              }
            </div>
          `;
        })
        .join("");
    }
  }

  if (els.adminLogsList) {
    if (state.admin.loading) {
      els.adminLogsList.innerHTML = '<p class="placeholder">Logs laden...</p>';
    } else if (!state.admin.logs.length) {
      els.adminLogsList.innerHTML = '<p class="placeholder">Nog geen log-items.</p>';
    } else {
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
  }
}

async function adminRefreshAll() {
  await loadAdminData();
  render();
}

async function adminAddEmail() {
  if (!isAdminUser()) return;
  const email = String(els.adminNewEmailInput?.value || "").trim().toLowerCase();
  if (!email) return;
  try {
    await apiFetchJson("/api/admin/access", {
      method: "POST",
      body: { email },
    });
    if (els.adminNewEmailInput) els.adminNewEmailInput.value = "";
    await adminRefreshAll();
  } catch (err) {
    console.error("Toevoegen account mislukt", err);
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
    console.error("Verwijderen account mislukt", err);
    alert(err.message || "Verwijderen van account mislukt.");
  }
}

async function adminRevertLog(logId) {
  if (!isAdminUser()) return;
  try {
    await apiFetchJson("/api/admin/revert", {
      method: "POST",
      body: { logId },
    });
    await loadSharedOverrides();
    await loadAdminData();
    render();
  } catch (err) {
    console.error("Herstellen van versie mislukt", err);
    alert(err.message || "Herstellen van versie mislukt.");
  }
}

function getGoalExportFields(goal) {
  const own = state.userNotes[goal.id];
  return {
    voorbeelden:
      own && Object.prototype.hasOwnProperty.call(own, "voorbeelden")
        ? String(own.voorbeelden ?? "")
        : goal.voorbeelden || "",
    toelichting:
      own && Object.prototype.hasOwnProperty.call(own, "toelichting")
        ? String(own.toelichting ?? "")
        : goal.extra_toelichting || goal.toelichting || "",
    woordenschat:
      own && Object.prototype.hasOwnProperty.call(own, "woordenschat")
        ? String(own.woordenschat ?? "")
        : goal.woordenschat || "",
  };
}

function buildSelectionExportPayload(extra = {}) {
  const items = state.selection
    .map((rowKey) => state.doelMap.get(rowKey))
    .filter(Boolean)
    .map((goal) => {
      const fields = getGoalExportFields(goal);
      return {
        goalId: goal.id,
        leerplandoel: goal.leerplandoel,
        vak: goal.vak,
        fase: goal.fase || "-",
        domein: goal.domein || "-",
        subdomein: goal.subdomein || "-",
        cluster: goal.cluster || "-",
        voorbeelden: fields.voorbeelden || "",
        toelichting: fields.toelichting || "",
        woordenschat: fields.woordenschat || "",
      };
    });

  return {
    count: items.length,
    items,
    ...extra,
  };
}

async function logExportActivity(actionType, payload) {
  if (!state.auth.authenticated) return;
  try {
    await apiFetchJson("/api/activity", {
      method: "POST",
      body: {
        actionType,
        payload,
      },
    });
  } catch (err) {
    console.error("Kon export-activiteit niet loggen", err);
  }
}

async function requestDocsDriveAccessToken() {
  if (
    state.auth.googleDocsAccessToken &&
    state.auth.googleDocsAccessTokenExpiresAt > Date.now() + 60 * 1000
  ) {
    return state.auth.googleDocsAccessToken;
  }

  return new Promise((resolve) => {
    const oauth2 = window.google?.accounts?.oauth2;
    if (!state.auth.googleClientId || !oauth2?.initTokenClient) {
      resolve("");
      return;
    }

    const client = oauth2.initTokenClient({
      client_id: state.auth.googleClientId,
      scope: GOOGLE_DOCS_DRIVE_SCOPES.join(" "),
      include_granted_scopes: true,
      callback: (tokenResponse) => {
        if (tokenResponse?.error) {
          resolve("");
          return;
        }
        const granted = hasAllGrantedScopes(tokenResponse, GOOGLE_DOCS_DRIVE_SCOPES);
        if (!granted || !tokenResponse?.access_token) {
          resolve("");
          return;
        }
        state.auth.docsScopesGranted = true;
        state.auth.googleDocsAccessToken = String(tokenResponse.access_token);
        state.auth.googleDocsAccessTokenExpiresAt =
          Date.now() + Number(tokenResponse.expires_in || 0) * 1000;
        resolve(state.auth.googleDocsAccessToken);
      },
      error_callback: () => resolve(""),
    });

    try {
      client.requestAccessToken({
        prompt: "",
        hint: state.auth.user?.email || undefined,
      });
    } catch (err) {
      console.error("Kon Google access token niet ophalen", err);
      resolve("");
    }
  });
}

function buildSelectionDocsContent() {
  const now = new Date();
  const generatedAt = now.toLocaleString("nl-BE");
  const fileName = `Selectie leerdoelen ${now.toISOString().slice(0, 10)}`;
  let text = "";
  let cursor = 1;
  const headingRanges = [];
  const boldRanges = [];

  function push(raw) {
    const value = String(raw);
    const startIndex = cursor;
    text += value;
    cursor += value.length;
    return { startIndex, endIndex: cursor };
  }

  function pushHeading(line, namedStyleType) {
    const range = push(`${line}\n`);
    headingRanges.push({ ...range, namedStyleType });
  }

  function pushLabelLine(label, value) {
    const labelRange = push(`${label}: `);
    boldRanges.push(labelRange);
    push(`${value}\n`);
  }

  function pushFieldBlock(label, value) {
    const clean = String(value || "").trim();
    if (!clean) return;
    const labelRange = push(`${label}:\n`);
    boldRanges.push({ startIndex: labelRange.startIndex, endIndex: labelRange.endIndex - 1 });
    push(`${clean}\n`);
  }

  pushHeading("Selectie leerdoelen", "TITLE");
  pushLabelLine("Aangemaakt op", generatedAt);
  push("\n");

  state.selection.forEach((rowKey, index) => {
    const goal = state.doelMap.get(rowKey);
    if (!goal) return;
    const fields = getGoalExportFields(goal);

    pushHeading(`${index + 1}. ${goal.leerplandoel}`, "HEADING_2");
    pushLabelLine("Discipline", goal.vak || "-");
    pushLabelLine("Fase", goal.fase || "-");
    pushLabelLine("Domein", goal.domein || "-");
    pushLabelLine("Subdomein", goal.subdomein || "-");
    pushLabelLine("Cluster", goal.cluster || "-");
    pushFieldBlock("Voorbeelden", fields.voorbeelden);
    pushFieldBlock("Extra toelichting", fields.toelichting);
    pushFieldBlock("Woordenschat", fields.woordenschat);
    push("\n");
  });

  return { fileName, text, headingRanges, boldRanges };
}

async function createGoogleDocFromSelection() {
  if (!state.selection.length) return;
  if (!state.auth.authenticated) {
    alert("Log in om naar Google Docs te exporteren.");
    return;
  }

  const token = await requestDocsDriveAccessToken();
  if (!token) {
    alert("Kon geen Google Docs-toegang verkrijgen. Log opnieuw in en probeer opnieuw.");
    return;
  }

  const payload = buildSelectionDocsContent();
  try {
    const createRes = await fetch("https://docs.googleapis.com/v1/documents", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: payload.fileName }),
    });
    const createData = await createRes.json();
    if (!createRes.ok) {
      const msg = createData?.error?.message || "Onbekende fout bij aanmaak van Google Doc.";
      throw new Error(msg);
    }

    const docId = String(createData.documentId || "");
    if (!docId) {
      throw new Error("Geen document-ID ontvangen van Google Docs.");
    }

    const requests = [
      {
        insertText: {
          location: { index: 1 },
          text: payload.text,
        },
      },
      ...payload.headingRanges.map((range) => ({
        updateParagraphStyle: {
          range: {
            startIndex: range.startIndex,
            endIndex: range.endIndex,
          },
          paragraphStyle: {
            namedStyleType: range.namedStyleType,
          },
          fields: "namedStyleType",
        },
      })),
      ...payload.boldRanges.map((range) => ({
        updateTextStyle: {
          range: {
            startIndex: range.startIndex,
            endIndex: range.endIndex,
          },
          textStyle: {
            bold: true,
          },
          fields: "bold",
        },
      })),
    ];

    const updateRes = await fetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}:batchUpdate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ requests }),
    });
    const updateData = await updateRes.json();
    if (!updateRes.ok) {
      const msg = updateData?.error?.message || "Opmaak toepassen in Google Doc is mislukt.";
      throw new Error(msg);
    }

    const docUrl = `https://docs.google.com/document/d/${docId}/edit`;
    await logExportActivity("export_docs", buildSelectionExportPayload({ docId, docUrl }));
    window.open(docUrl, "_blank", "noopener,noreferrer");
  } catch (err) {
    console.error("Export naar Google Docs mislukt", err);
    alert(err.message || "Export naar Google Docs is mislukt.");
  }
}

function exportSelectionToTxt() {
  if (!state.selection.length) return;

  const now = new Date();
  const lines = [
    "Selectie leerdoelen",
    `Aangemaakt op: ${now.toLocaleString("nl-BE")}`,
    "",
  ];

  state.selection.forEach((rowKey, index) => {
    const g = state.doelMap.get(rowKey);
    if (!g) return;
    const fields = getGoalExportFields(g);
    lines.push(`${index + 1}. ${g.leerplandoel}`);
    lines.push(`   Discipline: ${g.vak}`);
    lines.push(`   Fase: ${g.fase || "-"}`);
    lines.push(`   Domein: ${g.domein || "-"}`);
    lines.push(`   Subdomein: ${g.subdomein || "-"}`);
    lines.push(`   Cluster: ${g.cluster || "-"}`);
    if (fields.voorbeelden) lines.push(`   Voorbeelden: ${fields.voorbeelden}`);
    if (fields.toelichting) lines.push(`   Extra toelichting: ${fields.toelichting}`);
    if (fields.woordenschat) lines.push(`   Woordenschat: ${fields.woordenschat}`);
    lines.push("");
  });

  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `leerdoelen-selectie-${now.toISOString().slice(0, 10)}.txt`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  void logExportActivity("export_txt", buildSelectionExportPayload());
}

function render() {
  renderFilterChips(getActiveFilters());
  renderResults();
  renderDetail();
  renderSelection();
  renderAdminPanel();
}

function bindEvents() {
  els.searchInput.addEventListener("input", applyFilters);

  els.resetFilters.addEventListener("click", () => {
    els.searchInput.value = "";
    FILTER_DEFS.forEach((def) => {
      state.filters[def.key] = [];
    });
    applyFilters();
  });

  els.exportSelectionBtn.addEventListener("click", exportSelectionToTxt);
  els.exportSelectionDocsBtn?.addEventListener("click", createGoogleDocFromSelection);
  els.addAllResultsBtn?.addEventListener("click", () => {
    addAllFilteredToSelection();
    render();
  });
  els.adminAddEmailBtn?.addEventListener("click", adminAddEmail);
  els.adminRefreshLogsBtn?.addEventListener("click", adminRefreshAll);
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
  els.adminLogsList?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest("[data-revert-log-id]");
    if (!(button instanceof HTMLElement)) return;
    const logIdRaw = button.dataset.revertLogId;
    if (!logIdRaw) return;
    const logId = Number(logIdRaw);
    if (!Number.isFinite(logId) || logId <= 0) return;
    void adminRevertLog(logId);
  });
  els.logoutBtn?.addEventListener("click", logout);
  window.addEventListener("load", () => {
    if (!state.auth.authenticated) {
      scheduleGoogleButtonRender();
    }
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".multi-dropdown")) {
      closeAllDropdowns();
    }
  });
}

async function init() {
  const goalsRes = await fetch("data/goals.json");
  const data = await goalsRes.json();

  state.doelen = withUniqueRowKeys(data.doelen || []);
  state.doelMap = new Map(state.doelen.map((d) => [d.rowKey, d]));
  state.suggestionIndex = buildSuggestionIndex(state.doelen);
  state.bronnen = data.bronnen || [];
  await loadSharedOverrides();
  await loadAuthConfig();
  await refreshSession();
  await loadAdminData();
  updateAuthUi();

  if (els.metaStats) {
    els.metaStats.innerHTML = `
      <strong>${data.meta.aantal}</strong> doelen<br />
      <span>${data.meta.vakken.join(" • ")}</span>
    `;
  }

  bindEvents();
  applyFilters();
}

init().catch((err) => {
  console.error(err);
  els.resultCount.textContent = "Fout bij laden van data";
  els.detailView.innerHTML = '<p class="placeholder">De data kon niet geladen worden.</p>';
});
