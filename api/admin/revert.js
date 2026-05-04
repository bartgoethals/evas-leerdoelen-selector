const { sendJson, readJsonBody } = require("../_lib/http");
const { requireAdminSession } = require("../_lib/admin-auth");
const {
  sanitizeNote,
  getActivityLogById,
  readOverrideByGoalId,
  setOverride,
  addActivityLog,
} = require("../_lib/overrides-store");

module.exports = async function handler(req, res) {
  const auth = await requireAdminSession(req);
  if (!auth.ok) {
    return sendJson(res, auth.status, { error: auth.error });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  const body = readJsonBody(req);
  const logId = Number(body.logId);
  if (!Number.isFinite(logId) || logId <= 0) {
    return sendJson(res, 400, { error: "Ongeldige logId." });
  }

  try {
    const entry = await getActivityLogById(logId);
    if (!entry) {
      return sendJson(res, 404, { error: "Log-entry niet gevonden." });
    }

    if (!String(entry.actionType || "").startsWith("edit_")) {
      return sendJson(res, 400, { error: "Deze log-entry kan niet hersteld worden." });
    }

    const goalId = String(entry.goalId || "").trim();
    if (!goalId) {
      return sendJson(res, 400, { error: "Doel-id ontbreekt in deze log-entry." });
    }

    const metadata = entry.metadata && typeof entry.metadata === "object" ? entry.metadata : {};
    if (!Object.prototype.hasOwnProperty.call(metadata, "after_note")) {
      return sendJson(res, 400, { error: "Geen herstelbare versie in deze log-entry." });
    }
    const targetNote = sanitizeNote(metadata.after_note);

    const beforeNote = await readOverrideByGoalId(goalId);
    const savedNote = await setOverride(goalId, targetNote, auth.session.email || null);

    await addActivityLog({
      actionType: "revert_version",
      actorEmail: auth.session.email || "",
      actorName: auth.session.name || auth.session.email || "",
      goalId,
      goalTitle: entry.goalTitle || "",
      field: entry.field || "",
      beforeText: JSON.stringify(beforeNote || {}),
      afterText: JSON.stringify(savedNote || {}),
      metadata: {
        reverted_log_id: logId,
        reverted_action: entry.actionType,
        before_note: beforeNote,
        after_note: savedNote,
      },
    });

    return sendJson(res, 200, {
      ok: true,
      goalId,
      note: savedNote,
    });
  } catch (err) {
    console.error("Herstellen van versie mislukt", err);
    return sendJson(res, 500, { error: "Herstellen is mislukt." });
  }
};
