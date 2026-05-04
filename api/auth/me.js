const { sendJson } = require("../_lib/http");
const { getSessionFromRequest, isAdminEmail } = require("../_lib/session");
const { isAllowedLoginEmail } = require("../_lib/overrides-store");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  const session = getSessionFromRequest(req);
  if (!session) {
    return sendJson(res, 200, { authenticated: false, user: null });
  }
  const stillAllowed = await isAllowedLoginEmail(session.email || "");
  if (!stillAllowed) {
    return sendJson(res, 200, { authenticated: false, isAdmin: false, user: null });
  }

  return sendJson(res, 200, {
    authenticated: true,
    isAdmin: isAdminEmail(session.email),
    user: {
      email: String(session.email || ""),
      name: String(session.name || session.email || ""),
      picture: String(session.picture || ""),
    },
  });
};
