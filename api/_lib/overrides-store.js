const EDITABLE_FIELDS = ["voorbeelden", "toelichting", "woordenschat"];
const DEFAULT_ALLOWED_EMAILS = ["goethals@gmail.com", "eva.jacobs@gmail.com"];
const SUPERADMIN_EMAILS = ["eva.jacobs@gmail.com", "goethals@gmail.com"];
const ALLOWED_ACCOUNT_ROLES = new Set(["editor", "admin", "superadmin"]);
const ALLOWED_LOG_ACTIONS = new Set([
  "edit_voorbeelden",
  "edit_toelichting",
  "edit_woordenschat",
  "export_txt",
  "export_docs",
  "access_add",
  "access_remove",
  "access_role_update",
  "revert_version",
]);

let neon = null;
try {
  ({ neon } = require("@neondatabase/serverless"));
} catch {
  neon = null;
}

let ensureSchemaPromise = null;
let neonSql = null;

function resolveDatabaseUrl() {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    ""
  );
}

function hasPostgresConfig() {
  return Boolean(resolveDatabaseUrl());
}

function getSql() {
  if (!neon) return null;
  if (!neonSql) {
    const dbUrl = resolveDatabaseUrl();
    if (!dbUrl) return null;
    neonSql = neon(dbUrl);
  }
  return neonSql;
}

function isPersistentStoreConfigured() {
  return Boolean(getSql() && hasPostgresConfig());
}

function allowMemoryFallback() {
  return process.env.NODE_ENV !== "production" && !process.env.VERCEL;
}

function normalizeEmail(raw) {
  return String(raw || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
}

function getSuperAdminEmailSet() {
  return new Set(SUPERADMIN_EMAILS.map((value) => normalizeEmail(value)).filter((value) => value && isValidEmail(value)));
}

function getSuperAdminEmails() {
  return [...getSuperAdminEmailSet()].sort((a, b) => a.localeCompare(b, "nl"));
}

function isSuperAdminEmail(email) {
  const normalized = normalizeEmail(email);
  return normalized ? getSuperAdminEmailSet().has(normalized) : false;
}

function normalizeAccountRole(rawRole, fallback = "editor") {
  const normalized = String(rawRole || "").trim().toLowerCase();
  if (ALLOWED_ACCOUNT_ROLES.has(normalized)) {
    return normalized;
  }
  return fallback;
}

function getAdminEmail() {
  return getSuperAdminEmails()[0] || "";
}

function flagsFromRole(role) {
  const normalizedRole = normalizeAccountRole(role, "editor");
  const isSuperAdmin = normalizedRole === "superadmin";
  const isAdmin = isSuperAdmin || normalizedRole === "admin";
  return {
    role: normalizedRole,
    isAdmin,
    isSuperAdmin,
  };
}

function getConfiguredAllowedEmailSet() {
  const raw = process.env.ALLOWED_EMAILS || DEFAULT_ALLOWED_EMAILS.join(",");
  const set = new Set(
    String(raw)
      .split(",")
      .map((value) => normalizeEmail(value))
      .filter((value) => value && isValidEmail(value))
  );
  for (const email of getSuperAdminEmailSet()) {
    set.add(email);
  }
  return set;
}

function initialRoleForEmail(email) {
  return isSuperAdminEmail(email) ? "superadmin" : "editor";
}

function sanitizeNote(note) {
  if (!note || typeof note !== "object") return null;
  const clean = {};
  EDITABLE_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(note, field)) {
      clean[field] = String(note[field] ?? "");
    }
  });
  return Object.keys(clean).length ? clean : null;
}

function sanitizeOverrides(raw) {
  if (!raw || typeof raw !== "object") return {};
  const clean = {};
  Object.entries(raw).forEach(([goalId, note]) => {
    const normalized = sanitizeNote(note);
    if (normalized) clean[goalId] = normalized;
  });
  return clean;
}

