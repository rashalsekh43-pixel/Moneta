import { authenticate } from "../../_lib/auth.js";
import { checkMutation, fail, json, readJson } from "../../_lib/http.js";
import { email, text } from "../../_lib/validation.js";

export async function onRequestPut({ request, env }) {
  const originError = checkMutation(request);
  if (originError) return originError;
  const auth = await authenticate(request, env);
  if (auth.response) return auth.response;
  const { data, error } = await readJson(request);
  if (error) return error;
  const fullName = text(data.fullName, 80);
  const normalizedEmail = email(data.email);
  if (!fullName || !normalizedEmail) return fail("Enter a valid name and email address.");
  try {
    const result = await env.DB.prepare("UPDATE users SET full_name = ?, email = ? WHERE id = ?")
      .bind(fullName, normalizedEmail, auth.user.id).run();
    if (!result.meta || result.meta.changes === 0) return fail("Account not found.", 404);
    return json({ user: { ...auth.user, fullName, email: normalizedEmail } });
  } catch (error) {
    if (String(error && error.message).includes("UNIQUE")) return fail("An account with that email already exists.", 409);
    console.error("Could not update account profile.");
    return fail("Could not save your profile right now.", 503);
  }
}
