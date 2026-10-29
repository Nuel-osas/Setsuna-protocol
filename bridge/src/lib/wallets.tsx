"use client";

import { getWallets, type Wallet } from "@mysten/wallet-standard";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Ecosystem } from "./chains";

// One place for every wallet the user connects, across ecosystems:
// EVM via EIP-6963 discovery, Solana via injected providers, Sui and Aptos via Wallet Standard.

export type Eip1193 = {
  request: (a: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (e: string, f: (...a: never[]) => void) => void;
  removeListener?: (e: string, f: (...a: never[]) => void) => void;
};

export type SolanaProvider = {
  publicKey?: { toString(): string } | null;
  connect(): Promise<{ publicKey: { toString(): string } }>;
  disconnect(): Promise<void>;
  signTransaction(tx: unknown): Promise<unknown>;
  signAllTransactions?(txs: unknown[]): Promise<unknown[]>;
};

export type WalletOption = {
  id: string;
  name: string;
  icon?: string;
  ecosystem: Ecosystem;
  connect: () => Promise<Connected>;
};

export type Connected = {
  ecosystem: Ecosystem;
  name: string;
  icon?: string;
  address: string;
  // the handle each bridge adapter needs
  evm?: Eip1193;
  solana?: SolanaProvider;
  standard?: Wallet;
};

type Ctx = {
  options: WalletOption[];
  connected: Partial<Record<Ecosystem, Connected>>;
  connect: (o: WalletOption) => Promise<void>;
  disconnect: (e: Ecosystem) => void;
};

const WalletCtx = createContext<Ctx | null>(null);
export const useWallets = () => useContext(WalletCtx)!;

type Win = Window & {
  ethereum?: Eip1193;
  phantom?: { solana?: SolanaProvider & { isPhantom?: boolean } };
  solflare?: SolanaProvider & { isSolflare?: boolean };
  backpack?: { solana?: SolanaProvider };
};

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [evm, setEvm] = useState<{ info: { uuid: string; name: string; icon: string }; provider: Eip1193 }[]>([]);
  const [standard, setStandard] = useState<readonly Wallet[]>([]);
  const [solanaInjected, setSolanaInjected] = useState<{ id: string; name: string; icon?: string; p: SolanaProvider }[]>([]);
  const [connected, setConnected] = useState<Partial<Record<Ecosystem, Connected>>>({});

  // EIP-6963: every EVM wallet announces itself, so several can coexist.
  useEffect(() => {
    const seen = new Map<string, (typeof evm)[number]>();
    const onAnnounce = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d?.info?.uuid || seen.has(d.info.rdns ?? d.info.uuid)) return;
      seen.set(d.info.rdns ?? d.info.uuid, d);
      setEvm([...seen.values()]);
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    // legacy fallback if nothing announces
    const t = setTimeout(() => {
      const eth = (window as Win).ethereum;
      if (!seen.size && eth) setEvm([{ info: { uuid: "injected", name: "Browser wallet", icon: "" }, provider: eth }]);
    }, 600);
    return () => { window.removeEventListener("eip6963:announceProvider", onAnnounce); clearTimeout(t); };
  }, []);

  // Wallet Standard: Sui and Aptos wallets (and some Solana ones) register here.
  useEffect(() => {
    const api = getWallets();
    const sync = () => setStandard([...api.get()]);
    sync();
    const offs = [api.on("register", sync), api.on("unregister", sync)];
    return () => offs.forEach((off) => off());
  }, []);

  // Solana: Circle's adapter wants the injected provider API (connect / signTransaction).
  useEffect(() => {
    const w = window as Win;
    const list: typeof solanaInjected = [];
    if (w.phantom?.solana) list.push({ id: "phantom", name: "Phantom", p: w.phantom.solana });
    if (w.solflare) list.push({ id: "solflare", name: "Solflare", p: w.solflare });
    if (w.backpack?.solana) list.push({ id: "backpack", name: "Backpack", p: w.backpack.solana });
    setSolanaInjected(list);
  }, [standard.length]);

  const options = useMemo<WalletOption[]>(() => {
    const out: WalletOption[] = [];
    for (const { info, provider } of evm) {
      out.push({
        id: `evm:${info.uuid}`, name: info.name, icon: info.icon || undefined, ecosystem: "evm",
        connect: async () => {
          const [address] = (await provider.request({ method: "eth_requestAccounts" })) as string[];
          return { ecosystem: "evm", name: info.name, icon: info.icon, address, evm: provider };
        },
      });
    }
    for (const s of solanaInjected) {
      out.push({
        id: `sol:${s.id}`, name: s.name, icon: s.icon ?? standard.find((w) => w.name === s.name)?.icon, ecosystem: "solana",
        connect: async () => {
          const r = await s.p.connect();
          return { ecosystem: "solana", name: s.name, icon: s.icon ?? standard.find((w) => w.name === s.name)?.icon, address: r.publicKey.toString(), solana: s.p };
        },
      });
    }
    for (const w of standard) {
      const chains = w.chains.join(" ");
      // A wallet can serve both (Nightly), so it is offered under each.
      const ecos = (["sui", "aptos"] as const).filter((e) => chains.includes(`${e}:`));
      for (const eco of ecos) {
        // Aptos wallets (AIP-62: Petra, Nightly, Pontem…) connect through aptos:connect, not standard:connect.
        const aptosConnect = eco === "aptos" ? (w.features["aptos:connect"] as { connect: () => Promise<{ status: string; args?: { address: { toString(): string } | string } }> } | undefined) : undefined;
        const stdConnect = w.features["standard:connect"] as { connect: () => Promise<{ accounts: readonly { address: string }[] }> } | undefined;
        if (!aptosConnect && !stdConnect) continue;
        out.push({
          id: `${eco}:${w.name}`, name: w.name, icon: w.icon, ecosystem: eco,
          connect: async () => {
            let address: string | undefined;
            if (aptosConnect) {
              const r = await aptosConnect.connect();
              if (r.status !== "Approved") throw new Error("Connection rejected");
              address = r.args?.address?.toString();
            } else {
              const { accounts } = await stdConnect!.connect();
              address = accounts.find((a) => (a as { chains?: readonly string[] }).chains?.some((c) => c.startsWith(`${eco}:`)) ?? true)?.address;
            }
            address ??= w.accounts.find((a) => a.chains.some((c) => c.startsWith(`${eco}:`)))?.address;
            if (!address) throw new Error(`${w.name} returned no account`);
            return { ecosystem: eco, name: w.name, icon: w.icon, address, standard: w };
          },
        });
      }
    }
    return out;
  }, [evm, solanaInjected, standard]);

  const connect = useCallback(async (o: WalletOption) => {
    const c = await o.connect();
    setConnected((prev) => ({ ...prev, [c.ecosystem]: c }));
  }, []);

  const disconnect = useCallback((e: Ecosystem) => {
    setConnected((prev) => {
      const c = prev[e];
      c?.solana?.disconnect().catch(() => {});
      const f = c?.standard?.features[e === "aptos" && c.standard.features["aptos:disconnect"] ? "aptos:disconnect" : "standard:disconnect"] as { disconnect?: () => Promise<void> } | undefined;
      f?.disconnect?.().catch(() => {});
      const next = { ...prev };
      delete next[e];
      return next;
    });
  }, []);

  // keep EVM account in sync when the user switches accounts in the wallet
  useEffect(() => {
    const p = connected.evm?.evm;
    if (!p?.on) return;
    const onAcc = (a: string[]) => setConnected((prev) => (a[0] && prev.evm ? { ...prev, evm: { ...prev.evm, address: a[0] } } : prev));
    p.on("accountsChanged", onAcc as never);
    return () => p.removeListener?.("accountsChanged", onAcc as never);
  }, [connected.evm?.evm]);

  return <WalletCtx.Provider value={{ options, connected, connect, disconnect }}>{children}</WalletCtx.Provider>;
}

export const short = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
