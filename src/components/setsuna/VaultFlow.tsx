"use client";
import { useState } from "react";
import Link from "next/link";
import { Mark } from "./Brand";
import ProtocolIcon from "./ProtocolIcon";
import TokenIcon from "./TokenIcon";

export default function VaultFlow() {
  const [asset, setAsset] = useState<"MON" | "USDC">("MON");
  const mon = asset === "MON";
  const destinations = mon
    ? ["Neverland", "Euler"]
    : ["Aave", "Morpho", "Euler", "Neverland", "Curvance"];
  return (
    <div className="m-flow-demo">
      <div className="m-flow-toolbar">
        <span className="m-section-label">One asset. Its own vault.</span>
        <div
          className="m-asset-switch"
          role="group"
          aria-label="Explore a vault"
        >
          {(["MON", "USDC"] as const).map((a) => (
            <button
              key={a}
              aria-pressed={asset === a}
              onClick={() => setAsset(a)}
            >
              {a}
            </button>
          ))}
        </div>
      </div>
      <div className="m-flow-route" aria-live="polite">
        <div className="m-flow-wallet">
          <div
            className={`m-token m-token-large ${mon ? "m-token-mon" : "m-token-usdc"}`}
            aria-hidden="true"
          >
            <TokenIcon asset={asset} size={mon ? 34 : 54} />
          </div>
          <strong>Your {asset}</strong>
          <span>You choose the amount.</span>
        </div>
        <div className="m-flow-line" aria-hidden="true">
          <i />
        </div>
        <div className="m-flow-vault">
          <div className="m-flow-core">
            <Mark size={52} />
          </div>
          <strong>sets{asset}</strong>
          <span>Your share of the vault.</span>
        </div>
        <div className="m-flow-line" aria-hidden="true">
          <i />
        </div>
        <div className="m-flow-markets">
          <span>Approved destinations</span>
          {destinations.map((name) => (
            <div key={name}>
              <i className="m-protocol-logo" aria-hidden="true">
                <ProtocolIcon name={name} />
              </i>
              <strong>{name}</strong>
              <span>Lending</span>
            </div>
          ))}
          <div>
            <i aria-hidden="true">
              <ProtocolIcon name="Cash buffer" size={18} />
            </i>
            <strong>Cash buffer</strong>
            <span>Liquidity</span>
          </div>
        </div>
      </div>
      <div className="m-flow-caption">
        <p>
          {mon
            ? "Native MON enters and exits through the vault’s wrapped-MON gateway."
            : "A separate USDC pool. Each destination must pass the vault’s eligibility rules."}{" "}
          Allocation illustration; actual holdings are shown in the app.
        </p>
        <Link href="/earn/">
          Explore the vaults <span aria-hidden="true">↗</span>
        </Link>
      </div>
    </div>
  );
}
