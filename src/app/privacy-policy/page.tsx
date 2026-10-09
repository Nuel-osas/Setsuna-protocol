import type { Metadata } from "next";
export const metadata: Metadata = { title: "Privacy · Setsuna" };
export default function Page() {
  return (
    <main id="main" className="s-doc">
      <div className="s-doc-head">
        <div>
          <p className="s-eyebrow">DEVELOPMENT PREVIEW · SEPTEMBER 2026</p>
          <h1>
            Your account.
            <br />
            Your privacy.
          </h1>
        </div>
      </div>
      <article className="s-prose">
        <h2>What this preview stores</h2>
        <p>
          The web app does not use analytics or advertising cookies. Passkey
          signing material is kept in memory, not written to local storage or
          sent to a Setsuna server. Disconnecting ends the signing session.
        </p>
        <h2>Wallet and network connections</h2>
        <p>
          Connecting a browser wallet shares the selected public address and
          chain with this app. Network requests to the configured RPC provider
          can reveal your IP address, requested account addresses and
          transaction data to that provider. Onchain transactions and account
          balances are public.
        </p>
        <h2>Passkeys</h2>
        <p>
          Your device or passkey provider manages the passkey. Recovery uses the
          same passkey and website domain. Your passkey provider’s own privacy
          practices also apply. This preview has no email or account recovery
          service.
        </p>
        <h2>Local demo</h2>
        <p>
          The local demo reads a deployment manifest from this project and talks
          to a local node. Its accounts and funds are test fixtures. Hosting
          this preview publicly requires a separate deployment and an updated
          privacy notice.
        </p>
      </article>
    </main>
  );
}
