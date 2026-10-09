#!/usr/bin/env python3
"""G6 analysis: lifecycle-joined manual top-up and liquidation counts on Perpl.

Input: JSONL from g6_rpc_sample.py. Read-only; the only network calls are
eth_call/eth_getCode for accounts that performed top-ups (to label them
contract or EOA at a stated block).

Lifecycles are rebuilt per (accountId, perpId) from events ordered by
(block, txIndex, logIndex). Transitions the events cannot resolve are counted
as ambiguous, never guessed.

Usage: g6_analyze.py IN.jsonl OUT.json [LABEL_BLOCK]
"""
import json, sys, collections, pathlib, subprocess

EV = json.load(open(pathlib.Path(__file__).with_name("perpl_events.json")))
BY_TOPIC = {v["topic0"]: (k, v["inputs"]) for k, v in EV.items()}
EXCHANGE = "0x34b6552d57a35a1d042ccae1951bd1c370112a6f"
RPC = "https://rpc-mainnet.monadinfra.com"
CNS = 1e6  # AUSD has 6 decimals; CNS amounts are reported as raw/1e6

def decode(t0, data):
    name, inputs = BY_TOPIC[t0]
    h = data[2:]; out = {}
    for i, (n, typ, _) in enumerate(inputs):
        w = int(h[64*i:64*(i+1)] or "0", 16)
        if typ.startswith("int") and w >= 2**255: w -= 2**256
        out[n] = w
    return name, out