function parseDbJson(rawValue) {
  if (rawValue && typeof rawValue === "object") return rawValue;
  if (typeof rawValue !== "string") return null;
  try {
    return JSON.parse(rawValue);
  } catch {
    return null;
  }
}

function getMemoryStore() {
  if (!globalThis.__evaSelectorOverridesMemory) {
    globalThis.__evaSelectorOverridesMemory = {};
  }
  return globalThis.__evaSelectorOverridesMemory;
}

function getMemoryAllowedAccountsMap() {
  if (!globalThis.__evaSelectorAllowedAccountsMemory) {
    const seeded = {};
    const nowIso = new Date().toISOString();
    for (const email of getConfiguredAllowedEmailSet()) {
      seeded[email] = {
        role: initialRoleForEmail(email),
        createdByEmail: getAdminEmail() || null,
        createdAt: nowIso,
      };
    }
    globalThis.__evaSelectorAllowedAccountsMemory = seeded;
  }

  // Ensure superadmins are always present in memory.
  const mem = globalThis.__evaSelectorAllowedAccountsMemory;
  for (const email of getSuperAdminEmailSet()) {
    if (!mem[email]) {
      mem[email] = {
        role: "superadmin",
        createdByEmail: getAdminEmail() || null,
        createdAt: new Date().toISOString(),
      };
    } else {
      mem[email].role = "superadmin";
    }
  }

  return mem;
}

function getMemoryActivityLogs() {
  if (!globalThis.__evaSelectorActivityLogsMemory) {
    globalThis.__evaSelectorActivityLogsMemory = [];
    globalThis.__evaSelectorActivityLogCounter = 0;
  }
  return globalThis.__evaSelectorActivityLogsMemory;
}

function nextMemoryLogId() {
  if (!globalThis.__evaSelectorActivityLogCounter) {
    globalThis.__evaSelectorActivityLogCounter = 0;
  }
  globalThis.__evaSelectorActivityLogCounter += 1;
  return globalThis.__evaSelectorActivityLogCounter;
}

async function ensureSchema() {
  if (!isPersistentStoreConfigured()) {
    throw new Error("Persistente opslag is niet geconfigureerd.");
  }
  const sql = getSql();
  if (!ensureSchemaPromise) {
    ensureSchemaPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS goal_overrides (
          goal_id TEXT PRIMARY KEY,
          note JSONB NOT NULL,
          updated_by_email TEXT,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS allowed_accounts (
          email TEXT PRIMARY KEY,
          role TEXT NOT NULL DEFAULT 'editor',
          created_by_email TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`ALTER TABLE allowed_accounts ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'editor'`;

      await sql`
        CREATE TABLE IF NOT EXISTS activity_logs (
          id BIGSERIAL PRIMARY KEY,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          action_type TEXT NOT NULL,
          actor_email TEXT,
          actor_name TEXT,
          goal_id TEXT,
          goal_title TEXT,
          field_key TEXT,
          before_text TEXT,
          after_text TEXT,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb
        )
      `;

      await sql`CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs (created_at DESC, id DESC)`;

      const countRows = await sql`SELECT COUNT(*)::int AS count FROM allowed_accounts`;
      const count = Number(countRows?.[0]?.count || 0);
      if (count === 0) {
        const seedSet = getConfiguredAllowedEmailSet();
        for (const email of seedSet) {
          await sql`
            INSERT INTO allowed_accounts (email, role, created_by_email, created_at)
            VALUES (${email}, ${initialRoleForEmail(email)}, ${getAdminEmail() || null}, NOW())
            ON CONFLICT (email) DO NOTHING
          `;
        }
      }

      // Enforce fixed superadmins on every schema ensure.
      for (const email of getSuperAdminEmailSet()) {
        await sql`
          INSERT INTO allowed_accounts (email, role, created_by_email, created_at)
          VALUES (${email}, 'superadmin', ${getAdminEmail() || null}, NOW())
          ON CONFLICT (email)
          DO UPDATE SET role = 'superadmin'
        `;
      }
    })();
  }
  await ensureSchemaPromise;
}

