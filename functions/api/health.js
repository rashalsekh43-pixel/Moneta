import { json } from "../_lib/http.js";

export async function onRequestGet({ env }) {
  try {
    await env.DB.prepare("SELECT 1 AS ok").first();
    return json({ ok: true, database: "connected" });
  } catch (error) {
    console.error("Health check could not reach D1.");
    return json({ ok: false, database: "unavailable" }, 503);
  }
}