def main():
    src, dst = sys.argv[1], sys.argv[2]
    label_block = sys.argv[3] if len(sys.argv) > 3 else "latest"
    rows, seen, dupes = [], set(), 0
    for line in open(src):
        l = json.loads(line)
        if l["t0"] not in BY_TOPIC: continue
        k = (l["b"], l["tx"], l["li"])
        if k in seen:
            dupes += 1; continue
        seen.add(k)
        name, f = decode(l["t0"], l["data"])
        rows.append((l["b"], l["tx"], l["li"], name, f, l["h"]))
    rows.sort(key=lambda r: r[:3])
    blocks = (rows[0][0], rows[-1][0]) if rows else (None, None)

    open_lc = {}          # (acct, perp) -> lifecycle dict
    closed = []           # finished lifecycles
    ambiguous = collections.Counter()
    counts = collections.Counter()
    topup_amounts = []

    def new_lc(key, b, origin):
        return {"acct": key[0], "perp": key[1], "start": b, "origin": origin, "topups": 0,
                "topup_cns": 0, "partial_liqs": 0, "outcome": None, "end": None}

    def finish(key, b, outcome):
        lc = open_lc.pop(key, None)
        if lc is None:
            lc = new_lc(key, None, "pre_window_unknown_start"); ambiguous["end_without_seen_start"] += 1
        lc["outcome"], lc["end"] = outcome, b
        closed.append(lc)

    for b, tx, li, name, f, h in rows:
        counts[name] += 1
        acct = f.get("accountId", f.get("posAccountId"))
        if name == "AccountCreated": continue
        key = (acct, f.get("perpId"))
        cur = open_lc.get(key)
        if name in ("PositionOpened", "PositionOpenedV2"):
            if cur: ambiguous["open_while_open"] += 1; finish(key, b, "ambiguous_replaced")
            open_lc[key] = new_lc(key, b, "opened_in_window")
        elif name == "PositionInverted":
            if not cur: open_lc[key] = new_lc(key, None, "pre_window")
            finish(key, b, "inverted")
            open_lc[key] = new_lc(key, b, "opened_in_window_by_inversion")
        elif name == "PositionClosed":
            finish(key, b, "closed")
        elif name == "PositionLiquidated":
            if not cur: open_lc[key] = new_lc(key, None, "pre_window")
            if f["liqLotLNS"] >= f["posLotLNS"]:
                finish(key, b, "liquidated")
            else:
                open_lc[key]["partial_liqs"] += 1
        elif name in ("PositionDeleveraged", "PositionDeleveragedV2"):
            if not cur: open_lc[key] = new_lc(key, None, "pre_window")
            if f["endLotLNS"] == 0: finish(key, b, "deleveraged")
        elif name.startswith("PositionUnwound"):
            finish(key, b, "unwound")
        elif name == "PositionDecreased":
            if not cur: open_lc[key] = new_lc(key, None, "pre_window")
            # a full decrease is normally followed by PositionClosed in the same tx; leave it to that event
        elif name in ("PositionIncreased", "PositionIncreasedV2", "PositionCollateralDecreased"):
            if not cur: open_lc[key] = new_lc(key, None, "pre_window")
        elif name == "IncreasePositionCollateral":
            if not cur: open_lc[key] = new_lc(key, None, "pre_window")
            open_lc[key]["topups"] += 1; open_lc[key]["topup_cns"] += f["amountCNS"]
            topup_amounts.append(f["amountCNS"] / CNS)

    still_open = list(open_lc.values())
    for lc in still_open: lc["outcome"] = "open_at_window_end"
    allc = closed + still_open

    def summarise(lcs):
        oc = collections.Counter(l["outcome"] for l in lcs)
        return {"lifecycles": len(lcs), "outcomes": dict(oc),
                "liquidated_share": round(oc["liquidated"] / len(lcs), 4) if lcs else None}

    cohort_in = [l for l in allc if l["origin"].startswith("opened_in_window")]
    cohort_pre = [l for l in allc if not l["origin"].startswith("opened_in_window")]
    topped = [l for l in allc if l["topups"] > 0]
    untopped = [l for l in allc if l["topups"] == 0]
    liq = [l for l in allc if l["outcome"] == "liquidated"]
    accts_active = {l["acct"] for l in allc}
    accts_topup = collections.Counter(l["acct"] for l in topped for _ in range(l["topups"]))
    accts_liq = {l["acct"] for l in liq}

    # label top-up accounts at a stated block
    labels = {}
    for a in list(accts_topup)[:200]:
        try:
            info = subprocess.run(["cast", "call", "--rpc-url", RPC, "--block", str(label_block), EXCHANGE,
                                   "getAccountById(uint256)(uint256,uint256,uint256,uint8,address,(uint256,uint256,uint256,uint256))", str(a)],
                                  capture_output=True, text=True, timeout=30).stdout.split()
            addr = next((x for x in info if x.startswith("0x") and len(x) == 42), None)
            code = subprocess.run(["cast", "code", "--rpc-url", RPC, "--block", str(label_block), addr],
                                  capture_output=True, text=True, timeout=30).stdout.strip() if addr else ""
            labels[a] = {"addr": addr, "kind": "contract" if code not in ("", "0x") else "eoa"}
        except Exception as e:
            labels[a] = {"addr": None, "kind": f"unresolved: {e}"}
    kinds = collections.Counter(v["kind"] for v in labels.values())

    res = {
        "source_file": src, "block_range_observed": blocks, "label_block": label_block,
        "event_counts": dict(counts), "duplicate_logs_dropped": dupes, "ambiguous": dict(ambiguous),
        "active_accounts": len(accts_active),
        "cohort_opened_in_window": summarise(cohort_in),
        "cohort_open_before_window": summarise(cohort_pre),
        "manual_topups": {
            "events": sum(accts_topup.values()), "distinct_accounts": len(accts_topup),
            "accounts_share_of_active": round(len(accts_topup) / len(accts_active), 4) if accts_active else None,
            "lifecycles_with_topup": len(topped),
            "lifecycles_with_topup_share": round(len(topped) / len(allc), 4) if allc else None,
            "amount_ausd_median": sorted(topup_amounts)[len(topup_amounts)//2] if topup_amounts else None,
            "amount_ausd_total": round(sum(topup_amounts), 2),
            "top_accounts_by_topups": accts_topup.most_common(10),
            "account_kind_at_label_block": dict(kinds),
        },
        "outcome_topped_up": summarise(topped),
        "outcome_not_topped_up": summarise(untopped),
        "liquidations": {"full_liquidation_lifecycles": len(liq), "distinct_accounts": len(accts_liq),
                         "liquidated_lifecycles_that_had_a_topup": sum(1 for l in liq if l["topups"] > 0),
                         "partial_liquidation_events": sum(l["partial_liqs"] for l in allc)},
        "limits": [
            "Account kind is bytecode at the label block; EOA does not prove manual intent.",
            "Lifecycles that started before the window have unknown start state.",
            "A full PositionDecreased without PositionClosed is left open, not guessed as closed.",
            "Amounts assume CNS has 6 decimals like AUSD.",
        ],
    }
    json.dump(res, open(dst, "w"), indent=1)
    print(json.dumps({k: res[k] for k in ("block_range_observed", "active_accounts", "manual_topups", "liquidations", "ambiguous")}, indent=1))

if __name__ == "__main__":
    main()
