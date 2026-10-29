"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { clientFor, useWallet } from "./WalletProvider";
import { Mark } from "./Brand";
import TokenIcon from "./TokenIcon";
import { AUSD_SAVINGS, readAUSD, type AUSDSnapshot } from "@/lib/setsuna/ausd";

const show = (value: bigint, decimals: number) =>
  Number(formatUnits(value, decimals)).toLocaleString("en-US", { maximumFractionDigits: 5 });

/** A setsAUSD holding in Portfolio. Shown only when the wallet holds some. */
export default function AUSDPosition({ apr }: { apr?: bigint }) {
  const { deployment: d, address } = useWallet();
  const [snap, setSnap] = useState<AUSDSnapshot>();
  useEffect(() => {
    if (!d || d.mode !== "mainnet" || !address) return;
    let live = true;
    const read = () => readAUSD(clientFor(d), address).then((s) => live && setSnap(s)).catch(() => undefined);
    void read();
    const timer = setInterval(read, 30_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [d, address]);
  if (!snap || snap.shares === BigInt(0)) return null;
  const { assetDecimals: A, shareDecimals: S } = AUSD_SAVINGS;
  return (
    <article className="p-earn-position" aria-label="setsAUSD position">
      <div className="p-earn-title">
        <span aria-hidden="true" className="s-earn-token is-ausd is-receipt">
          <Mark size={24} />
          <span className="e-underlying-badge">
            <TokenIcon asset="AUSD" size={12} />
          </span>
        </span>
        <div>
          <h3>setsAUSD</h3>
          <span>{show(snap.shares, S)} shares · AUSD saved in setsUSDC</span>
        </div>
        <span className="p-rate">{apr === undefined ? "Rate unavailable" : `${(Number(formatUnits(apr, 18)) * 100).toFixed(2)}% APR`}</span>
      </div>
      <dl className="p-position-values">
        <div>
          <dt>Underlying value</dt>
          <dd data-testid="portfolio-earn-ausd">
            {show(snap.value, A)} <small>AUSD</small>
          </dd>
        </div>
        <div>
          <dt>Withdrawable now</dt>
          <dd>
            {show(snap.maxRedeem, S)} <small>setsAUSD</small>
          </dd>
        </div>
      </dl>
      <div className="p-position-actions">
        <Link href="/earn/usdc/?action=withdraw">
          Withdraw <span aria-hidden="true">↗</span>
        </Link>
      </div>
    </article>
  );
}