function sanitizeActionType(actionType) {
  const normalized = String(actionType || "").trim().toLowerCase();
  if (!ALLOWED_LOG_ACTIONS.has(normalized)) {
    throw new Error("Onbekend logtype.");
  }
  return normalized;
}

function sanitizeActivityPayload(payload) {
  if (!payload || typeof payload !== "object") return {};
  try {
    return JSON.parse(JSON.stringify(payload));
  } catch {
    return {};
  }
}

function mapLogRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || ""),
    actionType: String(row.action_type || ""),
    actorEmail: String(row.actor_email || ""),
    actorName: String(row.actor_name || ""),
    goalId: String(row.goal_id || ""),
    goalTitle: String(row.goal_title || ""),
    field: String(row.field_key || ""),
    beforeText: String(row.before_text || ""),
    afterText: String(row.after_text || ""),
    metadata: sanitizeActivityPayload(parseDbJson(row.metadata) || row.metadata || {}),
  };
}

function mapAccountRow(row) {
  const email = normalizeEmail(row.email);
  const roleInfo = flagsFromRole(isSuperAdminEmail(email) ? "superadmin" : normalizeAccountRole(row.role, "editor"));
  return {
    email,
    role: roleInfo.role,
    isAdmin: roleInfo.isAdmin,
    isSuperAdmin: roleInfo.isSuperAdmin,
    createdByEmail: normalizeEmail(row.created_by_email || "") || "",
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at || ""),
  };
}

function sortAccounts(accounts) {
  return accounts
    .slice()
    .sort((a, b) => String(a.email || "").localeCompare(String(b.email || ""), "nl"));
}

async function readOverrides() {
  if (isPersistentStoreConfigured()) {
    const sql = getSql();
    await ensureSchema();
    const rows = await sql`SELECT goal_id, note FROM goal_overrides`;
    const overrides = {};
    rows.forEach((row) => {
      const clean = sanitizeNote(parseDbJson(row.note));
      if (clean) overrides[String(row.goal_id)] = clean;
    });
    return overrides;
  }

  if (!allowMemoryFallback()) {
    throw new Error("Persistente opslag is niet geconfigureerd.");
  }
  return sanitizeOverrides(getMemoryStore());
}

async function readOverrideByGoalId(goalId) {
  const safeGoalId = String(goalId || "").trim();
  if (!safeGoalId) return null;

  if (isPersistentStoreConfigured()) {
    const sql = getSql();
    await ensureSchema();
    const rows = await sql`SELECT note FROM goal_overrides WHERE goal_id = ${safeGoalId} LIMIT 1`;
    if (!rows.length) return null;
    return sanitizeNote(parseDbJson(rows[0].note));
  }

  if (!allowMemoryFallback()) {
    throw new Error("Persistente opslag is niet geconfigureerd.");
  }
  const mem = getMemoryStore();
  return sanitizeNote(mem[safeGoalId]);
}

async function setOverride(goalId, note, updatedByEmail = null) {
  const safeGoalId = String(goalId || "").trim();
  if (!safeGoalId) {
    throw new Error("goalId ontbreekt.");
  }
  const cleanNote = sanitizeNote(note);

  if (isPersistentStoreConfigured()) {
    const sql = getSql();
    await ensureSchema();
    if (!cleanNote) {
      await sql`DELETE FROM goal_overrides WHERE goal_id = ${safeGoalId}`;
      return null;
    }
    await sql`
      INSERT INTO goal_overrides (goal_id, note, updated_by_email, updated_at)
      VALUES (${safeGoalId}, ${JSON.stringify(cleanNote)}::jsonb, ${updatedByEmail || null}, NOW())
      ON CONFLICT (goal_id)
      DO UPDATE SET
        note = EXCLUDED.note,
        updated_by_email = EXCLUDED.updated_by_email,
        updated_at = NOW()
    `;
    return cleanNote;
  }

  if (!allowMemoryFallback()) {
    throw new Error("Persistente opslag is niet geconfigureerd.");
  }
  const mem = getMemoryStore();
  if (!cleanNote) {
    delete mem[safeGoalId];
    return null;
  }
  mem[safeGoalId] = cleanNote;
  return cleanNote;
}

