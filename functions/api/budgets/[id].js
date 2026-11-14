import { authenticate } from "../../_lib/auth.js";
import { checkMutation, fail, json, readJson } from "../../_lib/http.js";
import { EXPENSE_CATEGORIES, nonNegativeCents, validMonth } from "../../_lib/validation.js";

export async function onRequestGet({ request, env, params }) {
  const auth = await authenticate(request, env);
  if (auth.response) return auth.response;
  const id = typeof params.id === "string" && params.id.length <= 64 ? params.id : "";
  if (!id) return fail("Budget not found.", 404);
  try {
    const row = await env.DB.prepare(
      "SELECT id, month, category, amount_cents FROM budgets WHERE id = ? AND user_id = ? LIMIT 1"
    ).bind(id, auth.user.id).first();
    if (!row) return fail("Budget not found.", 404);
    return json({ budget: { id: row.id, month: row.month, category: row.category === "__monthly__" ? null : row.category, amount: row.amount_cents / 100 } });
  } catch (error) {
    console.error("Could not load user budget.");
    return fail("Could not load this budget right now.", 503);
  }
}

export async function onRequestPut({ request, env, params }) {
  const originError = checkMutation(request);
  if (originError) return originError;
  const auth = await authenticate(request, env);
  if (auth.response) return auth.response;
  const id = typeof params.id === "string" && params.id.length <= 64 ? params.id : "";
  if (!id) return fail("Budget not found.", 404);
  const { data, error } = await readJson(request);
  if (error) return error;
  if (!validMonth(data.month) || (data.category !== null && !EXPENSE_CATEGORIES.includes(data.category))) return fail("Budget details are invalid.");
  const cents = nonNegativeCents(data.amount);
  if (cents === null || cents === 0) return fail("Budget amount must be greater than zero.");
  try {
    const result = await env.DB.prepare(
      "UPDATE budgets SET month = ?, category = ?, amount_cents = ?, updated_at = ? WHERE id = ? AND user_id = ?"
    ).bind(data.month, data.category || "__monthly__", cents, Math.floor(Date.now() / 1000), id, auth.user.id).run();
    if (!result.meta || result.meta.changes === 0) return fail("Budget not found.", 404);
    return json({ ok: true });
  } catch (error) {
    if (String(error && error.message).includes("UNIQUE")) return fail("That category already has a budget for this month.", 409);
    console.error("Could not update user budget.");
    return fail("Could not update this budget right now.", 503);
  }
}

export async function onRequestDelete({ request, env, params }) {
  const originError = checkMutation(request);
  if (originError) return originError;
  const auth = await authenticate(request, env);
  if (auth.response) return auth.response;
  const id = typeof params.id === "string" && params.id.length <= 64 ? params.id : "";
  if (!id) return fail("Budget not found.", 404);
  try {
    const result = await env.DB.prepare("DELETE FROM budgets WHERE id = ? AND user_id = ?").bind(id, auth.user.id).run();
    if (!result.meta || result.meta.changes === 0) return fail("Budget not found.", 404);
    return json({ ok: true });
  } catch (error) {
    console.error("Could not delete user budget.");
    return fail("Could not delete this budget right now.", 503);
  }
}
