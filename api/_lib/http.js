function sendJson(res, status, payload) {
  res.status(status).json(payload);
}

function readJsonBody(req) {
  if (req.body == null) return {};
  if (typeof req.body === "object") return req.body;
  if (Buffer.isBuffer(req.body)) {
    const raw = req.body.toString("utf8");
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return {};
}

module.exports = {
  sendJson,
  readJsonBody,
};
