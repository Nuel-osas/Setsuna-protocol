// Everything except the sign-in page, its handler, the font and the bridge's report endpoint needs a
// valid session cookie. The report endpoint is public by design and verifies each report with Circle.
import { next } from "@vercel/functions";
import { COOKIE, readCookie, same, sessionToken } from "./lib/session.js";

export const config = { matcher: ["/((?!login|api/login|api/bridge-report|fonts/).*)"] };

export default async function middleware(request) {
  const password = process.env.STATS_PASSWORD;
  if (!password) return new Response("Stats are not configured.", { status: 503 });
  const ok = same(readCookie(request.headers.get("cookie"), COOKIE), await sessionToken(password));
  if (ok) return next();
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) return new Response("Sign in first.", { status: 401 });
  return Response.redirect(new URL("/login", url), 303);
}
