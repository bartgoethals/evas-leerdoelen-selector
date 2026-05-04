const { sendJson, readJsonBody } = require("../_lib/http");
const { requireAdminSession } = require("../_lib/admin-auth");
const { getAdminEmail } = require("../_lib/session");
const {
  readAllowedAccounts,
  addAllowedAccount,
  removeAllowedAccount,
  addActivityLog,
} = require("../_lib/overrides-store");

module.exports = async function handler(req, res) {
  const auth = requireAdminSession(req);
  if (!auth.ok) {
    return sendJson(res, auth.status, { error: auth.error });
  }

  if (req.method === "GET") {
    try {
      const accounts = await readAllowedAccounts();
      return sendJson(res, 200, {
        accounts,
        adminEmail: getAdminEmail(),
      });
    } catch (err) {
      console.error("Lezen van toegangsaccounts mislukt", err);
      return sendJson(res, 500, { error: "Kon toegangsaccounts niet laden." });
    }
  }

  if (req.method === "POST") {
    const body = readJsonBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    if (!email) {
      return sendJson(res, 400, { error: "E-mailadres ontbreekt." });
    }

    try {
      const result = await addAllowedAccount(email, auth.session.email || null);
      if (result.added) {
        await addActivityLog({
          actionType: "access_add",
          actorEmail: auth.session.email || "",
          actorName: auth.session.name || auth.session.email || "",
          metadata: {
            email: result.email,
          },
        });
      }
      const accounts = await readAllowedAccounts();
      return sendJson(res, 200, {
        ok: true,
        added: result.added,
        accounts,
      });
    } catch (err) {
      console.error("Toevoegen van toegangsaccount mislukt", err);
      return sendJson(res, 400, { error: err.message || "Kon e-mailadres niet toevoegen." });
    }
  }

  if (req.method === "DELETE") {
    const body = readJsonBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    if (!email) {
      return sendJson(res, 400, { error: "E-mailadres ontbreekt." });
    }

    if (email === getAdminEmail()) {
      return sendJson(res, 400, { error: "Het admin-account kan niet verwijderd worden." });
    }

    try {
      const result = await removeAllowedAccount(email);
      if (result.removed) {
        await addActivityLog({
          actionType: "access_remove",
          actorEmail: auth.session.email || "",
          actorName: auth.session.name || auth.session.email || "",
          metadata: {
            email: result.email,
          },
        });
      }
      const accounts = await readAllowedAccounts();
      return sendJson(res, 200, {
        ok: true,
        removed: result.removed,
        accounts,
      });
    } catch (err) {
      console.error("Verwijderen van toegangsaccount mislukt", err);
      return sendJson(res, 400, { error: err.message || "Kon e-mailadres niet verwijderen." });
    }
  }

  res.setHeader("Allow", "GET, POST, DELETE");
  return sendJson(res, 405, { error: "Method not allowed" });
};
