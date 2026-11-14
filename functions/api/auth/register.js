import { randomHex, passwordHash, secureToken, sha256 } from "../../_lib/auth.js";
import { checkMutation, cookieHeader, fail, json, readJson } from "../../_lib/http.js";
import { email, text, validPassword } from "../../_lib/validation.js";

const SESSION_SECONDS = 60 * 60 * 24;

export async function onRequestPost({ request, env }) {
  const originError = checkMutation(request);
  if (originError) return originError;
  const { data, error } = await readJson(request);
  if (error) return error;
  const fullName = text(data.fullName, 80);
  const normalizedEmail = email(data.email);
  if (!fullName) return fail("Enter your name (up to 80 characters).");
  if (!normalizedEmail) return fail("Enter a valid email address.");
  if (!validPassword(data.password)) return fail("Password must be between 10 and 128 characters.");
  if (data.password !== data.confirmPassword) return fail("Passwords do not match.");

  const userId = crypto.randomUUID();
  const salt = randomHex(16);
  const hash = await passwordHash(data.password, salt);
  const token = secureToken();
  const tokenHash = await sha256(token);
  const now = Math.floor(Date.now() / 1000);
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO users (id, full_name, email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(userId, fullName, normalizedEmail, hash, salt, now),
      env.DB.prepare("INSERT INTO user_settings (user_id, currency, theme, updated_at) VALUES (?, 'INR', 'light', ?)")
        .bind(userId, now),
      env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
        .bind(tokenHash, userId, now + SESSION_SECONDS, now)
    ]);
    return json({
      user: { id: userId, fullName, email: normalizedEmail, createdAt: now }
    }, 201, { "set-cookie": cookieHeader(token, null) });
  } catch (error) {
    if (String(error && error.message).includes("UNIQUE")) return fail("An account with that email already exists.", 409);
    console.error("Account registration failed.");
    return fail("Could not create your account right now.", 503);
  }
}
