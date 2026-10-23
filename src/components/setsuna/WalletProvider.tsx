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
  createWalletClient,
  custom,
  http,
  formatEther,
  toHex,
  getAddress,
  type Address,
  type EIP1193Provider,
  type Hex,
  type WalletClient,
} from "viem";
import type { Secp256k1SigningSession } from "@category-labs/mera";
import dynamic from "next/dynamic";
import type { PrivyApi, PrivyEvents, PrivyState } from "./PrivyBridge";
import { toast } from "./Toaster";
import type { Deployment } from "@/lib/setsuna/types";
import { message, shortAddress } from "@/lib/setsuna/format";
import Brand from "./Brand";
import { readDeployment } from "@/lib/setsuna/deployment-client";
import { chainFor, clientFor } from "@/lib/setsuna/rpc-client";
export { chainFor, clientFor };
type Provider = EIP1193Provider & {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (
    event: string,
    listener: (...args: unknown[]) => void,
  ) => void;
};
type Choice = {
  name: string;
  uuid: string;
  icon?: string;
  provider: Provider;
  /** Known account of an embedded wallet; skips the account request. */
  address?: Address;
};

function WalletIcon({ name, icon }: { name?: string; icon?: string }) {
  const [failed, setFailed] = useState<string>();
  // Keep Phantom's official mark available even without an announced icon.
  const src = /^phantom(?: wallet)?$/i.test(name ?? "")
    ? "/images/wallets/phantom.svg"
    : icon?.startsWith("data:image/")
      ? icon
      : undefined;
  return (
    <span className="s-wallet-icon" aria-hidden="true">
      {src && failed !== src ? (
        <img
          src={src}
          alt=""
          width={28}
          height={28}
          onError={() => setFailed(src)}
        />
      ) : (
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20 8V5a2 2 0 0 0-2-2L5 6a3 3 0 0 0-2 3v10a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1H6a2 2 0 0 1-2-2" />
          <path d="M21 12h-5a2 2 0 0 0 0 4h5" />
          <circle cx="17" cy="14" r=".75" fill="currentColor" stroke="none" />
        </svg>
      )}
    </span>
  );
}
type WalletState = {
  deployment?: Deployment;
  address?: Address;
  kind?: "mera" | "wallet";
  chainId?: number;
  openConnect: () => void;
  disconnect: () => void;
  send: (
    to: Address,
    data: Hex,
    onHash?: (hash: Hex) => void,
    value?: bigint,
  ) => Promise<Hex>;
  /** Same account, another deployment's network (see TradingScope). */
  sendOn: (
    target: Deployment,
    to: Address,
    data: Hex,
    onHash?: (hash: Hex) => void,
    value?: bigint,
  ) => Promise<Hex>;
};
const Context = createContext<WalletState | null>(null);
// Privy and its WalletConnect list are ~1 MB; they load only when needed.
const PrivyBridge = dynamic(() => import("./PrivyBridge"), { ssr: false });
export function useWallet() {
  const value = useContext(Context);
  if (!value) throw new Error("Wallet provider missing");
  return value;
}
export function WalletProvider({
  children,
  initialDeployment,
}: {
  children: ReactNode;
  /** Rendered into the page by the server, so no fetch is needed to start. */
  initialDeployment?: Deployment;
}) {
  const [deployment, setDeployment] = useState<Deployment | undefined>(
    initialDeployment,
  );
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
  // Email/Google accounts sign with a Privy embedded wallet through the same
  // EIP-1193 path as browser wallets; only login and logout differ.
  // Privy loads on demand (see PrivyBridge); until then it reports not ready.
  const [privyWanted, setPrivyWanted] = useState(false);
  const [privy, setPrivy] = useState<PrivyState>({
    ready: false,
    authenticated: false,
    wallets: [],
  });
  const privyWallets = privy.wallets;
  const privyApi = useRef<PrivyApi>({
    login: () => {},
    logout: async () => {},
  });
  const [privyPending, setPrivyPending] = useState(false);
  const viaPrivy = useRef(false);
  const privyAuthenticated = useRef(privy.authenticated);
  privyAuthenticated.current = privy.authenticated;
  const privyLogout = useRef(() => privyApi.current.logout());
  const privyLogin = () => privyApi.current.login();
  const privyEvents = useRef<PrivyEvents>({
    onComplete: () => {},
    onError: () => {},
  });
  privyEvents.current = {
    onComplete: ({ wasAlreadyAuthenticated }) => {
      if (!wasAlreadyAuthenticated) setPrivyPending(true);
    },
    onError: () => {
      if (!privyAuthenticated.current) setPrivyPending(false);
    },
  };
  useEffect(() => {
    // Returning from Google sign-in, or a saved Privy session, needs Privy now.
    try {
      if (
        location.search.includes("privy_oauth") ||
        Object.keys(localStorage).some((k) => k.startsWith("privy:"))
      )
        setPrivyWanted(true);
    } catch {}
  }, []);
  const disconnect = useCallback(() => {
    if (viaPrivy.current) {
      viaPrivy.current = false;
      void privyLogout.current().catch(() => {});
    }
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
    if (!initialDeployment)
      readDeployment()
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
          info: { name: string; uuid: string; icon?: string };
          provider: Provider;
        }>
      ).detail;
      if (info && p)
        setChoices((old) => {
          const choice = {
            name: info.name,
            uuid: info.uuid,
            icon: typeof info.icon === "string" ? info.icon : undefined,
            provider: p,
          };
          // A late announcement can upgrade the generic injected-wallet entry.
          return old.some((v) => v.provider === p)
            ? old.map((v) => (v.provider === p ? choice : v))
            : [...old, choice];
        });
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
    // Opening Connect starts loading Privy while the choices are on screen.
    if (open) setPrivyWanted(true);
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  useEffect(() => {
    if (!privyPending || !deployment || !privy.ready || !privy.authenticated)
      return;
    const embedded = privyWallets.find((w) => w.walletClientType === "privy");
    if (!embedded) return;
    setPrivyPending(false);
    void (async () => {
      // A just-created embedded wallet can take a moment to answer.
      let failure: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt) await new Promise((r) => setTimeout(r, 1000));
        try {
          const eip1193 = (await embedded.getEthereumProvider()) as Provider;
          const ok = await connect("wallet", {
            name: "Email · Privy",
            uuid: "privy",
            provider: eip1193,
            address: getAddress(embedded.address),
          });
          if (ok) {
            viaPrivy.current = true;
            return;
          }
        } catch (e) {
          failure = e;
        }
      }
      toast(
        `Signed in, but the wallet did not connect${failure ? `: ${message(failure)}` : ""}. Press Connect to retry.`,
      );
    })();
    // connect is recreated each render; this runs once per completed login.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    privyPending,
    deployment,
    privy.ready,
    privy.authenticated,
    privyWallets,
  ]);
  function continueWithPrivy() {
    setError("");
    disconnect();
    // Privy opens its own modal; the native dialog would sit above it.
    setOpen(false);
    setPrivyPending(true);
    if (!privy.authenticated) privyLogin();
  }
  async function connect(
    mode: "create" | "recover" | "wallet",
    choice?: Choice,
  ) {
    if (!deployment) return false;
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
      } else {
        if (!choice) throw new Error("Choose an installed wallet.");
        provider.current = choice.provider;
        wallet = createWalletClient({
          chain,
          transport: custom(choice.provider),
        });
        if (choice.address) {
          // Embedded wallets sign for whichever chain each request names.
          nextAddress = choice.address;
        } else {
          const accounts = await wallet.requestAddresses();
          if (!accounts[0]) throw new Error("No account was shared.");
          nextAddress = getAddress(accounts[0]);
          nextChain = await wallet.getChainId();
        }
        // Embedded wallets re-announce the same account once connected; only a
        // real switch (or a revoked account) ends the session.
        const connected = nextAddress;
        const accountsChanged = (...args: unknown[]) => {
          const next = (args[0] as string[] | undefined)?.[0];
          if (!next || getAddress(next) !== connected) disconnect();
        };
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
        return false;
      }
      session.current = pendingSession ?? null;
      client.current = wallet;
      setAddress(nextAddress);
      setChainId(nextChain);
      setKind(mode === "wallet" ? "wallet" : "mera");
      setOpen(false);
      return true;
    } catch (e) {
      pendingSession?.end();
      if (generation.current === current) {
        disconnect();
        setError(message(e));
      }
    } finally {
      setBusy(false);
    }
    return false;
  }
  async function sendOn(
    target: Deployment,
    to: Address,
    data: Hex,
    onHash?: (hash: Hex) => void,
    value = BigInt(0),
  ) {
    const connected = client.current;
    const initialGeneration = generation.current;
    if (
      !connected ||
      !address ||
      (!target.factory && !target.earnMON && !target.earnUSDC && !target.spot)
    )
      throw new Error("Connect an account to an available deployment first.");
    if (
      connected.account &&
      connected.account.address.toLowerCase() !== address.toLowerCase()
    )
      throw new Error("Session changed. Reconnect before continuing.");
    // A passkey signs locally, so it can use any network's RPC directly.
    const wallet: WalletClient =
      kind !== "wallet" && connected.account
        ? createWalletClient({
            account: connected.account,
            chain: chainFor(target),
            transport: http(target.rpc),
          })
        : connected;
    const pub = clientFor(target);
    if ((await pub.getChainId()) !== target.chainId)
      throw new Error("RPC network changed. Transaction cancelled.");
    if (kind === "wallet") {
      const selected = await wallet.getAddresses();
      if (selected[0]?.toLowerCase() !== address.toLowerCase()) {
        disconnect();
        throw new Error("Wallet account changed. Reconnect before continuing.");
      }
      if ((await wallet.getChainId()) !== target.chainId) {
        try {
          await wallet.switchChain({ id: target.chainId });
        } catch (e) {
          if ((e as { code?: number }).code !== 4902) throw e;
          await wallet.addChain({ chain: chainFor(target) });
          await wallet.switchChain({ id: target.chainId });
        }
        if ((await wallet.getChainId()) !== target.chainId)
          throw new Error("Switch to the configured network first.");
        setChainId(target.chainId);
      }
    }
    if (!(await pub.getCode({ address: to })))
      throw new Error("No contract at this address. Refresh the target.");
    await pub.call({ account: address, to, data, value });
    const gas = await pub.estimateGas({ account: address, to, data, value });
    // Embedded wallets report an empty gas balance only as a generic RPC
    // error, so check it here and say what is missing.
    const [balance, gasPrice] = await Promise.all([
      pub.getBalance({ address }),
      pub.getGasPrice(),
    ]);
    const needed = (gas * BigInt(120) * gasPrice) / BigInt(100) + value;
    if (balance < needed)
      throw new Error(
        `Not enough MON for this transaction. It needs about ${formatEther(needed)} MON including gas; this wallet holds ${formatEther(balance)} MON.`,
      );
    if (initialGeneration !== generation.current)
      throw new Error("Session changed. Reconnect before continuing.");
    const gasLimit = (gas * BigInt(120)) / BigInt(100);
    // Browser and embedded wallets get a plain eth_sendTransaction. viem's
    // fallback to wallet_sendTransaction hides the wallet's real error when an
    // embedded provider forwards that method to a public RPC.
    const injected = kind === "wallet" ? provider.current : null;
    const hash: Hex = injected
      ? ((await injected.request({
          method: "eth_sendTransaction",
          params: [
            {
              from: address,
              to,
              data,
              value: toHex(value),
              gas: toHex(gasLimit),
              // Privy's embedded provider rejects requests without the chain.
              chainId: toHex(target.chainId),
            },
          ],
        })) as Hex)
      : await wallet.sendTransaction({
          account: wallet.account ?? address,
          chain: chainFor(target),
          to,
          data,
          value,
          gas: gasLimit,
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
  const send = (
    to: Address,
    data: Hex,
    onHash?: (hash: Hex) => void,
    value?: bigint,
  ) => {
    if (!deployment)
      throw new Error("Connect an account to an available deployment first.");
    return sendOn(deployment, to, data, onHash, value);
  };
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
        sendOn,
      }}
    >
      {children}
      {privyWanted && (
        <PrivyBridge api={privyApi} events={privyEvents} onState={setPrivy} />
      )}
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
            <p>{kind === "mera" ? "Mera passkey" : "Connected wallet"}</p>
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
            <button
              className="s-button s-button-outline s-full"
              disabled={busy || !deployment || !privy.ready}
              onClick={continueWithPrivy}
            >
              Continue with email or Google
            </button>
            <p className="s-small">
              Powered by Privy. Creates a Monad wallet for your login; you sign
              every transaction.
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
                  <span className="s-wallet-choice">
                    <WalletIcon name={c.name} icon={c.icon} />
                    <span>{c.name}</span>
                  </span>
                  <span aria-hidden="true">↗</span>
                </button>
              ))
            ) : (
              <p className="s-small">
                No browser wallet detected. Open in your wallet’s browser or
                enable its extension.
              </p>
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

/**
 * Spot and Perps use their Monad mainnet contract configuration.
 */
export function TradingScope({ children }: { children: ReactNode }) {
  const wallet = useWallet();
  const trading = wallet.deployment?.trading;
  if (!trading) return <>{children}</>;
  return (
    <Context.Provider
      value={{
        ...wallet,
        deployment: trading,
        send: (to, data, onHash, value) =>
          wallet.sendOn(trading, to, data, onHash, value),
      }}
    >
      {children}
    </Context.Provider>
  );
}

/**
 * Earn uses its Monad mainnet vault configuration.
 */
export function EarnScope({ children }: { children: ReactNode }) {
  const wallet = useWallet();
  const mainnet = wallet.deployment?.earnMainnet;
  if (!mainnet) return <>{children}</>;
  return (
    <Context.Provider
      value={{
        ...wallet,
        deployment: mainnet,
        send: (to, data, onHash, value) =>
          wallet.sendOn(mainnet, to, data, onHash, value),
      }}
    >
      {children}
    </Context.Provider>
  );
}
