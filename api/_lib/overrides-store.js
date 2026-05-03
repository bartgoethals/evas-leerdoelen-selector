const EDITABLE_FIELDS = ["voorbeelden", "toelichting", "woordenschat"];

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

function parseDbNote(rawNote) {
  if (rawNote && typeof rawNote === "object") return rawNote;
  if (typeof rawNote !== "string") return null;
  try {
    return JSON.parse(rawNote);
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

async function ensureSchema() {
  if (!isPersistentStoreConfigured()) {
    throw new Error("Persistente opslag is niet geconfigureerd.");
  }
  const sql = getSql();
  if (!ensureSchemaPromise) {
    ensureSchemaPromise = sql`
      CREATE TABLE IF NOT EXISTS goal_overrides (
        goal_id TEXT PRIMARY KEY,
        note JSONB NOT NULL,
        updated_by_email TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
  }
  await ensureSchemaPromise;
}

async function readOverrides() {
  if (isPersistentStoreConfigured()) {
    const sql = getSql();
    await ensureSchema();
    const rows = await sql`SELECT goal_id, note FROM goal_overrides`;
    const overrides = {};
    rows.forEach((row) => {
      const clean = sanitizeNote(parseDbNote(row.note));
      if (clean) overrides[String(row.goal_id)] = clean;
    });
    return overrides;
  }

  if (!allowMemoryFallback()) {
    throw new Error("Persistente opslag is niet geconfigureerd.");
  }
  return sanitizeOverrides(getMemoryStore());
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

module.exports = {
  sanitizeNote,
  sanitizeOverrides,
  readOverrides,
  setOverride,
  isPersistentStoreConfigured,
};
