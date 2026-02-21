const EDITABLE_FIELDS = ["voorbeelden", "toelichting", "woordenschat"];

let sql = null;
try {
  ({ sql } = require("@vercel/postgres"));
} catch {
  sql = null;
}

const TABLE_NAME = "goal_overrides";
let ensureSchemaPromise = null;

function hasPostgresConfig() {
  return Boolean(
    process.env.POSTGRES_URL ||
      process.env.POSTGRES_PRISMA_URL ||
      process.env.POSTGRES_URL_NON_POOLING ||
      process.env.DATABASE_URL
  );
}

function isPersistentStoreConfigured() {
  return Boolean(sql && hasPostgresConfig());
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
    await ensureSchema();
    const result = await sql`SELECT goal_id, note FROM goal_overrides`;
    const overrides = {};
    result.rows.forEach((row) => {
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
