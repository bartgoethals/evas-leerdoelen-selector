const EDITABLE_FIELDS = ["voorbeelden", "toelichting", "woordenschat"];
const DEFAULT_ALLOWED_EMAILS = ["goethals@gmail.com", "eva.jacobs@gmail.com"];
const ADMIN_EMAIL_FALLBACK = "eva.jacobs@gmail.com";
const ALLOWED_LOG_ACTIONS = new Set([
  "edit_voorbeelden",
  "edit_toelichting",
  "edit_woordenschat",
  "export_txt",
  "export_docs",
  "access_add",
  "access_remove",
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

function getAdminEmail() {
  return normalizeEmail(process.env.ADMIN_EMAIL || ADMIN_EMAIL_FALLBACK);
}

function getConfiguredAllowedEmailSet() {
  const raw = process.env.ALLOWED_EMAILS || DEFAULT_ALLOWED_EMAILS.join(",");
  const set = new Set(
    String(raw)
      .split(",")
      .map((value) => normalizeEmail(value))
      .filter((value) => value && isValidEmail(value))
  );
  const admin = getAdminEmail();
  if (admin) set.add(admin);
  return set;
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

function getMemoryAllowedAccounts() {
  if (!globalThis.__evaSelectorAllowedAccountsMemory) {
    globalThis.__evaSelectorAllowedAccountsMemory = new Set(getConfiguredAllowedEmailSet());
  }
  return globalThis.__evaSelectorAllowedAccountsMemory;
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
          created_by_email TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

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
            INSERT INTO allowed_accounts (email, created_by_email, created_at)
            VALUES (${email}, ${getAdminEmail() || null}, NOW())
            ON CONFLICT (email) DO NOTHING
          `;
        }
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

async function readAllowedAccounts() {
  if (isPersistentStoreConfigured()) {
    const sql = getSql();
    await ensureSchema();
    const rows = await sql`SELECT email FROM allowed_accounts ORDER BY email ASC`;
    return rows
      .map((row) => normalizeEmail(row.email))
      .filter((value) => value && isValidEmail(value));
  }

  if (!allowMemoryFallback()) {
    return [...getConfiguredAllowedEmailSet()].sort((a, b) => a.localeCompare(b, "nl"));
  }
  return [...getMemoryAllowedAccounts()].sort((a, b) => a.localeCompare(b, "nl"));
}

async function isAllowedLoginEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized || !isValidEmail(normalized)) return false;
  const accounts = await readAllowedAccounts();
  return accounts.includes(normalized);
}

async function addAllowedAccount(email, actorEmail = null) {
  const normalized = normalizeEmail(email);
  if (!normalized || !isValidEmail(normalized)) {
    throw new Error("Ongeldig e-mailadres.");
  }

  if (isPersistentStoreConfigured()) {
    const sql = getSql();
    await ensureSchema();
    const rows = await sql`
      INSERT INTO allowed_accounts (email, created_by_email, created_at)
      VALUES (${normalized}, ${normalizeEmail(actorEmail) || null}, NOW())
      ON CONFLICT (email) DO NOTHING
      RETURNING email
    `;
    return {
      email: normalized,
      added: rows.length > 0,
    };
  }

  if (!allowMemoryFallback()) {
    throw new Error("Persistente opslag is niet geconfigureerd.");
  }
  const set = getMemoryAllowedAccounts();
  const had = set.has(normalized);
  if (!had) set.add(normalized);
  return {
    email: normalized,
    added: !had,
  };
}

async function removeAllowedAccount(email) {
  const normalized = normalizeEmail(email);
  if (!normalized || !isValidEmail(normalized)) {
    throw new Error("Ongeldig e-mailadres.");
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
  const set = getMemoryAllowedAccounts();
  const had = set.has(normalized);
  if (had) set.delete(normalized);
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
  readAllowedAccounts,
  isAllowedLoginEmail,
  addAllowedAccount,
  removeAllowedAccount,
  addActivityLog,
  readActivityLogs,
  getActivityLogById,
};
