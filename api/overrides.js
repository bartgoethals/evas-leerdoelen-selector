const { sendJson, readJsonBody } = require("./_lib/http");
const { getSessionFromRequest } = require("./_lib/session");
const {
  EDITABLE_FIELDS,
  sanitizeNote,
  readOverrides,
  readOverrideByGoalId,
  setOverride,
  addActivityLog,
  isAllowedLoginEmail,
  isPersistentStoreConfigured,
} = require("./_lib/overrides-store");

function normalizeChangeItems(rawChanges, beforeNote, afterNote) {
  const list = Array.isArray(rawChanges) ? rawChanges : [];
  if (list.length) {
    return list
      .map((entry) => {
        const field = String(entry?.field || "").trim();
        if (!EDITABLE_FIELDS.includes(field)) return null;
        const beforeText = String(entry?.beforeText ?? "");
        const afterText = String(entry?.afterText ?? "");
        if (beforeText === afterText) return null;
        return { field, beforeText, afterText };
      })
      .filter(Boolean);
  }

  return EDITABLE_FIELDS.map((field) => {
    const beforeText = String(beforeNote?.[field] ?? "");
    const afterText = String(afterNote?.[field] ?? "");
    if (beforeText === afterText) return null;
    return { field, beforeText, afterText };
  }).filter(Boolean);
}

function actionTypeForField(field) {
  if (field === "voorbeelden") return "edit_voorbeelden";
  if (field === "toelichting") return "edit_toelichting";
  if (field === "woordenschat") return "edit_woordenschat";
  return "";
}

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
  const stillAllowed = await isAllowedLoginEmail(session.email || "");
  if (!stillAllowed) {
    return sendJson(res, 403, { error: "Dit account heeft geen toegang meer." });
  }

  const body = readJsonBody(req);
  const goalId = String(body.goalId || "").trim();
  if (!goalId) {
    return sendJson(res, 400, { error: "goalId ontbreekt." });
  }

  const cleanNote = sanitizeNote(body.note);

  try {
    const beforeNote = await readOverrideByGoalId(goalId);
    const saved = await setOverride(goalId, cleanNote, session.email || null);
    const afterNote = sanitizeNote(saved);
    const changes = normalizeChangeItems(body.changes, beforeNote, afterNote);
    const goalTitle = String(body.goalTitle || "").trim();
    const goalCode = String(body.goalCode || "").trim();

    for (const change of changes) {
      const actionType = actionTypeForField(change.field);
      if (!actionType) continue;
      await addActivityLog({
        actionType,
        actorEmail: session.email || "",
        actorName: session.name || session.email || "",
        goalId,
        goalTitle,
        field: change.field,
        beforeText: change.beforeText,
        afterText: change.afterText,
        metadata: {
          goal_code: goalCode,
          before_note: beforeNote,
          after_note: afterNote,
        },
      });
    }

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
