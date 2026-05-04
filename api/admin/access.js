const { sendJson, readJsonBody } = require("../_lib/http");
const { requireAdminSession } = require("../_lib/admin-auth");
const {
  readAllowedAccountsWithRoles,
  addAllowedAccount,
  setAllowedAccountRole,
  removeAllowedAccount,
  addActivityLog,
  getSuperAdminEmails,
} = require("../_lib/overrides-store");

function normalizeRoleInput(rawRole, fallback = "editor") {
  const normalized = String(rawRole || "").trim().toLowerCase();
  if (normalized === "admin" || normalized === "editor" || normalized === "superadmin") {
    return normalized;
  }
  return fallback;
}

module.exports = async function handler(req, res) {
  const auth = await requireAdminSession(req);
  if (!auth.ok) {
    return sendJson(res, auth.status, { error: auth.error });
  }

  if (req.method === "GET") {
    try {
      const accounts = await readAllowedAccountsWithRoles();
      return sendJson(res, 200, {
        accounts,
        superAdmins: getSuperAdminEmails(),
      });
    } catch (err) {
      console.error("Lezen van toegangsaccounts mislukt", err);
      return sendJson(res, 500, { error: "Kon toegangsaccounts niet laden." });
    }
  }

  if (req.method === "POST") {
    const body = readJsonBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    const role = normalizeRoleInput(body.role, "editor");
    if (!email) {
      return sendJson(res, 400, { error: "E-mailadres ontbreekt." });
    }

    try {
      const result = await addAllowedAccount(email, auth.session.email || null, role);
      if (result.added) {
        await addActivityLog({
          actionType: "access_add",
          actorEmail: auth.session.email || "",
          actorName: auth.session.name || auth.session.email || "",
          metadata: {
            email: result.email,
            role: result.role || role,
          },
        });
      }
      const accounts = await readAllowedAccountsWithRoles();
      return sendJson(res, 200, {
        ok: true,
        added: result.added,
        account: result.account || null,
        accounts,
      });
    } catch (err) {
      console.error("Toevoegen van toegangsaccount mislukt", err);
      return sendJson(res, 400, { error: err.message || "Kon e-mailadres niet toevoegen." });
    }
  }

  if (req.method === "PATCH") {
    const body = readJsonBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    const role = normalizeRoleInput(body.role, "");
    if (!email) {
      return sendJson(res, 400, { error: "E-mailadres ontbreekt." });
    }
    if (!role) {
      return sendJson(res, 400, { error: "Rol ontbreekt." });
    }

    try {
      const result = await setAllowedAccountRole(email, role, auth.session.email || null);
      await addActivityLog({
        actionType: "access_role_update",
        actorEmail: auth.session.email || "",
        actorName: auth.session.name || auth.session.email || "",
        metadata: {
          email: result.email,
          role: result.role,
        },
      });
      const accounts = await readAllowedAccountsWithRoles();
      return sendJson(res, 200, {
        ok: true,
        account: result.account || null,
        accounts,
      });
    } catch (err) {
      console.error("Aanpassen van accountrol mislukt", err);
      return sendJson(res, 400, { error: err.message || "Kon accountrol niet aanpassen." });
    }
  }

  if (req.method === "DELETE") {
    const body = readJsonBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    if (!email) {
      return sendJson(res, 400, { error: "E-mailadres ontbreekt." });
    }

    if (email === String(auth.session.email || "").trim().toLowerCase()) {
      return sendJson(res, 400, { error: "Je kunt je eigen account niet verwijderen." });
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
      const accounts = await readAllowedAccountsWithRoles();
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

  res.setHeader("Allow", "GET, POST, PATCH, DELETE");
  return sendJson(res, 405, { error: "Method not allowed" });
};