async function readAllowedAccountsWithRoles() {
  if (isPersistentStoreConfigured()) {
    const sql = getSql();
    await ensureSchema();
    const rows = await sql`
      SELECT email, role, created_by_email, created_at
      FROM allowed_accounts
      ORDER BY email ASC
    `;
    return sortAccounts(
      rows
        .map(mapAccountRow)
        .filter((entry) => entry.email && isValidEmail(entry.email))
    );
  }

  if (!allowMemoryFallback()) {
    return sortAccounts(
      [...getConfiguredAllowedEmailSet()].map((email) => {
        const roleInfo = flagsFromRole(initialRoleForEmail(email));
        return {
          email,
          role: roleInfo.role,
          isAdmin: roleInfo.isAdmin,
          isSuperAdmin: roleInfo.isSuperAdmin,
          createdByEmail: getAdminEmail() || "",
          createdAt: "",
        };
      })
    );
  }

  const mem = getMemoryAllowedAccountsMap();
  return sortAccounts(
    Object.entries(mem)
      .map(([email, data]) => {
        const roleInfo = flagsFromRole(isSuperAdminEmail(email) ? "superadmin" : normalizeAccountRole(data?.role, "editor"));
        return {
          email,
          role: roleInfo.role,
          isAdmin: roleInfo.isAdmin,
          isSuperAdmin: roleInfo.isSuperAdmin,
          createdByEmail: normalizeEmail(data?.createdByEmail || "") || "",
          createdAt: String(data?.createdAt || ""),
        };
      })
      .filter((entry) => entry.email && isValidEmail(entry.email))
  );
}

async function readAllowedAccounts() {
  const detailed = await readAllowedAccountsWithRoles();
  return detailed.map((entry) => entry.email);
}

async function getAccountAccess(email) {
  const normalized = normalizeEmail(email);
  if (!normalized || !isValidEmail(normalized)) return null;

  if (isPersistentStoreConfigured()) {
    const sql = getSql();
    await ensureSchema();
    const rows = await sql`
      SELECT email, role, created_by_email, created_at
      FROM allowed_accounts
      WHERE email = ${normalized}
      LIMIT 1
    `;
    if (!rows.length) return null;
    return mapAccountRow(rows[0]);
  }

  const list = await readAllowedAccountsWithRoles();
  return list.find((entry) => entry.email === normalized) || null;
}

async function isAllowedLoginEmail(email) {
  const access = await getAccountAccess(email);
  return Boolean(access);
}

async function isAdminLoginEmail(email) {
  const access = await getAccountAccess(email);
  return Boolean(access?.isAdmin);
}

