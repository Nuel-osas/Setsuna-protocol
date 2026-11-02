import { getAddress, isAddress } from "viem";
import type { Chain } from "./chains";

// A typed recipient is checked against the destination chain before anything is burned: Circle
// mints to whatever bytes it is given, and a wrong address can never be recovered.

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const HEX64 = /^0x[0-9a-fA-F]{64}$/;

export type RecipientCheck = { ok: true; address: string } | { ok: false; error: string };

export function checkRecipient(chain: Chain, raw: string): RecipientCheck {
  const a = raw.trim();
  switch (chain.ecosystem) {
    case "evm":
      // Mixed case must pass the EIP-55 checksum, which catches a typo in most addresses.
      if (!/^0x[0-9a-fA-F]{40}$/.test(a)) return { ok: false, error: `A ${chain.name} address is 0x followed by 40 hex characters.` };
      if (!isAddress(a)) return { ok: false, error: "This address fails its checksum; a character is probably wrong." };
      return { ok: true, address: getAddress(a) };
    case "sui":
    case "aptos":
      // Full 64-hex form only: a shorter value (such as an EVM address) would be padded into an
      // address nobody holds.
      if (!HEX64.test(a)) return { ok: false, error: `A ${chain.name} address is 0x followed by 64 hex characters.` };
      return { ok: true, address: a.toLowerCase() };
    case "solana":
      if (!BASE58.test(a)) return { ok: false, error: "A Solana address is 32 to 44 base58 characters." };
      return { ok: true, address: a };
    default:
      return { ok: false, error: `${chain.name} recipients aren't supported yet.` };
  }
}
