import { authenticate } from "../../_lib/auth.js";
import { checkMutation, fail, json, readJson } from "../../_lib/http.js";
import { CURRENCIES } from "../../_lib/validation.js";

export async function onRequestGet({ request, env }) {
  const auth = await authenticate(request, env);
  if (auth.response) return auth.response;
  try {
    const row = await env.DB.prepare("SELECT currency, theme FROM user_settings WHERE user_id = ?").bind(auth.user.id).first();
    return json({ settings: { currency: row ? row.currency : "INR", theme: row ? row.theme : "light" } });
  } catch (error) {
    console.error("Could not load user settings.");
    return fail("Could not load settings right now.", 503);
  }
}

export async function onRequestPut({ request, env }) {
  const originError = checkMutation(request);
  if (originError) return originError;
  const auth = await authenticate(request, env);
  if (auth.response) return auth.response;
  const { data, error } = await readJson(request);
  if (error) return error;
  if (!CURRENCIES.includes(data.currency) || !["light", "dark"].includes(data.theme)) return fail("Settings are invalid.");
  try {
    await env.DB.prepare(
      "INSERT INTO user_settings (user_id, currency, theme, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET currency = excluded.currency, theme = excluded.theme, updated_at = excluded.updated_at"
    ).bind(auth.user.id, data.currency, data.theme, Math.floor(Date.now() / 1000)).run();
    return json({ settings: { currency: data.currency, theme: data.theme } });
  } catch (error) {
    console.error("Could not save user settings.");
    return fail("Could not save settings right now.", 503);
  }
}
