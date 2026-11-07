// Everything except the sign-in page, its handler, the font and the bridge's two endpoints needs a
// valid session cookie. Those are public by design: reports are verified with Circle, and lookups
// return only what is already public on-chain.
import { next } from "@vercel/functions";
import { COOKIE, readCookie, same, sessionToken } from "./lib/session.js";

export const config = { matcher: ["/((?!login|api/login|api/bridge-report|api/bridge-transfers|fonts/).*)"] };

export default async function middleware(request) {
  const password = process.env.STATS_PASSWORD;
  if (!password) return new Response("Stats are not configured.", { status: 503 });
  const ok = same(readCookie(request.headers.get("cookie"), COOKIE), await sessionToken(password));
  if (ok) return next();
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) return new Response("Sign in first.", { status: 401 });
  return Response.redirect(new URL("/login", url), 303);
}
