import { formatUnits } from "viem";
import {
  earnDecision,
  type EarnDecisionSnapshot,
} from "@/lib/setsuna/earn-decision";

export default function EarnDecision({
  snapshot: s,
  asset,
  destinations,
}: {
  snapshot?: EarnDecisionSnapshot;
  asset: "MON" | "USDC";
  destinations: string[];
}) {
  const decimals = asset === "MON" ? 18 : 6;
  const amount = (n: bigint) =>
    Number(formatUnits(n, decimals)).toLocaleString("en-US", {
      maximumFractionDigits: 6,
    });
  const apr = (n: bigint | undefined) =>
    n === undefined ? "—" : `${(Number(formatUnits(n, 18)) * 100).toFixed(3)}%`;
  const time = (n?: bigint) =>
    n
      ? new Date(Number(n) * 1000)
          .toISOString()
          .replace("T", " ")
          .replace(".000Z", " UTC")
      : "Not recorded";
  const decision = earnDecision(s);
  const p = s?.plan;
  const nextCash =
    s && p
      ? s.idle +
        p.withdrawals.reduce((a, b) => a + b, BigInt(0)) -
        p.deposits.reduce((a, b) => a + b, BigInt(0))
      : undefined;

  return (
    <section
      className="s-earn-decision"
      aria-label={`${asset} allocation decision`}
    >
      <span className="s-eyebrow">Why this allocation</span>
      <h3>{decision.title}</h3>
      <p>{decision.detail}</p>
      <p className="s-footnote">
        Eligible destinations receive targets proportional to the lowest of
        their two recorded base rates and the current rate, within the vault’s
        caps. Targets describe the intended allocation; the next move is limited
        to 10% gross movement.
      </p>
      {s && (
        <dl className="s-earn-decision-facts">
          <div>
            <dt>Current cash</dt>
            <dd>
              {amount(s.idle)} {asset}
            </dd>
          </div>
          <div>
            <dt>Last rebalance</dt>
            <dd>{time(s.lastRebalance)}</dd>
          </div>
          <div>
            <dt>Latest rate observation</dt>
            <dd>{time(s.observations[1]?.timestamp)}</dd>
          </div>
          <div>
            <dt>Read at block</dt>
            <dd>{s.block.toString()}</dd>
          </div>
        </dl>
      )}
      {s && (
        <details>
          <summary>Rate inputs used by the rule</summary>
          <div className="s-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Destination</th>
                  <th>Earlier APR</th>
                  <th>Latest recorded APR</th>
                  <th>Current APR</th>
                </tr>
              </thead>
              <tbody>
                {destinations.map((name, i) => (
                  <tr key={name}>
                    <th>{name}</th>
                    <td>{apr(s.observations[0]?.rates[i])}</td>
                    <td>{apr(s.observations[1]?.rates[i])}</td>
                    <td>{apr(s.rates[i])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="s-footnote">
            Earlier observation: {time(s.observations[0]?.timestamp)}. Rates are
            inputs to a rule, not a complete measure of protocol risk.
          </p>
        </details>
      )}
      {p && (
        <>
          <div className="s-table-wrap">
            <table aria-label={`${asset} contract allocation preview`}>
              <thead>
                <tr>
                  <th>Destination</th>
                  <th>Target {asset}</th>
                  <th>Proposed withdrawal</th>
                  <th>Proposed supply</th>
                  <th>After this move</th>
                </tr>
              </thead>
              <tbody>
                {destinations.map((name, i) => (
                  <tr key={name}>
                    <th>{name}</th>
                    <td>{amount(p.target[i])}</td>
                    <td>{amount(p.withdrawals[i])}</td>
                    <td>{amount(p.deposits[i])}</td>
                    <td>
                      {amount(
                        p.positions[i] - p.withdrawals[i] + p.deposits[i],
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="s-footnote">
            Contract preview, not a completed transaction. Gross movement:{" "}
            {amount(p.grossMovement)} {asset}. Cash after the proposed move:{" "}
            {amount(nextCash!)} {asset}.
          </p>
          <p className="s-footnote">
            Projected annual base income for the whole vault:{" "}
            {amount(p.annualIncomeBefore)} → {amount(p.annualIncomeAfter)}{" "}
            {asset}. Minimum improvement: {amount(s!.minAnnualGain)} {asset}
            /year unless repairing limits. These estimates exclude transaction
            costs, rewards and changes in market conditions; they are not
            realized earnings or promised returns.
          </p>
        </>
      )}
    </section>
  );
}
