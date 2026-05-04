const { getSessionFromRequest } = require("./session");
const { getAccountAccess } = require("./overrides-store");

async function requireAdminSession(req) {
  const session = getSessionFromRequest(req);
  if (!session) {
    return { ok: false, status: 401, error: "Login vereist." };
  }

  let access = null;
  try {
    access = await getAccountAccess(session.email || "");
  } catch (err) {
    console.error("Admin-auth check mislukt", err);
    return { ok: false, status: 500, error: "Kon admin-toegang niet valideren." };
  }

  if (!access) {
    return { ok: false, status: 403, error: "Dit account heeft geen toegang meer." };
  }
  if (!access.isAdmin) {
    return { ok: false, status: 403, error: "Geen admin-toegang." };
  }
  return { ok: true, session, access };
}

module.exports = {
  requireAdminSession,
};
