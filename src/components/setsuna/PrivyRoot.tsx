"use client";
import type { ReactNode } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { monad } from "viem/chains";

/** Public identifier of the Setsuna Privy app; it grants no access by itself. */
export const PRIVY_APP_ID =
  process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "cmv4byhwy014n0fl2hrinwv0d";

/**
 * Email and Google login with an embedded Monad wallet. Browser wallets and
 * Mera passkeys keep their own connect paths in WalletProvider.
 */
export default function PrivyRoot({ children }: { children: ReactNode }) {
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
      {children}
    </PrivyProvider>
  );
}
