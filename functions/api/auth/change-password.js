import { authenticate, constantTimeEqual, passwordHash, randomHex, sha256 } from "../../_lib/auth.js";
import { checkMutation, fail, json, readJson } from "../../_lib/http.js";
import { validPassword } from "../../_lib/validation.js";

export async function onRequestPost({ request, env }) {
  const originError = checkMutation(request);
  if (originError) return originError;
  const auth = await authenticate(request, env);
  if (auth.response) return auth.response;
  const { data, error } = await readJson(request);
  if (error) return error;
  if (typeof data.currentPassword !== "string" || data.currentPassword.length > 128) return fail("Current password is required.", 400);
  if (!validPassword(data.newPassword)) return fail("New password must be between 10 and 128 characters.");
  if (data.newPassword !== data.confirmPassword) return fail("New passwords do not match.");
  if (data.currentPassword === data.newPassword) return fail("Choose a password different from your current one.");

  try {
    const row = await env.DB.prepare("SELECT password_hash, password_salt FROM users WHERE id = ?").bind(auth.user.id).first();
    if (!row || !constantTimeEqual(await passwordHash(data.currentPassword, row.password_salt), row.password_hash)) {
      return fail("Current password is incorrect.", 401);
    }
    const salt = randomHex(16);
    const hash = await passwordHash(data.newPassword, salt);
    const now = Math.floor(Date.now() / 1000);
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?").bind(hash, salt, auth.user.id),
      env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").bind(auth.user.id, auth.tokenHash),
      env.DB.prepare("DELETE FROM login_attempts WHERE attempt_key = ?").bind(`email:${await sha256(auth.user.email)}`)
    ]);
    return json({ ok: true, message: "Password updated. Other sessions have been signed out." });
  } catch (error) {
    console.error("Password update failed.");
    return fail("Could not update your password right now.", 503);
  }
}
