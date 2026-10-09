"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  http,
  getAddress,
  type Address,
  type EIP1193Provider,
  type Hex,
  type WalletClient,
} from "viem";
import type { Secp256k1SigningSession } from "@category-labs/mera";
import type { Deployment } from "@/lib/setsuna/types";
import { message, shortAddress } from "@/lib/setsuna/format";
import Brand from "./Brand";
export const chainFor = (d: Deployment) =>
  defineChain({
    id: d.chainId,
    name: d.name,
    nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [d.rpc] } },
  });
export const clientFor = (d: Deployment) =>
  createPublicClient({
    chain: chainFor(d),
    transport: http(d.rpc, { timeout: 12_000, retryCount: 0 }),
  });
type Provider = EIP1193Provider & {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (
    event: string,
    listener: (...args: unknown[]) => void,
  ) => void;
};
type Choice = { name: string; uuid: string; provider: Provider };
type WalletState = {
  deployment?: Deployment;
  address?: Address;
  kind?: "mera" | "wallet" | "demo";
  chainId?: number;
  openConnect: () => void;
  disconnect: () => void;
  send: (
    to: Address,
    data: Hex,
    onHash?: (hash: Hex) => void,
    value?: bigint,
  ) => Promise<Hex>;
};
const Context = createContext<WalletState | null>(null);
export function useWallet() {
  const value = useContext(Context);
  if (!value) throw new Error("Wallet provider missing");
  return value;
}
export function WalletProvider({ children }: { children: ReactNode }) {
  const [deployment, setDeployment] = useState<Deployment>();
  const [address, setAddress] = useState<Address>();
  const [kind, setKind] = useState<WalletState["kind"]>();
  const [chainId, setChainId] = useState<number>();
  const [choices, setChoices] = useState<Choice[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const client = useRef<WalletClient | null>(null);
  const session = useRef<Secp256k1SigningSession | null>(null);
  const provider = useRef<Provider | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const generation = useRef(0);
  const disconnect = useCallback(() => {
    generation.current++;
    cleanup.current?.();
    cleanup.current = null;
    session.current?.end();
    session.current = null;
    client.current = null;
    provider.current = null;
    setAddress(undefined);
    setKind(undefined);
    setChainId(undefined);
  }, []);
  useEffect(() => {
    let alive = true;
    fetch("/api/deployment/", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error("Deployment unavailable");
        return r.json();
      })
      .then((d) => {
        if (alive) setDeployment(d);
      })
      .catch(() => {
        if (alive)
          setError(
            "Could not load the network configuration. Reload to retry.",
          );
      });
    const add = (event: Event) => {
      const { info, provider: p } = (
        event as CustomEvent<{
          info: { name: string; uuid: string };
          provider: Provider;
        }>
      ).detail;
      if (info && p)
        setChoices((old) =>
          old.some((v) => v.provider === p)
            ? old
            : [...old, { name: info.name, uuid: info.uuid, provider: p }],
        );
    };
    window.addEventListener("eip6963:announceProvider", add);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const timer = setTimeout(() => {
      const p = (window as Window & { ethereum?: Provider }).ethereum;
      if (p)
        setChoices((old) =>
          old.some((v) => v.provider === p)
            ? old
            : [
                ...old,
                { name: "Browser wallet", uuid: "injected", provider: p },
              ],
        );
    }, 250);
    const end = () => disconnect();
    window.addEventListener("pagehide", end);
    return () => {
      alive = false;
      clearTimeout(timer);
      window.removeEventListener("eip6963:announceProvider", add);
      window.removeEventListener("pagehide", end);
      cleanup.current?.();
      session.current?.end();
    };
  }, [disconnect]);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  async function connect(
    mode: "create" | "recover" | "demo" | "wallet",
    choice?: Choice,
  ) {
    if (!deployment) return;
    setBusy(true);
    setError("");
    disconnect();
    const current = generation.current;
    let pendingSession: Secp256k1SigningSession | undefined;
    try {
      const chain = chainFor(deployment);
      let wallet: WalletClient;
      let nextAddress: Address;
      let nextChain = deployment.chainId;
      if (mode === "create" || mode === "recover") {
        if (!window.isSecureContext || !window.PublicKeyCredential)
          throw new Error(
            "Passkeys need a secure browser. Use localhost here, or HTTPS when deployed.",
          );
        const mera = await import("@category-labs/mera");
        const { toViemAccount } = await import("@category-labs/mera/viem");
        const salt = new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode("setsuna.passkey.v1"),
          ),
        );
        const result =
          mode === "create"
            ? await mera.createPasskeyWithPrfOutput({
                rp: { id: location.hostname, name: "Setsuna" },
                user: {
                  name: "Setsuna account",
                  displayName: "Setsuna account",
                },
                prfSalt: salt,
              })
            : await mera.getPasskeyPrfOutput({
                rpId: location.hostname,
                prfSalt: salt,
              });
        try {
          pendingSession = mera.createSecp256k1SigningSession({
            privateKey: result.prfOutput,
          });
        } finally {
          result.prfOutput.fill(0);
        }
        const account = toViemAccount(pendingSession);
        nextAddress = account.address;
        wallet = createWalletClient({
          account,
          chain,
          transport: http(deployment.rpc),
        });
      } else if (mode === "demo") {
        if (
          deployment.mode !== "local" ||
          deployment.chainId !== 31337 ||
          !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)
        )
          throw new Error(
            "Demo accounts are available only on the local fork.",
          );
        const pub = clientFor(deployment);
        if ((await pub.getChainId()) !== 31337)
          throw new Error("Wrong local network.");
        wallet = createWalletClient({ chain, transport: http(deployment.rpc) });
        const accounts = await wallet.getAddresses();
        nextAddress = getAddress(deployment.owner!);
        if (
          !accounts.some((a) => a.toLowerCase() === nextAddress.toLowerCase())
        )
          throw new Error("Demo account unavailable. Restart the local demo.");
        wallet = createWalletClient({
          account: nextAddress,
          chain,
          transport: http(deployment.rpc),
        });
      } else {
        if (!choice) throw new Error("Choose an installed wallet.");
        provider.current = choice.provider;
        wallet = createWalletClient({
          chain,
          transport: custom(choice.provider),
        });
        const accounts = await wallet.requestAddresses();
        if (!accounts[0]) throw new Error("No account was shared.");
        nextAddress = getAddress(accounts[0]);
        nextChain = await wallet.getChainId();
        const accountsChanged = () => disconnect();
        const chainChanged = (...args: unknown[]) =>
          setChainId(Number(args[0]));
        choice.provider.on?.("accountsChanged", accountsChanged);
        choice.provider.on?.("chainChanged", chainChanged);
        cleanup.current = () => {
          choice.provider.removeListener?.("accountsChanged", accountsChanged);
          choice.provider.removeListener?.("chainChanged", chainChanged);
        };
      }
      if (generation.current !== current) {
        pendingSession?.end();
        return;
      }
      session.current = pendingSession ?? null;
      client.current = wallet;
      setAddress(nextAddress);
      setChainId(nextChain);
      setKind(mode === "wallet" ? "wallet" : mode === "demo" ? "demo" : "mera");
      setOpen(false);
    } catch (e) {
      pendingSession?.end();
      if (generation.current === current) {
        disconnect();
        setError(message(e));
      }
    } finally {
      setBusy(false);
    }
  }
  async function send(
    to: Address,
    data: Hex,
    onHash?: (hash: Hex) => void,
    value = BigInt(0),
  ) {
    const wallet = client.current;
    const initialGeneration = generation.current;
    if (
      !wallet ||
      !address ||
      !deployment ||
      (!deployment.factory && !deployment.earnMON && !deployment.earnUSDC && !deployment.spot)
    )
      throw new Error("Connect an account to an available deployment first.");
    if (
      wallet.account &&
      wallet.account.address.toLowerCase() !== address.toLowerCase()
    )
      throw new Error("Session changed. Reconnect before continuing.");
    const pub = clientFor(deployment);
    if ((await pub.getChainId()) !== deployment.chainId)
      throw new Error("RPC network changed. Transaction cancelled.");
    if (kind === "wallet") {
      const selected = await wallet.getAddresses();
      if (selected[0]?.toLowerCase() !== address.toLowerCase()) {
        disconnect();
        throw new Error("Wallet account changed. Reconnect before continuing.");
      }
      if ((await wallet.getChainId()) !== deployment.chainId) {
        try {
          await wallet.switchChain({ id: deployment.chainId });
        } catch (e) {
          if ((e as { code?: number }).code !== 4902) throw e;
          await wallet.addChain({ chain: chainFor(deployment) });
          await wallet.switchChain({ id: deployment.chainId });
        }
        if ((await wallet.getChainId()) !== deployment.chainId)
          throw new Error("Switch to the configured network first.");
        setChainId(deployment.chainId);
      }
    }
    if (!(await pub.getCode({ address: to })))
      throw new Error("No contract at this address. Refresh the deployment.");
    await pub.call({ account: address, to, data, value });
    const gas = await pub.estimateGas({ account: address, to, data, value });
    if (initialGeneration !== generation.current)
      throw new Error("Session changed. Reconnect before continuing.");
    const hash = await wallet.sendTransaction({
      account: wallet.account ?? address,
      chain: chainFor(deployment),
      to,
      data,
      value,
      gas: (gas * BigInt(120)) / BigInt(100),
    });
    onHash?.(hash);
    try {
      const receipt = await pub.waitForTransactionReceipt({
        hash,
        timeout: 60_000,
      });
      if (receipt.status !== "success")
        throw new Error(`Transaction reverted: ${hash}`);
    } catch (e) {
      if ((e as Error).message.startsWith("Transaction reverted")) throw e;
      throw new Error(
        `Transaction submitted but confirmation is unknown. Check ${hash} before retrying.`,
      );
    }
    return hash;
  }
  const openConnect = () => {
    setError("");
    setOpen(true);
  };
  return (
    <Context.Provider
      value={{
        deployment,
        address,
        kind,
        chainId,
        openConnect,
        disconnect,
        send,
      }}
    >
      {children}
      <dialog
        ref={dialog}
        className="s-modal"
        aria-label={
          address ? "Your Setsuna account" : "Connect Setsuna account"
        }
        onCancel={(e) => {
          if (busy) e.preventDefault();
          else setOpen(false);
        }}
        onClose={() => setOpen(false)}
      >
        <button
          className="s-modal-close"
          aria-label="Close account dialog"
          disabled={busy}
          onClick={() => setOpen(false)}
        >
          ×
        </button>
        <Brand />
        {address ? (
          <>
            <h2>Your account</h2>
            <p>
              {kind === "mera"
                ? "Mera passkey"
                : kind === "demo"
                  ? "Local demo account"
                  : "Connected wallet"}
            </p>
            <code className="s-address">{address}</code>
            <p className="s-small">
              {deployment?.name} · {shortAddress(address)}
            </p>
            <button
              className="s-button s-full"
              onClick={() => {
                disconnect();
                setOpen(false);
              }}
            >
              Disconnect account
            </button>
          </>
        ) : (
          <>
            <h2>
              Your keys.
              <br />
              Your next move.
            </h2>
            <p>Connect to your Setsuna account.</p>
            <button
              className="s-button s-full"
              disabled={busy || !deployment}
              onClick={() => void connect("create")}
            >
              {busy ? "Waiting for your device…" : "Create a passkey account"}
              <span>↗</span>
            </button>
            <button
              className="s-button s-button-outline s-full"
              disabled={busy || !deployment}
              onClick={() => void connect("recover")}
            >
              Use an existing passkey
            </button>
            <p className="s-small">
              Powered by Mera. A compatible passkey provider is required. Use
              the same passkey and domain to recover your account.
            </p>
            <div className="s-divider">or connect a wallet</div>
            {choices.length ? (
              choices.map((c) => (
                <button
                  className="s-wallet-option"
                  key={c.uuid}
                  disabled={busy || !deployment}
                  onClick={() => void connect("wallet", c)}
                >
                  {c.name}
                  <span>↗</span>
                </button>
              ))
            ) : (
              <p className="s-small">
                No browser wallet detected. Open in your wallet’s browser or
                enable its extension.
              </p>
            )}
            {deployment?.mode === "local" && (
              <button
                className="s-wallet-option s-demo-option"
                disabled={busy}
                onClick={() => void connect("demo")}
              >
                Try the local demo account <span>→</span>
              </button>
            )}
            <p className="s-small">
              Connecting does not move funds. You review transactions before
              signing.
            </p>
          </>
        )}
        {error && (
          <p className="s-error" role="alert">
            {error}
          </p>
        )}
      </dialog>
    </Context.Provider>
  );
}
