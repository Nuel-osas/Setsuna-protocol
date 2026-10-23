"use client";
import { useEffect, useRef, type MutableRefObject } from "react";
import {
  PrivyProvider,
  useLogin,
  usePrivy,
  useWallets,
  type ConnectedWallet,
} from "@privy-io/react-auth";
import { monad } from "viem/chains";

/** Public identifier of the Setsuna Privy app; it grants no access by itself. */
export const PRIVY_APP_ID =
  process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "cmv4byhwy014n0fl2hrinwv0d";

export type PrivyState = {
  ready: boolean;
  authenticated: boolean;
  wallets: ConnectedWallet[];
};
export type PrivyApi = { login: () => void; logout: () => Promise<void> };
export type PrivyEvents = {
  onComplete: (event: { wasAlreadyAuthenticated: boolean }) => void;
  onError: () => void;
};

/**
 * Privy, loaded on demand. It wraps only this bridge, not the page, so the
 * site renders without Privy's ~1 MB of scripts; WalletProvider mounts it when
 * someone opens Connect, returns from Google sign-in, or already has a session.
 */
export default function PrivyBridge(props: {
  api: MutableRefObject<PrivyApi>;
  events: MutableRefObject<PrivyEvents>;
  onState: (state: PrivyState) => void;
}) {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["email", "google"],
        appearance: { theme: "dark", accentColor: "#8b8cff" },
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
          // Every write already passes Setsuna's own review step. Privy's
          // confirmation modal would also open beneath the native review
          // dialog's top layer, where it cannot be clicked.
          showWalletUIs: false,
        },
        defaultChain: monad,
        supportedChains: [monad],
      }}
    >
      <Bridge {...props} />
    </PrivyProvider>
  );
}

function Bridge({
  api,
  events,
  onState,
}: {
  api: MutableRefObject<PrivyApi>;
  events: MutableRefObject<PrivyEvents>;
  onState: (state: PrivyState) => void;
}) {
  const privy = usePrivy();
  const { wallets } = useWallets();
  const { login } = useLogin({
    // Also fires after Google's redirect returns, when in-memory state is gone.
    onComplete: (event) => events.current.onComplete(event),
    // Privy reports closing its modal as an error even after a login succeeds.
    onError: () => events.current.onError(),
  });
  api.current = { login, logout: privy.logout };
  // useWallets() hands back a new array on every render; report only real
  // changes, or setting the parent's state would re-render this forever.
  const last = useRef("");
  const signature = `${privy.ready}|${privy.authenticated}|${wallets.map((w) => `${w.walletClientType}:${w.address}`).join(",")}`;
  useEffect(() => {
    if (signature === last.current) return;
    last.current = signature;
    onState({ ready: privy.ready, authenticated: privy.authenticated, wallets });
  }, [signature, privy.ready, privy.authenticated, wallets, onState]);
  return null;
}
