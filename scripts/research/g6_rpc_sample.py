#!/usr/bin/env python3
"""G6/G7 read-only sampler for Perpl position events on Monad mainnet.

eth_getLogs only, in 100-block windows (the public RPC limit). No transactions,
no keys. Writes one JSON line per log.

Usage: g6_rpc_sample.py FROM_BLOCK TO_BLOCK OUT.jsonl [WORKERS]
"""
import json, sys, time, threading, urllib.request, concurrent.futures as cf, pathlib

EXCHANGE = "0x34b6552d57a35a1d042ccae1951bd1c370112a6f"
RPCS = ["https://rpc-mainnet.monadinfra.com", "https://rpc.monad.xyz", "https://rpc3.monad.xyz"]
SPAN = 100
EVENTS = json.load(open(pathlib.Path(__file__).with_name("perpl_events.json")))
TOPICS = [v["topic0"] for k, v in EVENTS.items() if k not in ("CollateralDeposit",)]

_lock = threading.Lock()
_rr = [0]

def rpc(method, params, tries=6):
    err = None
    for attempt in range(tries):
        with _lock:
            url = RPCS[_rr[0] % len(RPCS)]; _rr[0] += 1
        body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
        req = urllib.request.Request(url, body, {"content-type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                d = json.loads(r.read().decode("utf-8", "replace"), strict=False)
            if "result" in d:
                return d["result"]
            err = d.get("error")
        except Exception as e:  # transient network or rate limit
            err = str(e)
        time.sleep(0.5 * (attempt + 1))
    raise RuntimeError(f"{method} failed after {tries}: {err}")

def window(lo):
    hi = lo + SPAN - 1
    logs = rpc("eth_getLogs", [{"address": EXCHANGE, "fromBlock": hex(lo), "toBlock": hex(hi), "topics": [TOPICS]}])
    return lo, [{"b": int(l["blockNumber"], 16), "tx": int(l["transactionIndex"], 16), "li": int(l["logIndex"], 16),
                 "t0": l["topics"][0], "data": l["data"], "h": l["transactionHash"]} for l in logs]

def main():
    frm, to, out = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
    workers = int(sys.argv[4]) if len(sys.argv) > 4 else 12
    starts = list(range(frm, to + 1, SPAN))
    done_path = pathlib.Path(out + ".done")
    done = set(int(x) for x in done_path.read_text().split()) if done_path.exists() else set()
    todo = [s for s in starts if s not in done]
    t0 = time.time(); n = 0; failed = []
    with open(out, "a") as f, open(done_path, "a") as dp, cf.ThreadPoolExecutor(workers) as ex:
        futs = {ex.submit(window, s): s for s in todo}
        for i, fu in enumerate(cf.as_completed(futs), 1):
            s = futs[fu]
            try:
                lo, logs = fu.result()
            except Exception as e:
                failed.append(s); continue
            for l in logs:
                f.write(json.dumps(l) + "\n")
            dp.write(f"{lo}\n"); n += len(logs)
            if i % 200 == 0:
                f.flush(); dp.flush()
                print(f"{i}/{len(todo)} windows, {n} logs, {i/(time.time()-t0):.1f} win/s", flush=True)
    print(json.dumps({"windows": len(todo), "logs": n, "failed_windows": failed[:20], "n_failed": len(failed),
                      "seconds": round(time.time() - t0, 1)}))

if __name__ == "__main__":
    main()
