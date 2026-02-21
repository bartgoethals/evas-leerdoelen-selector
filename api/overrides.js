const { sendJson, readJsonBody } = require("./_lib/http");
const { getSessionFromRequest } = require("./_lib/session");
const {
  sanitizeNote,
  readOverrides,
  setOverride,
  isPersistentStoreConfigured,
} = require("./_lib/overrides-store");

module.exports = async function handler(req, res) {
  if (req.method === "GET") {
    try {
      const overrides = await readOverrides();
      return sendJson(res, 200, {
        overrides,
        persistentStoreConfigured: isPersistentStoreConfigured(),
      });
    } catch (err) {
      console.error("Lezen van overrides mislukt", err);
      if (!isPersistentStoreConfigured()) {
        return sendJson(res, 503, { error: "Persistente opslag is nog niet geconfigureerd." });
      }
      return sendJson(res, 500, { error: "Kon gedeelde aanpassingen niet laden." });
    }
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  const session = getSessionFromRequest(req);
  if (!session) {
    return sendJson(res, 401, { error: "Login vereist voor aanpassen." });
  }

  const body = readJsonBody(req);
  const goalId = String(body.goalId || "").trim();
  if (!goalId) {
    return sendJson(res, 400, { error: "goalId ontbreekt." });
  }

  const cleanNote = sanitizeNote(body.note);

  try {
    const saved = await setOverride(goalId, cleanNote, session.email || null);
    return sendJson(res, 200, {
      ok: true,
      note: saved,
      persistentStoreConfigured: isPersistentStoreConfigured(),
    });
  } catch (err) {
    console.error("Bewaren van overrides mislukt", err);
    if (!isPersistentStoreConfigured()) {
      return sendJson(res, 503, { error: "Persistente opslag is nog niet geconfigureerd." });
    }
    return sendJson(res, 500, { error: "Kon de aanpassing niet bewaren." });
  }
};
