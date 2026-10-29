"use client";

import { AccountAddress, Aptos, AptosConfig, MoveVector, Network as AptosNetwork, U32, U64 } from "@aptos-labs/ts-sdk";
import type { Wallet } from "@mysten/wallet-standard";
import type { Network } from "./chains";

// Circle CCTP V2 on Aptos (domain 9). V2 has no entry functions: burn and mint return hot-potato
// receipts, so both run as Move scripts. The compiled scripts are Circle's own (public/cctp/aptos,
// Apache-2.0) and have each network's package addresses baked in.

const CFG = {
  mainnet: { usdc: "0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b", net: AptosNetwork.MAINNET, chain: "aptos:mainnet" },
  testnet: { usdc: "0x69091fbab5f7d635ee7ac5098cf0c1efbe31d68fec0f2cd565e8d168daf52832", net: AptosNetwork.TESTNET, chain: "aptos:testnet" },
} as const;

const client = (n: Network) => new Aptos(new AptosConfig({ network: CFG[n].net }));
const hexBytes = (h: string) => Uint8Array.from((h.startsWith("0x") ? h.slice(2) : h).match(/../g)!.map((b) => parseInt(b, 16)));

async function script(n: Network, name: "deposit_for_burn" | "receive_message") {
  const r = await fetch(`/cctp/aptos/${n}/${name}.mv`);
  if (!r.ok) throw new Error(`Missing Aptos script ${name}`);
  return new Uint8Array(await r.arrayBuffer());
}

export const aptosToBytes32 = (addr: string) => AccountAddress.from(addr).toStringLong() as `0x${string}`;

type ScriptPayload = { bytecode: Uint8Array; typeArguments: []; functionArguments: unknown[] };

// Wallet Standard first (Petra, Nightly…); if a wallet refuses script payloads, build the
// transaction ourselves, have the wallet sign it, and submit through the SDK.
async function submit(wallet: Wallet, owner: string, n: Network, payload: ScriptPayload): Promise<string> {
  const aptos = client(n);
  const sas = wallet.features["aptos:signAndSubmitTransaction"] as
    | { signAndSubmitTransaction: (i: { payload: ScriptPayload }) => Promise<{ status: string; args?: { hash: string } }> }
    | undefined;
  let hash: string | undefined;
  if (sas) {
    try {
      const res = await sas.signAndSubmitTransaction({ payload });
      if (res.status !== "Approved") throw new Error("Rejected in wallet");
      hash = res.args!.hash;
    } catch (e) {
      if ((e as Error).message === "Rejected in wallet") throw e;
    }
  }
  if (!hash) {
    const sign = wallet.features["aptos:signTransaction"] as
      | { signTransaction: (tx: unknown) => Promise<{ status: string; args?: unknown }> }
      | undefined;
    if (!sign) throw new Error(`${wallet.name} can't sign Aptos script transactions`);
    const transaction = await aptos.transaction.build.simple({ sender: owner, data: payload as never });
    const res = await sign.signTransaction(transaction);
    if (res.status !== "Approved") throw new Error("Rejected in wallet");
    const sub = await aptos.transaction.submit.simple({ transaction, senderAuthenticator: res.args as never });
    hash = sub.hash;
  }
  const done = await aptos.waitForTransaction({ transactionHash: hash });
  if (!(done as { success?: boolean }).success) throw new Error(`Aptos transaction failed: ${(done as { vm_status?: string }).vm_status ?? "unknown"}`);
  return hash;
}

// Aptos → anywhere. Circle marks Fast as N/A for Aptos (~0.5s finality): finality 2000, fee 0.
export async function aptosBurn(o: { network: Network; wallet: Wallet; owner: string; amount: bigint; destDomain: number; mintRecipient32: `0x${string}` }) {
  return submit(o.wallet, o.owner, o.network, {
    bytecode: await script(o.network, "deposit_for_burn"),
    typeArguments: [],
    functionArguments: [
      new U64(o.amount), new U32(o.destDomain), AccountAddress.from(o.mintRecipient32), AccountAddress.ZERO,
      AccountAddress.from(CFG[o.network].usdc), new U64(0n), new U32(2000),
    ],
  });
}

// anywhere → Aptos. USDC lands in the recipient's primary fungible store.
export async function aptosMint(o: { network: Network; wallet: Wallet; owner: string; message: string; attestation: string }) {
  return submit(o.wallet, o.owner, o.network, {
    bytecode: await script(o.network, "receive_message"),
    typeArguments: [],
    functionArguments: [MoveVector.U8(hexBytes(o.message)), MoveVector.U8(hexBytes(o.attestation))],
  });
}

export async function aptosUsdcBalance(n: Network, owner: string): Promise<bigint | null> {
  try {
    const [v] = await client(n).view({
      payload: {
        function: "0x1::primary_fungible_store::balance",
        typeArguments: ["0x1::fungible_asset::Metadata"],
        functionArguments: [owner, CFG[n].usdc],
      },
    });
    return BigInt(v as string);
  } catch {
    return null;
  }
}
