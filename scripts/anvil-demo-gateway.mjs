import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { open, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { gunzipSync } from "node:zlib";
import { setTimeout as delay } from "node:timers/promises";
import { decodeFunctionData, parseAbi } from "viem";
import { validRPCPayload } from "../src/lib/setsuna/demo-config.ts";

const adminMethods = new Set([
  "anvil_impersonateAccount",
  "anvil_stopImpersonatingAccount",
  "anvil_setBalance",
  "anvil_setCode",
  "anvil_setStorageAt",
  "eth_sendTransaction",
  "eth_getStorageAt",
  "debug_traceCall",
]);
const mutations = new Set([
  "eth_sendRawTransaction",
  "eth_sendTransaction",
  "anvil_setBalance",
  "anvil_setCode",
  "anvil_setStorageAt",
]);
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

export async function atomicJSON(path, value) {
  const temporary = `${path}.tmp`;
  const handle = await open(temporary, "w", 0o600);
  try {
    await handle.writeFile(
      typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n",
    );
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
  const directory = await open(dirname(path), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

export async function createDemoGateway({
  upstream,
  token,
  faucetToken,
  statePath,
  port,
  adminPort,
  ready,
  available = ready,
  manifest,
  fatal,
}) {
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new Error("Gateway token must contain 32 random bytes");
  if (!/^[a-f0-9]{64}$/.test(faucetToken) || faucetToken === token)
    throw new Error("A separate faucet token is required");
  let writes = Promise.resolve(),
    upstreamRequests = Promise.resolve(),
    closing = false,
    active = 0;
  const requestSingle = async (payload) => {
    const started = Date.now();
    const methods = (Array.isArray(payload) ? payload : [payload]).map(
      (p) => p.method,
    );
    try {
      const response = await fetch(upstream, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(25000),
      });
      if (!response.ok) throw new Error("Internal fork unavailable");
      return await response.json();
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "upstream-rpc-failed",
          methods,
          error: error.name,
          ms: Date.now() - started,
        }),
      );
      throw error;
    } finally {
      if (Date.now() - started > 3000)
        console.log(
          JSON.stringify({
            event: "slow-upstream-rpc",
            methods,
            ms: Date.now() - started,
          }),
        );
    }
  };
  // Fork reads can fetch remote state while holding Anvil database locks.
  // Avoid interleaving these reads with mining/state export on the shared node.
  const request = (payload) => {
    const next = upstreamRequests.then(async () => {
      if (!Array.isArray(payload)) return requestSingle(payload);
      const responses = [];
      for (const entry of payload) responses.push(await requestSingle(entry));
      return responses;
    });
    upstreamRequests = next.catch(() => {});
    return next;
  };
  const rpc = async (method, params = []) => {
    const result = await request({ jsonrpc: "2.0", id: 1, method, params });
    if (result.error) throw new Error("Internal fork operation failed");
    return result.result;
  };
  const checkpoint = async (hashes = []) => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const before = await rpc("eth_getBlockByNumber", ["latest", false]);
      const bytes = await rpc("anvil_dumpState");
      const json = gunzipSync(Buffer.from(bytes.slice(2), "hex")).toString();
      const state = JSON.parse(json);
      const after = await rpc("eth_getBlockByNumber", ["latest", false]);
      if (!state.accounts || !state.block || !state.transactions)
        throw new Error("Incomplete fork snapshot");
      // Anvil can return a send hash before automining finishes. Its state dump
      // also reads account state and receipt metadata under separate locks.
      const coherent =
        before.hash === after.hash &&
        BigInt(state.block.number) === BigInt(after.number) &&
        BigInt(state.best_block_number) === BigInt(after.number);
      const containsReceipts = hashes.every((hash) =>
        state.transactions.some(
          (tx) =>
            tx.info.transaction_hash.toLowerCase() === hash.toLowerCase() &&
            tx.receipt,
        ),
      );
      if (coherent && containsReceipts) {
        await atomicJSON(statePath, json);
        return;
      }
      await delay(100);
    }
    throw new Error("Fork snapshot was not coherent");
  };
  const enqueue = (fn) => {
    const next = writes.then(fn);
    writes = next.catch(() => {});
    return next;
  };
  const send = (res, status, value) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(value));
  };
  const render = (res, title, content) => {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(
      `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)} · Setsuna</title><style>body{font:16px/1.6 system-ui,sans-serif;background:#071725;color:#e1f2fb;max-width:900px;margin:64px auto;padding:0 24px}a{color:#70caff}h1{font-size:32px}p{color:#a8c7da}table{width:100%;border-collapse:collapse}td{padding:12px 0;border-bottom:1px solid #214359;overflow-wrap:anywhere}td:first-child{width:180px;color:#9bb9cd}input{padding:14px;width:75%;background:#132d40;color:white;border:1px solid #34556a;border-radius:8px}button{padding:14px;background:#78d4ff;border:0;border-radius:8px}code{overflow-wrap:anywhere;font-size:13px}</style><a href="/">Setsuna Demo Explorer</a><h1>${escape(title)}</h1><p>Monad mainnet fork · Chain 31337 · Synthetic test funds</p>${content}<p>Transactions here execute on the Setsuna demonstration fork. They are not Monad mainnet transactions. Perps uses a disclosed fixed historical price.</p></html>`,
    );
  };
  const handler = (internal) => async (req, res) => {
    if (++active > 64) {
      active--;
      return send(res, 429, { error: "Try again shortly" });
    }
    try {
      const url = new URL(req.url, "http://localhost");
      if (!internal && req.method === "GET" && url.pathname === "/health")
        return send(res, ready() && !closing ? 200 : 503, {
          ready: ready() && !closing,
          environment: "synthetic-monad-fork",
        });
      if (
        !internal &&
        req.method === "GET" &&
        (url.pathname === "/" ||
          /^\/(tx|address)\/0x[0-9a-fA-F]+$/.test(url.pathname))
      ) {
        if (!ready() || closing)
          return send(res, 503, { error: "Demo is starting" });
        await writes;
        const hash = url.searchParams.get("hash");
        if (url.pathname === "/" && hash && /^0x[0-9a-fA-F]{64}$/.test(hash)) {
          res.writeHead(303, { Location: `/tx/${hash}` });
          return res.end();
        }
        if (url.pathname.startsWith("/tx/")) {
          const txHash = url.pathname.slice(4);
          if (!/^0x[0-9a-fA-F]{64}$/.test(txHash))
            return send(res, 400, { error: "Invalid transaction hash" });
          const [tx, receipt] = await Promise.all([
            rpc("eth_getTransactionByHash", [txHash]),
            rpc("eth_getTransactionReceipt", [txHash]),
          ]);
          if (!tx || !receipt)
            return send(res, 404, {
              error: "Transaction not yet confirmed on this demo",
            });
          const rows = [
            ["Hash", txHash],
            ["Status", receipt.status === "0x1" ? "Confirmed" : "Reverted"],
            ["Block", BigInt(receipt.blockNumber).toString()],
            ["From", tx.from],
            ["To", tx.to ?? receipt.contractAddress],
            ["Gas used", BigInt(receipt.gasUsed).toString()],
            ["Events", receipt.logs.length],
          ];
          return render(
            res,
            "Transaction",
            `<table>${rows.map(([key, value]) => `<tr><td>${escape(key)}</td><td><code>${escape(value)}</code></td></tr>`).join("")}</table>`,
          );
        }
        if (url.pathname.startsWith("/address/")) {
          const address = url.pathname.slice(9);
          if (!/^0x[0-9a-fA-F]{40}$/.test(address))
            return send(res, 400, { error: "Invalid address" });
          const [balance, code] = await Promise.all([
            rpc("eth_getBalance", [address, "latest"]),
            rpc("eth_getCode", [address, "latest"]),
          ]);
          return render(
            res,
            "Address",
            `<p><code>${escape(address)}</code></p><table><tr><td>Native balance</td><td>${escape(BigInt(balance).toString())} wei</td></tr><tr><td>Contract bytecode</td><td>${(code.length - 2) / 2} bytes</td></tr></table>`,
          );
        }
        return render(
          res,
          "Verify a demo transaction",
          `<form method="get"><input name="hash" placeholder="Transaction hash (0x…)" aria-label="Transaction hash" required pattern="0x[0-9a-fA-F]{64}"><button>View</button></form>`,
        );
      }
      const matches = (path) => {
        const expected = Buffer.from(path),
          supplied = Buffer.from(url.pathname);
        return (
          expected.length === supplied.length &&
          timingSafeEqual(expected, supplied)
        );
      };
      const faucetMode = !internal && matches(`/faucet/${faucetToken}`);
      if (!internal && !matches(`/${token}`) && !faucetMode)
        return send(res, 404, { error: "Not found" });
      if (!internal && (!available() || closing))
        return send(res, 503, { error: "Demo unavailable" });
      if (!internal && !faucetMode && req.method === "GET")
        return send(res, 200, { manifest: manifest() });
      if (req.method !== "POST")
        return send(res, 405, { error: "POST required" });
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 131072)
          return send(res, 413, { error: "Request too large" });
      }
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        return send(res, 400, { error: "Invalid JSON" });
      }
      const entries = Array.isArray(payload) ? payload : [payload];
      let claim;
      if (
        faucetMode &&
        !Array.isArray(payload) &&
        payload?.method === "eth_sendTransaction"
      ) {
        try {
          const m = manifest(),
            tx = payload.params?.[0];
          if (
            payload.jsonrpc !== "2.0" ||
            !["string", "number"].includes(typeof payload.id) ||
            payload.params.length !== 1 ||
            !tx ||
            tx.to?.toLowerCase() !== m.faucet.toLowerCase() ||
            tx.from?.toLowerCase() !==
              m.faucetDeployment.dispatcher.toLowerCase() ||
            BigInt(tx.value ?? 0) !== 0n
          )
            throw new Error();
          const decoded = decodeFunctionData({
            abi: parseAbi(["function claim(address)"]),
            data: tx.data,
          });
          if (
            decoded.functionName !== "claim" ||
            !/^0x[0-9a-fA-F]{72}$/.test(tx.data)
          )
            throw new Error();
          claim = {
            from: m.faucetDeployment.dispatcher,
            to: m.faucet,
            data: tx.data,
            gas: "0x7a120",
          };
        } catch {
          return send(res, 403, {
            error: "Only the configured bounded faucet claim is available",
          });
        }
      }
      const permitted = faucetMode
        ? Boolean(claim) ||
          (validRPCPayload(payload) &&
            entries.every((p) => !mutations.has(p.method)))
        : validRPCPayload(payload) ||
          (internal &&
            entries.length > 0 &&
            entries.length <= 20 &&
            entries.every(
              (p) =>
                validRPCPayload(p) ||
                (p?.jsonrpc === "2.0" &&
                  adminMethods.has(p.method) &&
                  Array.isArray(p.params) &&
                  ["string", "number"].includes(typeof p.id)),
            ));
      if (!permitted)
        return send(res, 403, { error: "RPC method not available" });
      const mutates = entries.some((p) => mutations.has(p.method));
      const result = await (mutates
        ? enqueue(async () => {
            let response;
            if (claim) {
              await rpc("anvil_impersonateAccount", [claim.from]);
              try {
                response = await request({ ...payload, params: [claim] });
              } finally {
                await rpc("anvil_stopImpersonatingAccount", [claim.from]);
              }
            } else response = await request(payload);
            const responses = Array.isArray(response) ? response : [response];
            const hashes = responses
              .filter(
                (r) =>
                  /^0x[0-9a-fA-F]{64}$/.test(r.result ?? "") &&
                  entries.some(
                    (e) =>
                      e.id === r.id &&
                      [
                        "eth_sendTransaction",
                        "eth_sendRawTransaction",
                      ].includes(e.method),
                  ),
              )
              .map((r) => r.result);
            for (const hash of hashes) {
              let mined = false;
              for (let i = 0; i < 100; i++) {
                if (await rpc("eth_getTransactionReceipt", [hash])) {
                  mined = true;
                  break;
                }
                await delay(100);
              }
              if (!mined)
                throw new Error(
                  "Transaction is pending; confirmation must be reconciled",
                );
            }
            // Commit a coherent durable snapshot before acknowledging a transaction or state mutation.
            try {
              await checkpoint(hashes);
            } catch (error) {
              closing = true;
              fatal(error);
              throw error;
            }
            return response;
          })
        : (async () => {
            await writes;
            return request(payload);
          })());
      send(res, 200, result);
    } catch {
      if (!res.headersSent) send(res, 503, { error: "Demo RPC unavailable" });
      else res.end();
    } finally {
      active--;
    }
  };
  const external = createServer(handler(false)),
    admin = createServer(handler(true));
  for (const server of [external, admin]) {
    server.requestTimeout = 30000;
    server.headersTimeout = 10000;
  }
  const listen = (server, p, host) =>
    new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(p, host, resolve);
    });
  try {
    await listen(admin, adminPort, "127.0.0.1");
    await listen(external, port, "0.0.0.0");
  } catch (error) {
    admin.close();
    external.close();
    throw error;
  }
  return {
    checkpoint: () => enqueue(() => checkpoint()),
    async close() {
      closing = true;
      await Promise.all(
        [external, admin].map(
          (server) =>
            new Promise((resolve) => {
              server.close(resolve);
              server.closeIdleConnections();
            }),
        ),
      );
      await writes;
    },
  };
}
