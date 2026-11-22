import { authenticate } from "../../_lib/auth.js";
import { checkMutation, fail, json, readJson } from "../../_lib/http.js";
import { explainMonthlySummary, getMonthlySnapshot } from "../../_lib/finance.js";

const AI_MODEL = "@cf/meta/llama-3.1-8b-instruct";
const GEMINI_MODEL = "gemini-3.8-flash";

function safeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function buildFallbackReply(message, snapshot) {
  const guidance = explainMonthlySummary(snapshot);
  const normalized = safeText(message).toLowerCase();

  if (normalized.includes("budget") || normalized.includes("limit") || normalized.includes("over")) {
    return `${guidance.summary} ${guidance.budget} ${guidance.topCategory}`;
  }
  if (normalized.includes("compare") || normalized.includes("last month") || normalized.includes("month")) {
    return `${guidance.summary} ${guidance.categories}`;
  }
  if (normalized.includes("save") || normalized.includes("savings")) {
    return `${guidance.summary} Based on the current month, your savings are ${Number(snapshot.netCents / 100).toFixed(2)}.`;
  }
  const defaultSummary = `${guidance.summary} ${guidance.topCategory} ${guidance.budget}`;
  return defaultSummary;
}

async function askGemini(env, userMessage, snapshot) {
  const apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.GOOGLE_GENAI_API_KEY;
  if (!apiKey) return null;

  const prompt = [
    "You are Moneta's private finance assistant. Use only the verified data in the provided snapshot.",
    "Do not invent transactions, budgets, or totals. Keep answers concise, grounded in facts, and in the user language if possible.",
    `Verified financial snapshot: ${JSON.stringify({
      month: snapshot.month,
      incomeCents: snapshot.incomeCents,
      expenseCents: snapshot.expenseCents,
      netCents: snapshot.netCents,
      monthlyBudgetCents: snapshot.monthlyBudgetCents,
      budgetRemainingCents: snapshot.budgetRemainingCents,
      categoryBreakdown: snapshot.categoryBreakdown
    })}`,
    `User question: ${userMessage}`
  ].join("\n");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: "Use verified financial data only, and answer in plain language." }]
        },
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 512
        },
        contents: [{
          role: "user",
          parts: [{ text: prompt }]
        }]
      })
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(`Gemini request failed (${response.status}).`);
  }

  const payload = await response.json();
  const candidateText = (payload?.candidates || [])
    .map((candidate) => (candidate?.content?.parts || [])
      .map((part) => part?.text || "")
      .join(" "))
    .join(" \n");

  if (candidateText.trim()) return candidateText.trim();
  return null;
}

async function askAi(env, userMessage, snapshot) {
  const geminiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.GOOGLE_GENAI_API_KEY;

  if (geminiKey) {
    try {
      const geminiReply = await askGemini(env, userMessage, snapshot);
      if (geminiReply) return geminiReply;
    } catch (error) {
      console.error("Gemini model request failed:", error instanceof Error ? error.message : "Unknown error.");
    }
  }

  if (!env.AI || typeof env.AI.run !== "function") {
    return buildFallbackReply(userMessage, snapshot);
  }

  try {
    const result = await env.AI.run(AI_MODEL, {
      messages: [
        { role: "system", content: "Use verified financial data only, and answer in plain language." },
        { role: "user", content: [
          "You are Moneta's private finance assistant. Use only the verified data in the provided snapshot.",
          "Do not invent transactions, budgets, or totals. Keep answers concise, grounded in facts, and in the user language if possible.",
          `Verified financial snapshot: ${JSON.stringify({
            month: snapshot.month,
            incomeCents: snapshot.incomeCents,
            expenseCents: snapshot.expenseCents,
            netCents: snapshot.netCents,
            monthlyBudgetCents: snapshot.monthlyBudgetCents,
            budgetRemainingCents: snapshot.budgetRemainingCents,
            categoryBreakdown: snapshot.categoryBreakdown
          })}`,
          `User question: ${userMessage}`
        ].join("\n") }
      ]
    });

    if (typeof result === "string") return result;
    if (Array.isArray(result)) {
      const text = result.map((entry) => typeof entry === "string" ? entry : entry?.response || entry?.content || "").join(" ");
      if (text.trim()) return text.trim();
    }
    if (result && typeof result.response === "string") return result.response;
    if (result && Array.isArray(result.result)) {
      const text = result.result.map((entry) => typeof entry === "string" ? entry : entry?.response || entry?.content || "").join(" ");
      if (text.trim()) return text.trim();
    }
    return buildFallbackReply(userMessage, snapshot);
  } catch (error) {
    console.error("AI model request failed.", error);
    return buildFallbackReply(userMessage, snapshot);
  }
}