async function addAllowedAccount(email, actorEmail = null, role = "editor") {
  const normalized = normalizeEmail(email);
  if (!normalized || !isValidEmail(normalized)) {
    throw new Error("Ongeldig e-mailadres.");
  }

  let targetRole = normalizeAccountRole(role, "editor");
  if (targetRole === "superadmin" && !isSuperAdminEmail(normalized)) {
    targetRole = "admin";
  }
  if (isSuperAdminEmail(normalized)) {
    targetRole = "superadmin";
  }

  if (isPersistentStoreConfigured()) {
    const sql = getSql();
    await ensureSchema();
    const rows = await sql`
      INSERT INTO allowed_accounts (email, role, created_by_email, created_at)
      VALUES (${normalized}, ${targetRole}, ${normalizeEmail(actorEmail) || null}, NOW())
      ON CONFLICT (email) DO NOTHING
      RETURNING email, role, created_by_email, created_at
    `;

    if (!rows.length) {
      const existing = await getAccountAccess(normalized);
      return {
        email: normalized,
        added: false,
        role: existing?.role || targetRole,
        account: existing,
      };
    }

    const account = mapAccountRow(rows[0]);
    return {
      email: normalized,
      added: true,
      role: account.role,
      account,
    };
  }

  if (!allowMemoryFallback()) {
    throw new Error("Persistente opslag is niet geconfigureerd.");
  }

  const mem = getMemoryAllowedAccountsMap();
  const had = Boolean(mem[normalized]);
  if (!had) {
    mem[normalized] = {
      role: targetRole,
      createdByEmail: normalizeEmail(actorEmail) || "",
      createdAt: new Date().toISOString(),
    };
  }
  const account = await getAccountAccess(normalized);
  return {
    email: normalized,
    added: !had,
    role: account?.role || targetRole,
    account,
  };
}

async function setAllowedAccountRole(email, role, actorEmail = null) {
  const normalized = normalizeEmail(email);
  if (!normalized || !isValidEmail(normalized)) {
    throw new Error("Ongeldig e-mailadres.");
  }
  if (isSuperAdminEmail(normalized)) {
    throw new Error("Superadmin-accounts kunnen niet aangepast worden.");
  }

  const targetRole = normalizeAccountRole(role, "editor");
  if (targetRole !== "admin" && targetRole !== "editor") {
    throw new Error("Ongeldige rol.");
  }

  if (isPersistentStoreConfigured()) {
    const sql = getSql();
    await ensureSchema();
    const rows = await sql`
      UPDATE allowed_accounts
      SET role = ${targetRole}
      WHERE email = ${normalized}
      RETURNING email, role, created_by_email, created_at
    `;
    if (!rows.length) {
      throw new Error("Account niet gevonden.");
    }

    const account = mapAccountRow(rows[0]);
    return {
      email: normalized,
      role: account.role,
      account,
    };
  }

  if (!allowMemoryFallback()) {
    throw new Error("Persistente opslag is niet geconfigureerd.");
  }

  const mem = getMemoryAllowedAccountsMap();
  if (!mem[normalized]) {
    throw new Error("Account niet gevonden.");
  }
  mem[normalized].role = targetRole;
  if (!mem[normalized].createdByEmail && actorEmail) {
    mem[normalized].createdByEmail = normalizeEmail(actorEmail) || "";
  }

  const account = await getAccountAccess(normalized);
  return {
    email: normalized,
    role: account?.role || targetRole,
    account,
  };
}

async function removeAllowedAccount(email) {
  const normalized = normalizeEmail(email);
  if (!normalized || !isValidEmail(normalized)) {
    throw new Error("Ongeldig e-mailadres.");
  }
  if (isSuperAdminEmail(normalized)) {
    throw new Error("Superadmin-accounts kunnen niet verwijderd worden.");
  }

  if (isPersistentStoreConfigured()) {
    const sql = getSql();
    await ensureSchema();
    const rows = await sql`
      DELETE FROM allowed_accounts
      WHERE email = ${normalized}
      RETURNING email
    `;
    return {
      email: normalized,
      removed: rows.length > 0,
    };
  }

  if (!allowMemoryFallback()) {
    throw new Error("Persistente opslag is niet geconfigureerd.");
  }

  const mem = getMemoryAllowedAccountsMap();
  const had = Boolean(mem[normalized]);
  if (had) {
    delete mem[normalized];
  }
  return {
    email: normalized,
    removed: had,
  };
}

