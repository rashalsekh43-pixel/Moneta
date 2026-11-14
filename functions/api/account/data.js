import { authenticate } from "../../_lib/auth.js";
import { checkMutation, fail, json } from "../../_lib/http.js";

export async function onRequestDelete({ request, env }) {
  const originError = checkMutation(request);
  if (originError) return originError;
  const auth = await authenticate(request, env);
  if (auth.response) return auth.response;
  try {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM transactions WHERE user_id = ?").bind(auth.user.id),
      env.DB.prepare("DELETE FROM budgets WHERE user_id = ?").bind(auth.user.id)
    ]);
    return json({ ok: true });
  } catch (error) {
    console.error("Could not clear user financial data.");
    return fail("Could not clear your financial data right now.", 503);
  }
}
