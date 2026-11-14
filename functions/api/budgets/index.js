import { authenticate } from "../../_lib/auth.js";
import { checkMutation, fail, json, readJson } from "../../_lib/http.js";
import { EXPENSE_CATEGORIES, nonNegativeCents, validMonth } from "../../_lib/validation.js";

function toClient(row) {
  return {
    id: row.id,
    month: row.month,
    category: row.category === "__monthly__" ? null : row.category,
    amount: row.amount_cents / 100
  };
}

export async function onRequestGet({ request, env }) {
  const auth = await authenticate(request, env);
  if (auth.response) return auth.response;
  try {
    const result = await env.DB.prepare(
      "SELECT id, month, category, amount_cents FROM budgets WHERE user_id = ? ORDER BY month DESC, category ASC LIMIT 5000"
    ).bind(auth.user.id).all();
    return json({ budgets: (result.results || []).map(toClient) });
  } catch (error) {
    console.error("Could not load user budgets.");
    return fail("Could not load budgets right now.", 503);
  }
}

export async function onRequestPost({ request, env }) {
  const originError = checkMutation(request);
  if (originError) return originError;
  const auth = await authenticate(request, env);
  if (auth.response) return auth.response;
  const { data, error } = await readJson(request);
  if (error) return error;
  if (!validMonth(data.month)) return fail("Choose a valid budget month.");
  const monthlyCents = nonNegativeCents(data.monthly);
  if (monthlyCents === null) return fail("Monthly budget must be zero or a positive amount.");
  if (!data.categories || typeof data.categories !== "object" || Array.isArray(data.categories)) return fail("Category budgets are invalid.");
  const categoryRows = [];
  for (const [category, amount] of Object.entries(data.categories)) {
    if (!EXPENSE_CATEGORIES.includes(category)) return fail("One or more budget categories are invalid.");
    const cents = nonNegativeCents(amount);
    if (cents === null) return fail("Category budgets must be zero or a positive amount.");
    if (cents > 0) categoryRows.push({ category, cents });
  }
  const now = Math.floor(Date.now() / 1000);
  const statements = [
    env.DB.prepare("DELETE FROM budgets WHERE user_id = ? AND month = ?").bind(auth.user.id, data.month)
  ];
  if (monthlyCents > 0) {
    statements.push(env.DB.prepare(
      "INSERT INTO budgets (id, user_id, month, category, amount_cents, created_at, updated_at) VALUES (?, ?, ?, '__monthly__', ?, ?, ?)"
    ).bind(crypto.randomUUID(), auth.user.id, data.month, monthlyCents, now, now));
  }
  categoryRows.forEach(({ category, cents }) => statements.push(env.DB.prepare(
    "INSERT INTO budgets (id, user_id, month, category, amount_cents, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(crypto.randomUUID(), auth.user.id, data.month, category, cents, now, now)));
  try {
    await env.DB.batch(statements);
    const result = await env.DB.prepare(
      "SELECT id, month, category, amount_cents FROM budgets WHERE user_id = ? AND month = ? ORDER BY category ASC"
    ).bind(auth.user.id, data.month).all();
    return json({ budgets: (result.results || []).map(toClient) }, 201);
  } catch (error) {
    console.error("Could not save user budgets.");
    return fail("Could not save budgets right now.", 503);
  }
}