async function addActivityLog(entry) {
  const actionType = sanitizeActionType(entry?.actionType);
  const actorEmail = normalizeEmail(entry?.actorEmail);
  const actorName = String(entry?.actorName || "").trim();
  const goalId = String(entry?.goalId || "").trim();
  const goalTitle = String(entry?.goalTitle || "").trim();
  const field = String(entry?.field || "").trim();
  const beforeText = String(entry?.beforeText ?? "");
  const afterText = String(entry?.afterText ?? "");
  const metadata = sanitizeActivityPayload(entry?.metadata || {});

  if (isPersistentStoreConfigured()) {
    const sql = getSql();
    await ensureSchema();
    const rows = await sql`
      INSERT INTO activity_logs (
        action_type,
        actor_email,
        actor_name,
        goal_id,
        goal_title,
        field_key,
        before_text,
        after_text,
        metadata,
        created_at
      ) VALUES (
        ${actionType},
        ${actorEmail || null},
        ${actorName || null},
        ${goalId || null},
        ${goalTitle || null},
        ${field || null},
        ${beforeText || null},
        ${afterText || null},
        ${JSON.stringify(metadata)}::jsonb,
        NOW()
      )
      RETURNING id, created_at, action_type, actor_email, actor_name, goal_id, goal_title, field_key, before_text, after_text, metadata
    `;
    return mapLogRow(rows[0]);
  }

  if (!allowMemoryFallback()) {
    throw new Error("Persistente opslag is niet geconfigureerd.");
  }

  const row = {
    id: nextMemoryLogId(),
    created_at: new Date().toISOString(),
    action_type: actionType,
    actor_email: actorEmail,
    actor_name: actorName,
    goal_id: goalId,
    goal_title: goalTitle,
    field_key: field,
    before_text: beforeText,
    after_text: afterText,
    metadata,
  };
  getMemoryActivityLogs().push(row);
  return mapLogRow(row);
}

function normalizeLogLimit(limit, fallback = 200) {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(1000, Math.floor(parsed)));
}

async function readActivityLogs(limit = 200) {
  const safeLimit = normalizeLogLimit(limit, 200);

  if (isPersistentStoreConfigured()) {
    const sql = getSql();
    await ensureSchema();
    const rows = await sql`
      SELECT id, created_at, action_type, actor_email, actor_name, goal_id, goal_title, field_key, before_text, after_text, metadata
      FROM activity_logs
      ORDER BY created_at DESC, id DESC
      LIMIT ${safeLimit}
    `;
    return rows.map(mapLogRow).filter(Boolean);
  }

  if (!allowMemoryFallback()) {
    throw new Error("Persistente opslag is niet geconfigureerd.");
  }
  return getMemoryActivityLogs()
    .slice()
    .reverse()
    .slice(0, safeLimit)
    .map(mapLogRow)
    .filter(Boolean);
}

async function getActivityLogById(logId) {
  const id = Number(logId);
  if (!Number.isFinite(id) || id <= 0) return null;

  if (isPersistentStoreConfigured()) {
    const sql = getSql();
    await ensureSchema();
    const rows = await sql`
      SELECT id, created_at, action_type, actor_email, actor_name, goal_id, goal_title, field_key, before_text, after_text, metadata
      FROM activity_logs
      WHERE id = ${id}
      LIMIT 1
    `;
    if (!rows.length) return null;
    return mapLogRow(rows[0]);
  }

  if (!allowMemoryFallback()) {
    throw new Error("Persistente opslag is niet geconfigureerd.");
  }
  const row = getMemoryActivityLogs().find((entry) => Number(entry.id) === id);
  return mapLogRow(row);
}

module.exports = {
  EDITABLE_FIELDS,
  sanitizeNote,
  sanitizeOverrides,
  readOverrides,
  readOverrideByGoalId,
  setOverride,
  isPersistentStoreConfigured,
  getAdminEmail,
  getSuperAdminEmails,
  isSuperAdminEmail,
  readAllowedAccounts,
  readAllowedAccountsWithRoles,
  getAccountAccess,
  isAllowedLoginEmail,
  isAdminLoginEmail,
  addAllowedAccount,
  setAllowedAccountRole,
  removeAllowedAccount,
  addActivityLog,
  readActivityLogs,
  getActivityLogById,
};
