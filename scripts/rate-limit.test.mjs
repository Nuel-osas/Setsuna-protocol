import assert from "node:assert/strict";
import { test } from "node:test";
import { clientIP, createRateLimit } from "../src/lib/setsuna/rate-limit.ts";

test("limits each key per window, resets, and stays bounded", () => {
  let now = 0;
  const allow = createRateLimit(2, 1000, 2, () => now);
  assert.deepEqual([allow("a"), allow("a"), allow("a")], [true, true, false]);
  assert.equal(allow("b"), true, "Keys are independent");
  now = 1000;
  assert.equal(allow("a"), true, "Window resets");
  allow("c");
  assert.equal(allow("a"), true, "Eviction never blocks a new window");
});

test("client address prefers the platform-set header", () => {
  const r = (h) => new Request("https://x.test", { headers: h });
  assert.equal(
    clientIP(r({ "x-real-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" })),
    "1.1.1.1",
  );
  assert.equal(
    clientIP(r({ "x-forwarded-for": "3.3.3.3, 4.4.4.4" })),
    "3.3.3.3",
  );
  assert.equal(clientIP(r({})), "unknown");
});
