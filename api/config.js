const { sendJson } = require("./_lib/http");
const { isPersistentStoreConfigured } = require("./_lib/overrides-store");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  return sendJson(res, 200, {
    googleClientId: String(process.env.GOOGLE_CLIENT_ID || ""),
    persistentStoreConfigured: isPersistentStoreConfigured(),
  });
};
