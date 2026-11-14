import { constantTimeEqual, passwordHash, secureToken, sha256 } from "../../_lib/auth.js";
import { checkMutation, cookieHeader, fail, json, readJson } from "../../_lib/http.js";
import { email } from "../../_lib/validation.js";

const SESSION_SECONDS = 60 * 60 * 24;
const REMEMBER_SECONDS = 60 * 60 * 24 * 30;
const WINDOW_SECONDS = 15 * 60;
const MAX_ATTEMPTS = 5;

async function incrementAttempt(env, key, now) {
  const cutoff = now - WINDOW_SECONDS;
  const row = await env.DB.prepare(
    "INSERT INTO login_attempts (attempt_key, attempts, window_started_at) VALUES (?, 1, ?) ON CONFLICT(attempt_key) DO UPDATE SET attempts = CASE WHEN login_attempts.window_started_at <= ? THEN 1 ELSE login_attempts.attempts + 1 END, window_started_at = CASE WHEN login_attempts.window_started_at <= ? THEN excluded.window_started_at ELSE login_attempts.window_started_at END RETURNING attempts"
  ).bind(key, now, cutoff, cutoff).first();
  return Number(row && row.attempts) || 0;
}

export async function onRequestPost({ request, env }) {
  const originError = checkMutation(request);
  if (originError) return originError;
  const { data, error } = await readJson(request);
  if (error) return error;
  const normalizedEmail = email(data.email);
  if (!normalizedEmail || typeof data.password !== "string" || data.password.length > 128) {
    return fail("Email or password is incorrect.", 401);
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const emailKey = `email:${await sha256(normalizedEmail)}`;
  const ipKey = `ip:${await sha256(ip)}`;
  const now = Math.floor(Date.now() / 1000);
  try {
    await env.DB.prepare("DELETE FROM login_attempts WHERE window_started_at <= ?").bind(now - WINDOW_SECONDS).run();
    const storedAttempts = await env.DB.prepare(
      "SELECT attempt_key, attempts FROM login_attempts WHERE attempt_key IN (?, ?)"
    ).bind(emailKey, ipKey).all();
    const attemptCounts = new Map((storedAttempts.results || []).map((row) => [row.attempt_key, Number(row.attempts)]));
    if ((attemptCounts.get(emailKey) || 0) >= MAX_ATTEMPTS || (attemptCounts.get(ipKey) || 0) >= MAX_ATTEMPTS) {
      return fail("Too many sign-in attempts. Try again in 15 minutes.", 429);
    }

    const user = await env.DB.prepare("SELECT id, full_name, email, password_hash, password_salt, created_at FROM users WHERE email = ? LIMIT 1")
      .bind(normalizedEmail).first();
    const salt = user ? user.password_salt : "00000000000000000000000000000000";
    const candidate = await passwordHash(data.password, salt);
    if (!user || !constantTimeEqual(candidate, user.password_hash)) {
      const [emailAttempts, ipAttempts] = await Promise.all([
        incrementAttempt(env, emailKey, now),
        incrementAttempt(env, ipKey, now)
      ]);
      if (emailAttempts > MAX_ATTEMPTS || ipAttempts > MAX_ATTEMPTS) {
        return fail("Too many sign-in attempts. Try again in 15 minutes.", 429);
      }
      return fail("Email or password is incorrect.", 401);
    }

    const token = secureToken();
    const tokenHash = await sha256(token);
    const remember = data.rememberMe === true;
    const expiresIn = remember ? REMEMBER_SECONDS : SESSION_SECONDS;
    await env.DB.batch([
      env.DB.prepare("DELETE FROM login_attempts WHERE attempt_key = ?").bind(emailKey),
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
