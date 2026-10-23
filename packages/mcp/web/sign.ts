// Browser page at /sign: rebuilds a Setsuna deposit or withdrawal from the link's request with the
// published SDK, then has the visitor's own wallet sign it. The link never carries transaction data,
// so a crafted link cannot smuggle in a different transaction; this page can only deposit into a
// Setsuna vault or withdraw back to the connected wallet.
import { createSetsuna, monad, VAULTS, type Prepared, type VaultId } from "@setsunaprotocol/sdk";
import { createPublicClient, createWalletClient, custom, http, type EIP1193Provider } from "viem";

type Request =
  | { vault: VaultId; action: "deposit"; amount: string }
  | { vault: VaultId; action: "withdraw"; amount?: string; shares?: string; all?: true };

const $ = (id: string) => document.getElementById(id)!;
const el = (tag: string, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const short = (formatted: string, max = 4) => Number(formatted).toLocaleString("en-US", { maximumFractionDigits: Number(formatted) >= 1 ? max : 6 });
const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const NUMBER = /^\d+(\.\d+)?$/;

function readRequest(): Request {
  const q = new URLSearchParams(location.search);
  const vault = q.get("vault");
  const action = q.get("action");
  if (vault !== "setsUSDC" && vault !== "setsMON") throw new Error('This link has no vault. It should name "setsUSDC" or "setsMON".');
  if (action === "deposit") {
    const amount = q.get("amount") ?? "";
    if (!NUMBER.test(amount) || Number(amount) <= 0) throw new Error("This link has no valid deposit amount.");
    return { vault, action, amount };
  }
  if (action === "withdraw") {
    const amount = q.get("amount"), shares = q.get("shares"), all = q.get("all") === "true";
    const given = [amount !== null, shares !== null, all].filter(Boolean).length;
    if (given !== 1) throw new Error("This withdrawal link should give exactly one of amount, shares or all.");
    if (amount !== null && !NUMBER.test(amount)) throw new Error("This link has an invalid amount.");
    if (shares !== null && !NUMBER.test(shares)) throw new Error("This link has an invalid share count.");
    return all ? { vault, action, all: true } : shares !== null ? { vault, action, shares } : { vault, action, amount: amount! };
  }
  throw new Error('This link should ask for a "deposit" or a "withdraw".');
}

// Reads go to Monad mainnet. A local RPC is accepted only on localhost, for end-to-end tests.
const rpcOverride = new URLSearchParams(location.search).get("rpc");
const rpcUrl = rpcOverride && ["localhost", "127.0.0.1"].includes(location.hostname) ? rpcOverride : undefined;
const setsuna = createSetsuna({ rpcUrl });
const reader = createPublicClient({ chain: monad, transport: http(rpcUrl ?? "https://rpc2.monad.xyz") });

/* ── wallets: EIP-6963 discovery, with window.ethereum as a fallback ── */
type Found = { name: string; icon?: string; provider: EIP1193Provider };
const wallets = new Map<string, Found>();
window.addEventListener("eip6963:announceProvider", (event: Event) => {
  const { info, provider } = (event as CustomEvent).detail;
  wallets.set(info.uuid, { name: info.name, icon: info.icon, provider });
  renderWallets();
});
window.dispatchEvent(new Event("eip6963:requestProvider"));

let account: `0x${string}` | undefined;
let provider: EIP1193Provider | undefined;
let prepared: Prepared | undefined;
let busy = false;

function setStatus(text: string, tone: "info" | "ok" | "bad" = "info") {
  const s = $("status");
  s.textContent = text;
  s.dataset.tone = tone;
  s.hidden = !text;
}

function renderWallets() {
  const box = $("wallets");
  if (account) return;
  const list = [...wallets.values()];
  const fallback = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
  if (!list.length && fallback) list.push({ name: "Browser wallet", provider: fallback });
  box.replaceChildren(
    ...(list.length
      ? list.map((w) => {
          const b = el("button", "wallet") as HTMLButtonElement;
          b.type = "button";
          if (w.icon) {
            const img = el("img") as HTMLImageElement;
            img.src = w.icon;
            img.alt = "";
            b.append(img);
          }
          b.append(`Connect ${w.name}`);
          b.addEventListener("click", () => connect(w.provider));
          return b;
        })
      : [el("p", "muted", "No browser wallet found. Install MetaMask, Rabby, Phantom or Coinbase Wallet, then reload this page.")]),
  );
}

async function connect(p: EIP1193Provider) {
  try {
    setStatus("Waiting for your wallet…");
    const [address] = (await p.request({ method: "eth_requestAccounts" })) as `0x${string}`[];
    try {
      await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x8f" }] });
    } catch {
      await p.request({
        method: "wallet_addEthereumChain",
        params: [{ chainId: "0x8f", chainName: "Monad", nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 }, rpcUrls: ["https://rpc2.monad.xyz"], blockExplorerUrls: ["https://monadscan.com"] }],
      });
    }
    provider = p;
    account = address;
    $("wallets").replaceChildren(el("p", "connected", `Connected ${shortAddr(address)} on Monad`));
    const owner = new URLSearchParams(location.search).get("owner");
    if (owner && owner.toLowerCase() !== address.toLowerCase())
      $("wallets").append(el("p", "muted", `This link was prepared for ${shortAddr(owner)}. It will use your connected wallet instead.`));
    await prepare();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "The wallet did not connect.", "bad");
  }
}

