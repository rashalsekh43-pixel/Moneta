export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }
  });
}

export function fail(message, status = 400) {
  return json({ error: message }, status);
}

export function isSameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export async function readJson(request, maxBytes = 16_384) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return { error: fail("Content-Type must be application/json.", 415) };
  }
  const length = Number(request.headers.get("content-length") || 0);
  if (length > maxBytes) return { error: fail("Request body is too large.", 413) };
  const reader = request.body && request.body.getReader();
  if (!reader) return { error: fail("Request body is required.", 400) };
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { error: fail("Request body is too large.", 413) };
      }
      chunks.push(value);
    }
  } catch {
    return { error: fail("Could not read request body.", 400) };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });
  const text = new TextDecoder().decode(bytes);
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data)) return { error: fail("Request body must be a JSON object.") };
    return { data };
  } catch {
    return { error: fail("Request body contains invalid JSON.") };
  }
}

export function checkMutation(request) {
  if (!isSameOrigin(request)) return fail("Request origin is not allowed.", 403);
  return null;
}

export function cookieHeader(token, maxAge) {
  const maxAgeAttribute = Number.isFinite(maxAge) ? `; Max-Age=${Math.max(0, Math.floor(maxAge))}` : "";
  return `__Host-moneta_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict${maxAgeAttribute}`;
}

export function clearCookieHeader() {
  return "__Host-moneta_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0";
}
