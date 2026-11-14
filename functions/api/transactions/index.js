import { authenticate } from "../../_lib/auth.js";
import { checkMutation, fail, json, readJson } from "../../_lib/http.js";
import { validTransaction } from "../../_lib/validation.js";

function toClient(row) {
  return {
    id: row.id,
    title: row.title,
    amount: row.amount_cents / 100,
    type: row.type,
    category: row.category,
    date: row.transaction_date,
    notes: row.notes
  };
}

export async function onRequestGet({ request, env }) {
  const auth = await authenticate(request, env);
  if (auth.response) return auth.response;
  try {
    const result = await env.DB.prepare(
      "SELECT id, title, amount_cents, type, category, transaction_date, notes FROM transactions WHERE user_id = ? ORDER BY transaction_date DESC, created_at DESC LIMIT 10000"
    ).bind(auth.user.id).all();
    return json({ transactions: (result.results || []).map(toClient) });
  } catch (error) {
    console.error("Could not load user transactions.");
    return fail("Could not load transactions right now.", 503);
  }
}

export async function onRequestPost({ request, env }) {
  const originError = checkMutation(request);
  if (originError) return originError;
  const auth = await authenticate(request, env);
  if (auth.response) return auth.response;
  const { data, error } = await readJson(request);
  if (error) return error;
  const transaction = validTransaction(data);
  if (!transaction) return fail("Transaction details are invalid.");
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  try {
    await env.DB.prepare(
      "INSERT INTO transactions (id, user_id, title, amount_cents, type, category, transaction_date, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(id, auth.user.id, transaction.title, transaction.amountCents, transaction.type, transaction.category, transaction.date, transaction.notes, now, now).run();
    return json({ transaction: { id, title: transaction.title, amount: transaction.amountCents / 100, type: transaction.type, category: transaction.category, date: transaction.date, notes: transaction.notes } }, 201);
  } catch (error) {
    console.error("Could not create user transaction.");
    return fail("Could not save this transaction right now.", 503);
  }
}
