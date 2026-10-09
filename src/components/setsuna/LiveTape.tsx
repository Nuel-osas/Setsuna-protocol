"use client";
import { pct, useEarn } from "./useEarn";

const facts = ["Native USDC", "Base rates, no incentives", "10% kept as cash", "60% cap per market", "0% Setsuna fee"];

/** A moving tape of every destination's live base rate, plus the standing limits. */
export default function LiveTape() {
  const { data, failed } = useEarn();
  const rates = failed
    ? []
    : (data?.destinations ?? []).map((d) => ({
        key: d.key,
        label: `${d.protocol} · ${d.name}`,
        value: d.eligible ? pct(d.apr) : "skipped",
        off: !d.eligible,
      }));
  const items = [
    ...rates,
    ...(data?.block && !failed ? [{ key: "block", label: "Monad block", value: Number(data.block).toLocaleString("en-US"), off: false }] : []),
    ...facts.map((f) => ({ key: f, label: f, value: "", off: false })),
  ];
  const run = (hidden: boolean) => (
    <ul aria-hidden={hidden || undefined}>
      {items.map((i) => (
        <li key={i.key} className={i.off ? "is-off" : ""}>
          {i.label}
          {i.value && <b>{i.value}</b>}
        </li>
      ))}
    </ul>
  );
  return (
    <section className="s-tape" aria-label="Live base rates and limits">
      <div className="s-tape-track">
        {run(false)}
        {run(true)}
      </div>
    </section>
  );
}
