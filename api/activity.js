const { sendJson, readJsonBody } = require("./_lib/http");
const { getSessionFromRequest } = require("./_lib/session");
const { addActivityLog, isAllowedLoginEmail } = require("./_lib/overrides-store");

const ALLOWED_EXPORT_ACTIONS = new Set(["export_txt", "export_docs"]);

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  const session = getSessionFromRequest(req);
  if (!session) {
    return sendJson(res, 200, { ok: true, skipped: true });
  }
  const stillAllowed = await isAllowedLoginEmail(session.email || "");
  if (!stillAllowed) {
    return sendJson(res, 200, { ok: true, skipped: true });
  }

  const body = readJsonBody(req);
  const actionType = String(body.actionType || "").trim().toLowerCase();
  if (!ALLOWED_EXPORT_ACTIONS.has(actionType)) {
    return sendJson(res, 400, { error: "Onbekend exporttype." });
  }

  try {
    await addActivityLog({
      actionType,
      actorEmail: session.email || "",
      actorName: session.name || session.email || "",
      metadata: {
        payload: body.payload || {},
      },
    });
    return sendJson(res, 200, { ok: true });
  } catch (err) {
    console.error("Loggen van export mislukt", err);
    return sendJson(res, 500, { error: "Kon exportlog niet bewaren." });
  }
};
