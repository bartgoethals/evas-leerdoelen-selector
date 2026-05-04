const { sendJson } = require("../_lib/http");
const { requireAdminSession } = require("../_lib/admin-auth");
const { readActivityLogs } = require("../_lib/overrides-store");

function canRevertLogEntry(entry) {
  if (!entry) return false;
  if (!String(entry.actionType || "").startsWith("edit_")) return false;
  if (!entry.goalId) return false;
  const metadata = entry.metadata && typeof entry.metadata === "object" ? entry.metadata : {};
  return Object.prototype.hasOwnProperty.call(metadata, "after_note");
}

module.exports = async function handler(req, res) {
  const auth = requireAdminSession(req);
  if (!auth.ok) {
    return sendJson(res, auth.status, { error: auth.error });
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  try {
    const rawLimit = Number(req.query?.limit);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(1000, Math.floor(rawLimit))) : 300;
    const logs = await readActivityLogs(limit);
    return sendJson(res, 200, {
      logs: logs.map((entry) => ({
        ...entry,
        canRevert: canRevertLogEntry(entry),
      })),
    });
  } catch (err) {
    console.error("Lezen van activity logs mislukt", err);
    return sendJson(res, 500, { error: "Kon logs niet laden." });
  }
};
