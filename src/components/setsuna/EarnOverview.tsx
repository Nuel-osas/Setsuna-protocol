"use client";
import Link from "next/link";
import { useWallet } from "./WalletProvider";
import { EarnToken, earnAmount, type EarnAsset } from "./EarnForm";
import { EarnEnvironment, earnRate, earnVenues } from "./EarnVaultLayout";
import { ProtocolLabel } from "./ProtocolIcon";

import { useEarnSummary } from "./useEarnSummary";

export default function EarnOverview() {
  const { deployment: d } = useWallet();
  const mon = useEarnSummary("MON"),
    usdc = useEarnSummary("USDC");
  const vault = (asset: EarnAsset) => {
    const snapshot = (asset === "MON" ? mon : usdc).data;
    return snapshot?.healthy ? snapshot : undefined;
  };
  return (
    <main id="main" className="s-app s-unified-earn e-overview">
      <header className="e-overview-heading">
        <div>
          <span className="e-kicker">SETSUNA EARN</span>
          <h1>
            Less to manage.
            <br />
            <span>More in motion.</span>
          </h1>
          <p>
            One deposit. Automated allocation across Monad lending markets.
            <br className="e-desktop-break" /> Choose your asset. The vault
            handles the rest.
          </p>
        </div>
        <EarnEnvironment />
      </header>
      <div className="e-section-head e-catalogue-head">
        <h2>Explore vaults</h2>
        <Link href="/portfolio/">Your portfolio ↗</Link>
      </div>
      <div className="e-vault-cards">
        {(["MON", "USDC"] as const).map((asset) => {
          const snapshot = vault(asset),
            decimals = asset === "MON" ? 18 : 6;
          const m = asset === "MON" ? d?.earnMON : d?.earnUSDC;
          const names = earnVenues(asset, m?.adapters.length ?? 4).map(
            (s) => s.split(" · ")[0],
          );
          return (
            <article
              className={`e-vault-card is-${asset.toLowerCase()}`}
              key={asset}
            >
              <div className="e-card-banner">
                <div className="e-card-token">
                  <EarnToken asset={asset} receipt />
                  <div>
                    <h3>sets{asset}</h3>
                    <span>
                      {asset === "MON"
                        ? "Native asset vault"
                        : "Stablecoin vault"}
                    </span>
                  </div>
                </div>
                <span className="e-card-tag">
                  {asset} → sets{asset}
                </span>
              </div>
              <div className="e-card-body">
                <p>
                  {asset === "MON"
                    ? "Put your MON to work, without managing each lending position."
                    : "A simpler way to earn on USDC, with allocation handled for you."}
                </p>
                <div className="e-card-rate">
                  <div>
                    <span>Current base APR</span>
                    <strong>{earnRate(snapshot?.blendedApr)}</strong>
                  </div>
                  <span className="e-rate-note">
                    Variable rate
                    <br />
                    2% of yield only
                  </span>
                </div>
                <dl className="e-card-facts">
                  <div>
                    <dt>Total in vault</dt>
                    <dd>
                      {earnAmount(snapshot?.nav, decimals, 2)} {asset}
                    </dd>
                  </div>
                  <div>
                    <dt>1 sets{asset}</dt>
                    <dd>
                      {earnAmount(snapshot?.shareValue, decimals, 6)} {asset}
                    </dd>
                  </div>
                </dl>
                <div className="e-sources">
                  <span>Lending through</span>
                  <p>
                    {names.map((name) => (
                      <ProtocolLabel key={name} name={name} size={16} />
                    ))}
                  </p>
                </div>
                {(asset === "MON" ? mon : usdc).failed && (
                  <p className="e-note">
                    {m
                      ? "Vault readings are temporarily unavailable."
                      : "This vault is not connected in this environment."}
                  </p>
                )}
                <Link
                  className="e-view-vault"
                  href={`/earn/${asset.toLowerCase()}/`}
                  aria-label={`View sets${asset} vault`}
                >
                  Explore sets{asset} <span aria-hidden="true">↗</span>
                </Link>
              </div>
            </article>
          );
        })}
      </div>
      <section
        className="e-panel e-compare"
        id="rates"
        aria-label="Compare vaults"
      >
        <header className="e-section-head">
          <h2>At a glance</h2>
          <span>Rates from this environment</span>
        </header>
        <div className="s-table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Vault</th>
                <th scope="col">Current base APR</th>
                <th scope="col">Total assets</th>
                <th scope="col">Receipt token</th>
                <th scope="col" aria-label="Vault details" />
              </tr>
            </thead>
            <tbody>
              {(["MON", "USDC"] as const).map((asset) => (
                <tr key={asset}>
                  <th scope="row">
                    <span className="e-table-token">
                      <EarnToken asset={asset} />
                      {asset}
                    </span>
                  </th>
                  <td className="e-positive">
                    {earnRate(vault(asset)?.blendedApr)}
                  </td>
                  <td>
                    {earnAmount(vault(asset)?.nav, asset === "MON" ? 18 : 6, 2)}{" "}
                    {asset}
                  </td>
                  <td>sets{asset}</td>
                  <td>
                    <Link
                      href={`/earn/${asset.toLowerCase()}/`}
                      aria-label={`Open sets${asset} details`}
                    >
                      View vault ↗
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="e-how" aria-label="How Earn works">
        {[
          [
            "01",
            "Deposit once",
            "Choose MON or USDC. Receive shares in that asset’s vault.",
          ],
          [
            "02",
            "Let it work",
            "Rules allocate across approved markets and rebalance as conditions change.",
          ],
          [
            "03",
            "Withdraw when ready",
            "Redeem your shares for the underlying asset, subject to available liquidity.",
          ],
        ].map(([number, title, text]) => (
          <article key={number}>
            <span>{number}</span>
            <h3>{title}</h3>
            <p>{text}</p>
          </article>
        ))}
      </section>
      <p className="e-demo-note">
        Public demo on a hosted Monad mainnet fork using free test funds. Base
        APR reflects the current allocation, including idle cash; it is not a
        promised return. <Link href="/docs/">Learn how Setsuna works ↗</Link>
      </p>
    </main>
  );
}