function renderSteps(p: Prepared) {
  const list = $("steps");
  list.replaceChildren(...p.transactions.map((t, i) => {
    const li = el("li");
    li.id = `step-${i}`;
    li.append(el("span", "step-label", t.label.replace(/\d+\.\d{7,}/g, (n) => short(n, 6))), el("span", "step-state", "waiting"));
    return li;
  }));
  const v = VAULTS[p.vault];
  const unit = p.action === "deposit" ? p.vault : v.assetSymbol;
  const expected = p.action === "deposit" ? p.expected.shares : p.expected.assets;
  $("expected").textContent = `${short(expected.formatted)} ${unit}`;
  $("minimum").textContent = `${short(p.minimum.formatted, 6)} ${unit}`;
  $("expires").textContent = new Date(p.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  $("review").hidden = false;
  const sign = $("sign") as HTMLButtonElement;
  sign.disabled = false;
  sign.textContent = p.transactions.length > 1 ? `Sign ${p.transactions.length} transactions` : "Sign transaction";
}

async function prepare() {
  if (!account) return;
  const r = readRequest();
  setStatus("Building your transaction from Monad…");
  try {
    prepared = r.action === "deposit"
      ? await setsuna.prepareDeposit(r.vault, r.amount, account)
      : await setsuna.prepareWithdraw(r.vault, account, r.all ? { all: true } : r.shares ? { shares: r.shares } : { amount: r.amount! });
    renderSteps(prepared);
    setStatus("");
  } catch (error) {
    $("review").hidden = true;
    setStatus(error instanceof Error ? error.message : "This request can't be prepared right now.", "bad");
  }
}

async function sign() {
  if (!prepared || !provider || !account || busy) return;
  if (Date.parse(prepared.expiresAt) - Date.now() < 30_000) await prepare();
  if (!prepared) return;
  busy = true;
  const button = $("sign") as HTMLButtonElement;
  button.disabled = true;
  const wallet = createWalletClient({ account, chain: monad, transport: custom(provider) });
  try {
    for (const [i, tx] of prepared.transactions.entries()) {
      const row = $(`step-${i}`);
      const state = row.querySelector(".step-state")!;
      state.textContent = "confirm in your wallet";
      row.dataset.state = "active";
      const hash = await wallet.sendTransaction({ to: tx.to, data: tx.data, value: BigInt(tx.value), chain: monad, account });
      state.textContent = "confirming…";
      const receipt = await reader.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`Step ${i + 1} reverted on chain. Nothing after it was sent.`);
      const link = el("a", "step-link", "view") as HTMLAnchorElement;
      link.href = `https://monadscan.com/tx/${hash}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      state.replaceChildren("done · ", link);
      row.dataset.state = "done";
    }
    const position = await setsuna.getPosition(account);
    const mine = position.vaults.find((v) => v.vault === prepared!.vault)!;
    setStatus(`Done. You now hold ${short(mine.shares.formatted)} ${mine.vault}, worth ${short(mine.assets.formatted)} ${VAULTS[mine.vault].assetSymbol}.`, "ok");
    button.textContent = "Done";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(/reject|denied|cancel/i.test(message) ? "You cancelled in your wallet. Nothing was sent." : message.split("\n")[0], "bad");
    button.disabled = false;
  } finally {
    busy = false;
  }
}

async function start() {
  let r: Request;
  try {
    r = readRequest();
  } catch (error) {
    setStatus((error as Error).message, "bad");
    return;
  }
  const v = VAULTS[r.vault];
  $("title").textContent = r.action === "deposit" ? `Deposit ${r.amount} ${v.assetSymbol}` : `Withdraw from ${r.vault}`;
  $("subtitle").textContent = r.action === "deposit"
    ? `into ${r.vault}, Setsuna's ${v.assetSymbol} vault on Monad`
    : r.all ? `your whole ${r.vault} position, back to your wallet` : `${r.amount ? `${r.amount} ${v.assetSymbol}` : `${r.shares} ${r.vault}`}, back to your wallet`;
  $("app-link").setAttribute("href", `https://setsuna.finance/earn/${v.assetSymbol === "USDC" ? "usdc" : "mon"}/`);
  $("sign").addEventListener("click", sign);
  renderWallets();
  try {
    const state = await setsuna.getVault(r.vault);
    $("apr").textContent = `${state.netAprPct.toFixed(2)}%`;
    $("markets").textContent = state.allocations.filter((a) => a.sharePct > 0.5).map((a) => a.venue).join(" · ");
    $("cap").textContent = state.depositsPaused ? "Deposits paused" : `${short(state.capRemaining.formatted, 0)} ${v.assetSymbol}`;
  } catch {
    $("apr").textContent = "—";
  }
}

void start();
