import { authenticate, constantTimeEqual, passwordHash } from "../../_lib/auth.js";
import { checkMutation, clearCookieHeader, fail, json, readJson } from "../../_lib/http.js";

export async function onRequestDelete({ request, env }) {
  const originError = checkMutation(request);
  if (originError) return originError;
  const auth = await authenticate(request, env);
  if (auth.response) return auth.response;
  const { data, error } = await readJson(request);
  if (error) return error;
  if (typeof data.password !== "string" || data.password.length > 128) return fail("Confirm your password to delete the account.");
  try {
    const user = await env.DB.prepare("SELECT password_hash, password_salt FROM users WHERE id = ?").bind(auth.user.id).first();
    if (!user || !constantTimeEqual(await passwordHash(data.password, user.password_salt), user.password_hash)) {
      return fail("Password is incorrect.", 401);
    }
    await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(auth.user.id).run();
    return json({ ok: true }, 200, { "set-cookie": clearCookieHeader() });
  } catch (error) {
    console.error("Account deletion failed.");
    return fail("Could not delete the account right now.", 503);
  }
}
