/**
 * Margin runway: position equity against maintenance (the liquidation point),
 * with the protection trigger and target marked. All values in CNS units.
 */
import { ausd } from "@/lib/setsuna/format";

type Props = {
  maintenance: bigint;
  equity: bigint;
  trigger?: bigint;
  target?: bigint;
  example?: boolean;
  flash?: boolean;
};

export default function MarginRunway({ maintenance, equity, trigger, target, example, flash }: Props) {
  const lo = Number(maintenance);
  const top = Math.max(Number(equity), Number(target ?? 0), lo * 1.2, lo + 1) * 1.12;
  const pos = (v: bigint | number) => Math.max(0, Math.min(100, ((Number(v) - lo) / (top - lo)) * 100));
  const eq = pos(equity);
  const tr = trigger !== undefined && trigger > BigInt(0) ? pos(trigger) : undefined;
  const tg = target !== undefined && target > BigInt(0) ? pos(target) : undefined;
  const room = Number(maintenance) > 0 ? ((Number(equity) - lo) / lo) * 100 : 0;
  const state = tr !== undefined && eq <= tr ? "danger" : tg !== undefined && eq >= tg ? "safe" : "watch";

  return (
    <div className={`s-runway is-${state} ${flash ? "is-flash" : ""}`}>
      <div className="s-runway-head">
        <div>
          <span className="s-eyebrow">Margin runway{example ? " · example" : ""}</span>
          <strong className="s-runway-figure">
            {room.toFixed(1)}
            <small>% above liquidation</small>
          </strong>
        </div>
        <span className={`s-pill is-${state}`}>
          {state === "danger" ? "Setsuna would step in" : state === "safe" ? "Comfortable" : "Watching"}
        </span>
      </div>

      <div className="s-runway-track" role="img" aria-label={`Equity ${ausd(equity)} AUSD against a liquidation point of ${ausd(maintenance)} AUSD`}>
        <span className="s-runway-danger" style={{ width: `${tr ?? 12}%` }} />
        <span className="s-runway-fill" style={{ width: `${eq}%` }} />
        {tr !== undefined && <span className="s-runway-tick is-trigger" style={{ left: `${tr}%` }} />}
        {tg !== undefined && <span className="s-runway-tick is-target" style={{ left: `${tg}%` }} />}
        <span className="s-runway-now" style={{ left: `${eq}%` }} />
      </div>

      <div className="s-runway-scale">
        <span className="is-liq">
          Liquidation<b>{ausd(maintenance)}</b>
        </span>
        {tr !== undefined && (
          <span style={{ left: `${tr}%` }} className="is-abs">
            Steps in<b>{ausd(trigger)}</b>
          </span>
        )}
        {tg !== undefined && (
          <span style={{ left: `${tg}%` }} className="is-abs is-target">
            Restores to<b>{ausd(target)}</b>
          </span>
        )}
        <span className="is-end">
          Equity<b>{ausd(equity)}</b>
        </span>
      </div>
    </div>
  );
}
