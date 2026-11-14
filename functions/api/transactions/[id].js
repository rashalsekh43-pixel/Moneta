import { authenticate } from "../../_lib/auth.js";
import { checkMutation, fail, json, readJson } from "../../_lib/http.js";
import { validTransaction } from "../../_lib/validation.js";

export async function onRequestGet({ request, env, params }) {
  const auth = await authenticate(request, env);
  if (auth.response) return auth.response;
  const id = typeof params.id === "string" && params.id.length <= 64 ? params.id : "";
  if (!id) return fail("Transaction not found.", 404);
  try {
    const row = await env.DB.prepare(
      "SELECT id, title, amount_cents, type, category, transaction_date, notes FROM transactions WHERE id = ? AND user_id = ? LIMIT 1"
    ).bind(id, auth.user.id).first();
    if (!row) return fail("Transaction not found.", 404);
    return json({ transaction: { id: row.id, title: row.title, amount: row.amount_cents / 100, type: row.type, category: row.category, date: row.transaction_date, notes: row.notes } });
  } catch (error) {
    console.error("Could not load user transaction.");
    return fail("Could not load this transaction right now.", 503);
  }
}

export async function onRequestPut({ request, env, params }) {
  const originError = checkMutation(request);
  if (originError) return originError;
  const auth = await authenticate(request, env);
  if (auth.response) return auth.response;
  const id = typeof params.id === "string" && params.id.length <= 64 ? params.id : "";
  if (!id) return fail("Transaction not found.", 404);
  const { data, error } = await readJson(request);
  if (error) return error;
  const transaction = validTransaction(data);
  if (!transaction) return fail("Transaction details are invalid.");
  const now = Math.floor(Date.now() / 1000);
  try {
    const result = await env.DB.prepare(
      "UPDATE transactions SET title = ?, amount_cents = ?, type = ?, category = ?, transaction_date = ?, notes = ?, updated_at = ? WHERE id = ? AND user_id = ?"
    ).bind(transaction.title, transaction.amountCents, transaction.type, transaction.category, transaction.date, transaction.notes, now, id, auth.user.id).run();
    if (!result.meta || result.meta.changes === 0) return fail("Transaction not found.", 404);
    return json({ transaction: { id, title: transaction.title, amount: transaction.amountCents / 100, type: transaction.type, category: transaction.category, date: transaction.date, notes: transaction.notes } });
  } catch (error) {
    console.error("Could not update user transaction.");
    return fail("Could not update this transaction right now.", 503);
  }
}

export async function onRequestDelete({ request, env, params }) {
  const originError = checkMutation(request);
  if (originError) return originError;
  const auth = await authenticate(request, env);
  if (auth.response) return auth.response;
  const id = typeof params.id === "string" && params.id.length <= 64 ? params.id : "";
  if (!id) return fail("Transaction not found.", 404);
  try {
    const result = await env.DB.prepare("DELETE FROM transactions WHERE id = ? AND user_id = ?").bind(id, auth.user.id).run();
    if (!result.meta || result.meta.changes === 0) return fail("Transaction not found.", 404);
    return json({ ok: true });
  } catch (error) {
    console.error("Could not delete user transaction.");
    return fail("Could not delete this transaction right now.", 503);
  }
}
