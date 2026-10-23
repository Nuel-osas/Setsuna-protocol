// POST /api/login with form field "password". A wrong password waits a second before answering.
import { COOKIE, same, sessionToken } from "../lib/session.js";

export async function POST(request) {
  const password = process.env.STATS_PASSWORD;
  if (!password) return new Response("Stats are not configured.", { status: 503 });
  const form = await request.formData().catch(() => null);
  const given = String(form?.get("password") ?? "");
  const [want, got] = await Promise.all([sessionToken(password), sessionToken(given)]);
  const url = new URL(request.url);
  if (!same(got, want)) {
    await new Promise((r) => setTimeout(r, 1000));
    return Response.redirect(new URL("/login?wrong=1", url), 303);
  }
  return new Response(null, {
    status: 303,
    headers: {
      Location: new URL("/", url).toString(),
      "Set-Cookie": `${COOKIE}=${want}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`,
    },
  });
}
