# Setsuna web application

## Current USDC flow — Codex, 8 October 2026

The USDC Earn panel now reads a configured four-protocol vault and supports bounded deposit/redemption, actual positions, eligibility, market cash and public execution. It does not use `/api/earn/` research weights as holdings. The dedicated local fork app runs at port 3014. [Current guide](USDC-V2.md). Earlier reviews below describe prior versions.

## Current surface — Codex documentation review, 2 October 2026

Claude's current design uses warm paper, dark ink and ultramarine, with Bricolage
Grotesque, Instrument Sans and JetBrains Mono. The landing page leads with Earn;
`/app/` opens the Earn tab, and `/app/?tab=trade` opens the existing Perpl and
protection interface. `/evidence/` still presents the dated Perpl activity study.

`/api/earn/` reads five research destinations: Aave, Euler, Neverland, and two
direct Morpho markets. The UI calculates a hypothetical rate-weighted split.
It is not reading an actual deployed Setsuna Earn vault. The implemented backend
has only Aave and Morpho WBTC/USDC adapters; its default size gate excludes that
Morpho market at the proof block. [Exact contract behavior](EARN.md).

Earn deposits remain disabled. `npm run demo:local` provisions the original
AUSD-based Perpl fixture on local chain 31337; it does not deploy Earn. The Earn
fork tests use Monad chain ID 143. These environments and their addresses must
be distinguished when adding the eventual Earn deployment to the app.

Open frontend documentation work for Claude: label candidate portfolio estimates
separately from deployed allocations; align FAQ protocol names with actual
supported adapters; make healthy accounting and shared liquidity part of the
withdrawal explanation; connect the exported vault ABI and bounded deposit/
redemption calls after a reviewed deployment exists. [Current handoff](ARCHITECTURE-V2.md#codex--2026-10-02--rule-driven-earn-backend-and-response-to-claude).

This review inspected source and documentation. It did not rerun browser,
TypeScript, Next.js production build, or wallet-device checks. Claude's dated
frontend verification entries remain in the architecture record.

## Original protection web implementation — 28 September 2026

The sections below preserve Codex's original web implementation record. Its
asset description predates Claude's redesign; its transaction and wallet
descriptions concern Perpl protection, not a completed Earn transaction flow.

The Next.js application uses the previously captured fonts, video, vault, keys,
market and crowd artwork. Its routes, navigation, favicon, product copy, FAQs,
privacy description and preview terms now refer to Setsuna. No public monetary
metrics or live customer outcomes are fabricated.

## Connection and recovery

Pinned dependency: `@category-labs/mera@0.2.0`. Primary documentation/source:
https://github.com/category-labs/mera and the installed package's `src/passkey.ts`,
`src/secp256k1.ts`, `src/viem.ts`.

Creation and recovery evaluate `SHA-256("setsuna.passkey.v1")` as the PRF salt.
The resulting 32 bytes initialize the secp256k1 session and the original output
is zeroed immediately. The viem account uses that in-memory session. No signing
secret, passkey PRF output or credential metadata is persisted to browser storage
or sent to a backend. Recovery uses discoverable credentials for the same RP
hostname. Disconnect and pagehide end the signing session. There is no automatic
reconnect or signing without an explicit transaction confirmation in the app.

This preview's account derivation is deliberately versioned. Changing its salt
or hostname changes the account identity. Production RP/domain setup, inactivity
expiry, recovery UX and real-device compatibility remain follow-up work. A local
passkey is not a provisioned mobile production account.

EIP-6963 announced providers and legacy `window.ethereum` are supported. The user
chooses a provider. The app handles cancellation, account changes and chain changes.
Before writes, the client verifies RPC chain, selected account, wallet chain,
contract code, and simulates the call. Reads verify account owner, fixed token,
exchange and market. Account reads use a consistent block number.

## Transactions and data

Supported flows: factory account creation; exact token approval followed by
initializing trading or funding trading/reserve; withdrawal of reserve/free trading
balance; policy arm, cap update and revocation; BTC fill-or-kill limit orders;
and explicit manual top-up execution in local demo mode. Top-ups remain
permissionless in the contracts; the demo button does not prove an unattended
keeper or CRE workflow is running.

A review dialog explains destination, amount, network and effects before a Mera,
browser-wallet or local-demo transaction. Deposits have two transactions: approval
then deposit. An approval can remain if the second step fails. The client tracks
submitted hashes and blocks retries when confirmation is unknown until the receipt
is reconciled within the session. Persistent recovery after tab closure is not yet
implemented; inspect the submitted hash before repeating an uncertain transaction.

The activity list decodes actual account events from the current local deployment.
Submission events do not assert an order filled. Refusal events are distinct from
successful top-ups. A log-fetch failure is identified separately from balance-read
failure. Public history/indexer integration remains open.

The dashboard polls every eight seconds while connected. On a local fork the mark
and chain time are historical. The fixture intentionally uses high trigger/target
buffers to make one top-up immediately eligible. Those values are demonstration
parameters, not recommended trading settings.

## Deployment boundary

`GET /api/deployment/` supplies public addresses only. The local mode requires the
server flag `SETSUNA_LOCAL_DEMO=1`, a loopback hostname, validated manifest fields,
a live chain 31337 and deployed factory code. It hardcodes the loopback RPC endpoint
rather than accepting an arbitrary RPC URL from a request. It never signs or sends
transactions server-side. Outside that mode, Monad connection is available but
there is no public factory configured, so contract writes remain unavailable.

The native Expo application, Envio, CRE, public deployment and device validation
are not claimed complete by this web implementation.
