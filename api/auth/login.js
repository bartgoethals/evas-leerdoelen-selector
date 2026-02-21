const { OAuth2Client } = require("google-auth-library");
const { sendJson, readJsonBody } = require("../_lib/http");
const { createSessionToken, buildSessionCookie, isAllowedEmail } = require("../_lib/session");

const oauthClient = new OAuth2Client();

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  const googleClientId = String(process.env.GOOGLE_CLIENT_ID || "").trim();
  if (!googleClientId) {
    return sendJson(res, 500, { error: "Google-login is nog niet geconfigureerd." });
  }

  const body = readJsonBody(req);
  const credential = String(body.credential || "").trim();
  if (!credential) {
    return sendJson(res, 400, { error: "Ontbrekende login-credential." });
  }

  try {
    const ticket = await oauthClient.verifyIdToken({
      idToken: credential,
      audience: googleClientId,
    });
    const payload = ticket.getPayload() || {};
    const email = String(payload.email || "").toLowerCase().trim();

    if (!payload.email_verified || !email) {
      return sendJson(res, 403, { error: "Google-account kon niet gevalideerd worden." });
    }

    if (!isAllowedEmail(email)) {
      return sendJson(res, 403, { error: "Dit Google-account heeft geen toegang." });
    }

    const user = {
      email,
      name: String(payload.name || email),
      picture: String(payload.picture || ""),
    };

    const token = createSessionToken(user);
    res.setHeader("Set-Cookie", buildSessionCookie(token));
    return sendJson(res, 200, { authenticated: true, user });
  } catch (err) {
    console.error("Google-login mislukt", err);
    return sendJson(res, 401, { error: "Aanmelden mislukt. Probeer opnieuw." });
  }
};
