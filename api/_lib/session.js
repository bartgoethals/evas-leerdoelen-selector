const crypto = require("node:crypto");

const SESSION_COOKIE_NAME = "eva_selector_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;
const DEFAULT_ALLOWED_EMAILS = ["goethals@gmail.com", "eva.jacobs@gmail.com"];
const DEV_SESSION_SECRET = "local-dev-session-secret";

function getSessionSecret() {
  return process.env.SESSION_SECRET || process.env.VERCEL_PROJECT_ID || DEV_SESSION_SECRET;
}

function signTokenPayload(encodedPayload) {
  return crypto
    .createHmac("sha256", getSessionSecret())
    .update(encodedPayload)
    .digest("base64url");
}

function createSessionToken(user) {
  const payload = {
    email: String(user.email || "").toLowerCase(),
    name: String(user.name || ""),
    picture: String(user.picture || ""),
    exp: Date.now() + SESSION_TTL_SECONDS * 1000,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = signTokenPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [encodedPayload, signature] = parts;
  const expectedSignature = signTokenPayload(encodedPayload);
  if (signature.length !== expectedSignature.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    if (!payload || typeof payload !== "object") return null;
    if (!payload.exp || Number(payload.exp) < Date.now()) return null;
    if (!payload.email) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(rawCookieHeader = "") {
  return rawCookieHeader
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((acc, entry) => {
      const separator = entry.indexOf("=");
      if (separator < 0) return acc;
      const key = entry.slice(0, separator).trim();
      const value = decodeURIComponent(entry.slice(separator + 1));
      acc[key] = value;
      return acc;
    }, {});
}

function getSessionFromRequest(req) {
  const cookies = parseCookies(req.headers?.cookie || "");
  const token = cookies[SESSION_COOKIE_NAME];
  return verifySessionToken(token);
}

function buildSessionCookie(token) {
  const secure = process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function clearSessionCookie() {
  const secure = process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function getAllowedEmailSet() {
  const raw = process.env.ALLOWED_EMAILS || DEFAULT_ALLOWED_EMAILS.join(",");
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

function isAllowedEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return false;
  return getAllowedEmailSet().has(normalized);
}

module.exports = {
  SESSION_COOKIE_NAME,
  createSessionToken,
  verifySessionToken,
  getSessionFromRequest,
  buildSessionCookie,
  clearSessionCookie,
  isAllowedEmail,
};
