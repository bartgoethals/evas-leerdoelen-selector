const { getSessionFromRequest, isAdminEmail } = require("./session");

function requireAdminSession(req) {
  const session = getSessionFromRequest(req);
  if (!session) {
    return { ok: false, status: 401, error: "Login vereist." };
  }
  if (!isAdminEmail(session.email)) {
    return { ok: false, status: 403, error: "Geen admin-toegang." };
  }
  return { ok: true, session };
}

module.exports = {
  requireAdminSession,
};
