import { constantTimeEqual, passwordHash, secureToken, sha256 } from "../../_lib/auth.js";
import { checkMutation, cookieHeader, fail, json, readJson } from "../../_lib/http.js";
import { email, validPassword } from "../../_lib/validation.js";

const SESSION_SECONDS = 60 * 60 * 24;
const REMEMBER_SECONDS = 60 * 60 * 24 * 30;

export async function onRequestPost({ request, env }) {
  const originError = checkMutation(request);
  if (originError) return originError;
  const { data, error } = await readJson(request);
  if (error) return error;
  const normalizedEmail = email(data.email);
  if (!normalizedEmail || !validPassword(data.password)) {
    return fail("Email or password is incorrect.", 401);
  }

  const now = Math.floor(Date.now() / 1000);
  try {
    const user = await env.DB.prepare("SELECT id, full_name, email, password_hash, password_salt, created_at FROM users WHERE email = ? LIMIT 1")
      .bind(normalizedEmail).first();
    const salt = user ? user.password_salt : "00000000000000000000000000000000";
    const candidate = await passwordHash(data.password, salt);
    if (!user || !constantTimeEqual(candidate, user.password_hash)) {
      return fail("Email or password is incorrect.", 401);
    }

    const token = secureToken();
    const tokenHash = await sha256(token);
    const remember = data.rememberMe === true;
    const expiresIn = remember ? REMEMBER_SECONDS : SESSION_SECONDS;
    await env.DB.batch([
      env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now),
      env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
        .bind(tokenHash, user.id, now + expiresIn, now)
    ]);
    return json({
      user: { id: user.id, fullName: user.full_name, email: user.email, createdAt: user.created_at }
    }, 200, { "set-cookie": cookieHeader(token, remember ? REMEMBER_SECONDS : null) });
  } catch (error) {
    console.error("Sign-in request failed.");
    return fail("Sign-in service is temporarily unavailable.", 503);
  }
}
