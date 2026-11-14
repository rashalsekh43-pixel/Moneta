import { authenticate } from "../../_lib/auth.js";
import { checkMutation, clearCookieHeader, json } from "../../_lib/http.js";

export async function onRequestPost({ request, env }) {
  const originError = checkMutation(request);
  if (originError) return originError;
  const auth = await authenticate(request, env);
  if (auth.tokenHash) {
    try {
      await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(auth.tokenHash).run();
    } catch (error) {
      console.error("Could not invalidate session during sign-out.");
      return json({ error: "Could not sign out. Please try again." }, 503);
    }
  }
  return json({ ok: true }, 200, { "set-cookie": clearCookieHeader() });
}
