// The session cookie holds a hash of the password, so changing STATS_PASSWORD signs everyone out.
// Works in both the Edge middleware and Node functions (Web Crypto).
export const COOKIE = "st_session";

export async function sessionToken(password) {
  const bytes = new TextEncoder().encode(`${password}|setsuna-stats-v1`);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function readCookie(header, name) {
  for (const part of (header ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

// Constant-time comparison of two equal-length hex strings.
export function same(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
