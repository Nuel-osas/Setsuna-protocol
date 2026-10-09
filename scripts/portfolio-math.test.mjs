import assert from "node:assert/strict";
import { test } from "node:test";
import {
  earnTotal,
  ausdTotal,
  positionEquity,
} from "../src/lib/setsuna/portfolio-math.ts";

const ready = (data) => ({ status: "ready", data });
const unavailable = { status: "unavailable" };
const absent = { status: "not-configured" };
const snapshot = (overrides) => ({
  walletBalance: 100000000n,
  reserve: 20000000n,
  accountId: 1n,
  policyId: 0n,
  freeTrading: 300000000n,
  activity: [],
  historyUnavailable: false,
  block: 1n,
  position: {
    positionType: 0,
    lotLNS: 1000n,
    depositCNS: 50000000n,
    pricePNS: 800000n,
    deltaPnlCNS: -7000000n,
    premiumPnlCNS: 2000000n,
  },
  ...overrides,
});

test("Earn totals count underlying redemption value once, never share units", () => {
  assert.equal(
    earnTotal(
      ready(600000000n),
      ready({ shares: 200000000000000n, worth: 400000020n, healthy: true }),
    ),
    1000000020n,
  );
});
test("unknown or unhealthy Earn reads cannot masquerade as a zero position", () => {
  const holding = ready({ shares: 200n, worth: 100n, healthy: true });
  assert.equal(earnTotal(unavailable, holding), undefined);
  assert.equal(earnTotal(ready(100n), unavailable), undefined);
  assert.equal(
    earnTotal(ready(100n), ready({ shares: 200n, healthy: false })),
    undefined,
  );
  assert.equal(
    earnTotal(ready(100n), ready({ shares: 200n, healthy: true })),
    undefined,
  );
  assert.equal(earnTotal(ready(100n), absent), 100n);
});
test("MON arithmetic preserves full native-token precision", () => {
  assert.equal(
    earnTotal(
      ready(1234567890123456789n),
      ready({
        shares: 999999999999999999999999n,
        healthy: true,
        worth: 1000000000000000001n,
      }),
    ),
    2234567890123456790n,
  );
});
test("AUSD includes free balance, reserve and open equity without recounting wallet balance", () => {
  const p = snapshot();
  assert.equal(positionEquity(p), 45000000n);
  assert.equal(ausdTotal(ready(p.walletBalance), ready(p)), 465000000n);
});
test("settled position values do not add already-settled P&L a second time", () => {
  const p = snapshot({ freeTrading: 345000000n });
  p.position.lotLNS = 0n;
  assert.equal(positionEquity(p), 0n);
  assert.equal(ausdTotal(ready(p.walletBalance), ready(p)), 465000000n);
});
test("missing registered account reads stay unavailable; a verified absent account contributes zero", () => {
  assert.equal(ausdTotal(ready(100n), unavailable), undefined);
  assert.equal(ausdTotal(unavailable, ready(snapshot())), undefined);
  assert.equal(
    ausdTotal(ready(100n), ready(snapshot({ freeTrading: undefined }))),
    undefined,
  );
  assert.equal(
    ausdTotal(ready(100n), ready(snapshot({ position: undefined }))),
    undefined,
  );
  assert.equal(
    ausdTotal(
      ready(100n),
      ready(
        snapshot({
          accountId: 0n,
          position: undefined,
          freeTrading: undefined,
          reserve: 0n,
        }),
      ),
    ),
    100n,
  );
  assert.equal(ausdTotal(ready(100n), absent), 100n);
});
test("negative position equity is not silently clamped away", () => {
  const p = snapshot();
  p.position.deltaPnlCNS = -60000000n;
  assert.equal(positionEquity(p), -8000000n);
  assert.equal(ausdTotal(ready(p.walletBalance), ready(p)), 412000000n);
});