export async function onRequestGet({ request, env }) {
  const auth = await authenticate(request, env);
  if (auth.response) return auth.response;

  const url = new URL(request.url);
  const requestedConversationId = safeText(url.searchParams.get("conversationId"));

  try {
    if (requestedConversationId) {
      const conversation = await env.DB.prepare(
        "SELECT id, title FROM ai_conversations WHERE id = ? AND user_id = ? LIMIT 1"
      ).bind(requestedConversationId, auth.user.id).first();
      if (!conversation) return fail("Conversation not found.", 404);
      const messageRows = await env.DB.prepare(
        "SELECT id, role, content, created_at FROM ai_messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 100"
      ).bind(conversation.id).all();
      return json({
        conversation: { id: conversation.id, title: conversation.title },
        messages: (messageRows.results || []).map((row) => ({
          id: row.id,
          role: row.role,
          content: row.content,
          createdAt: row.created_at
        }))
      });
    }

    const rows = await env.DB.prepare(
      "SELECT id, title, updated_at FROM ai_conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 20"
    ).bind(auth.user.id).all();
    return json({ conversations: (rows.results || []).map((row) => ({
      id: row.id,
      title: row.title,
      updatedAt: row.updated_at
    })) });
  } catch (error) {
    console.error("Could not load AI conversations.", error);
    return fail("Could not load your chat history right now.", 503);
  }
}

export async function onRequestPost({ request, env }) {
  const originError = checkMutation(request);
  if (originError) return originError;
  const auth = await authenticate(request, env);
  if (auth.response) return auth.response;

  const { data, error } = await readJson(request);
  if (error) return error;

  const message = safeText(data.message);
  const conversationId = safeText(data.conversationId);
  const locale = typeof data.locale === "string" ? data.locale.slice(0, 10) : "en";
  if (!message || message.length > 2000) return fail("Message length must be between 1 and 2000 characters.");

  const now = Math.floor(Date.now() / 1000);
  try {
    let currentConversationId = conversationId || crypto.randomUUID();
    if (conversationId) {
      const conversation = await env.DB.prepare(
        "SELECT id FROM ai_conversations WHERE id = ? AND user_id = ? LIMIT 1"
      ).bind(conversationId, auth.user.id).first();
      if (!conversation) return fail("Conversation not found.", 404);
      currentConversationId = conversation.id;
    } else {
      const title = message.length > 80 ? `${message.slice(0, 77)}...` : message;
      await env.DB.prepare(
        "INSERT INTO ai_conversations (id, user_id, title, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)"
      ).bind(currentConversationId, auth.user.id, title, now, now).run();
    }

    const userMessageId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO ai_messages (id, conversation_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)"
    ).bind(userMessageId, currentConversationId, message, now).run();

    const snapshot = await getMonthlySnapshot(env, auth.user.id, new Date().toISOString().slice(0, 7));
    const responseText = await askAi(env, message, snapshot);
    const assistantMessageId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO ai_messages (id, conversation_id, role, content, created_at) VALUES (?, ?, 'assistant', ?, ?)"
    ).bind(assistantMessageId, currentConversationId, responseText, Math.floor(Date.now() / 1000)).run();

    await env.DB.prepare(
      "UPDATE ai_conversations SET updated_at = ?, title = COALESCE(title, 'New chat') WHERE id = ?"
    ).bind(Math.floor(Date.now() / 1000), currentConversationId).run();

    return json({
      conversationId: currentConversationId,
      message: { id: userMessageId, role: "user", content: message, createdAt: now },
      reply: { id: assistantMessageId, role: "assistant", content: responseText, createdAt: Math.floor(Date.now() / 1000) },
      locale
    }, 200);
  } catch (error) {
    console.error("AI chat request failed.", error);
    return fail("Your AI request could not be processed right now.", 503);
  }
}
