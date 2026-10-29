"use client";

import { SuiGraphQLClient } from "@mysten/sui/graphql";
import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import type { Wallet } from "@mysten/wallet-standard";
import type { Network } from "./chains";

// Circle CCTP V2 on Sui (domain 8). IDs from developers.circle.com/cctp/references/sui-packages,
// checked on-chain Oct 2026 (all packages at version 1). Burn and mint are each one PTB that
// threads hot-potato receipts through Circle's StablecoinHandler.

const CFG = {
  mainnet: {
    mt: "0x16bcfcfc465f96281663a344641c017de84529370e11aa3879d0dce43ad6db87",
    tmm: "0xeb14978abfe93a37c5d5bf86a0623b923553a5f0e794daac7724f1e2fdbfb830",
    handler: "0x185ed207c4d64fc594882ab927f9f3c6ff957aad03df8a731ba64378faeeb2bf",
    mtState: "0x0c067f7d325e5b60e3179712e7783534ba1556cbb3d359d8161497e37689230c",
    tmmState: "0x06fb166941cd7bc095edc019d054a753ec3f1e4c25f28f2ecc4a6cfa0a9b1167",
    handlerState: "0xa32de8a6dd0178fb05f662929d55cddb69a25c26bde4b83f89e36d17ead94c41",
    treasury: "0x57d6725e7a8b49a7b2a612f6bd66ab5f39fc95332ca48be421c3229d514a6de7",
    usdc: "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
    chain: "sui:mainnet",
  },
  testnet: {
    mt: "0xe9678cd42a81886e18e21361088071f275105636a4d3751e1d7f255211f73bbe",
    tmm: "0x267d3c0cb776eace2840f27e4d33da9c6d952f9749403f1fe6579f4962ed3c64",
    handler: "0xbe8479044396a45e07de2c7f14789c35b8338406eebc53b2527da56839a91561",
    mtState: "0xfee3a2b47f9ef2de2405fc63d79194307945f8ea768815cfc46083bc20fbe6ed",
    tmmState: "0x72cb55cd14d01e6361386d6ea93eecda9fa1efc3c202b8dd69c1e4683e4c0ca0",
    handlerState: "0xfbd9c0517c4f0e1817445ee2be598806e3c392a465d7e3d773d1055f3f0eed32",
    treasury: "0x7170137d4a6431bf83351ac025baf462909bffe2877d87716374fb42b9629ebe",
    usdc: "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC",
    chain: "sui:testnet",
  },
} as const;

const DENY_LIST = "0x403";
const CLOCK = "0x6";

export const suiUsdcType = (n: Network) => CFG[n].usdc;
export const suiToBytes32 = (addr: string) => normalizeSuiAddress(addr) as `0x${string}`;

const hexBytes = (h: string) => Uint8Array.from((h.startsWith("0x") ? h.slice(2) : h).match(/../g)!.map((b) => parseInt(b, 16)));

const clients: Partial<Record<Network, SuiGraphQLClient>> = {};
const suiClient = (n: Network) =>
  (clients[n] ??= new SuiGraphQLClient({ url: `https://graphql.${n}.sui.io/graphql`, network: n }));

async function execute(wallet: Wallet, owner: string, tx: Transaction, network: Network): Promise<string> {
  // Resolve coinWithBalance (find and merge the user's USDC coins) before the wallet serializes it.
  await tx.prepareForSerialization({ client: suiClient(network) as never });
  const account = wallet.accounts.find((a) => a.address === owner) ?? wallet.accounts[0];
  const f = wallet.features["sui:signAndExecuteTransaction"] as
    | { signAndExecuteTransaction: (i: { transaction: Transaction; account: unknown; chain: string }) => Promise<{ digest: string }> }
    | undefined;
  if (f) {
    const r = await f.signAndExecuteTransaction({ transaction: tx, account, chain: CFG[network].chain });
    return r.digest;
  }
  const legacy = wallet.features["sui:signAndExecuteTransactionBlock"] as
    | { signAndExecuteTransactionBlock: (i: { transactionBlock: Transaction; account: unknown; chain: string }) => Promise<{ digest: string }> }
    | undefined;
  if (!legacy) throw new Error(`${wallet.name} can't sign Sui transactions`);
  const r = await legacy.signAndExecuteTransactionBlock({ transactionBlock: tx, account, chain: CFG[network].chain });
  return r.digest;
}

// Sui → anywhere. Circle marks Fast as N/A for Sui (it finalises in ~0.5s), so finality 2000, fee 0.
export async function suiBurn(o: {
  network: Network; wallet: Wallet; owner: string; amount: bigint; destDomain: number; mintRecipient32: `0x${string}`;
}) {
  const c = CFG[o.network];
  const tx = new Transaction();
  tx.setSender(o.owner);
  const coin = tx.add(coinWithBalance({ type: c.usdc, balance: o.amount }));
  const [receipt, back] = tx.moveCall({
    target: `${c.tmm}::deposit_for_burn::deposit_for_burn`,
    typeArguments: [c.usdc],
    arguments: [
      coin, tx.pure.u32(o.destDomain), tx.pure.address(o.mintRecipient32), tx.pure.address("0x0"),
      tx.pure.u256(0n), tx.pure.u32(2000), tx.pure.vector("u8", []), tx.object(c.tmmState),
    ],
  });
  const [ticket] = tx.moveCall({
    target: `${c.handler}::handler::burn`,
    arguments: [tx.object(c.handlerState), receipt, back, tx.object(DENY_LIST), tx.object(c.treasury)],
  });
  tx.moveCall({
    target: `${c.tmm}::deposit_for_burn::complete_burn`,
    typeArguments: [c.usdc, `${c.handler}::handler::Auth`],
    arguments: [ticket, tx.object(c.tmmState), tx.object(c.mtState)],
  });
  return execute(o.wallet, o.owner, tx, o.network); // base58 digest, used as-is with Iris
}

// anywhere → Sui. Permissionless when destinationCaller is zero.
export async function suiMint(o: { network: Network; wallet: Wallet; owner: string; message: string; attestation: string }) {
  const c = CFG[o.network];
  const tx = new Transaction();
  tx.setSender(o.owner);
  const [r] = tx.moveCall({
    target: `${c.mt}::receive_message::receive_message`,
    arguments: [tx.pure.vector("u8", hexBytes(o.message)), tx.pure.vector("u8", hexBytes(o.attestation)), tx.object(c.mtState)],
  });
  const [mr] = tx.moveCall({
    target: `${c.tmm}::handle_receive_message::prepare_mint`,
    typeArguments: [c.usdc],
    arguments: [r, tx.object(c.tmmState), tx.object(CLOCK)],
  });
  const [t] = tx.moveCall({
    target: `${c.handler}::handler::mint`,
    arguments: [tx.object(c.handlerState), mr, tx.object(c.tmmState), tx.object(c.treasury), tx.object(DENY_LIST)],
  });
  tx.moveCall({
    target: `${c.tmm}::handle_receive_message::complete_mint`,
    typeArguments: [c.usdc, `${c.handler}::handler::Auth`],
    arguments: [t, tx.object(c.tmmState), tx.object(c.mtState)],
  });
  return execute(o.wallet, o.owner, tx, o.network);
}

// USDC balance in base units via Sui GraphQL (public JSON-RPC is deprecated).
export async function suiUsdcBalance(network: Network, owner: string): Promise<bigint | null> {
  try {
    const r = await fetch(`https://graphql.${network}.sui.io/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "query($a: SuiAddress!, $t: String!) { address(address: $a) { balance(coinType: $t) { totalBalance } } }",
        variables: { a: owner, t: CFG[network].usdc },
      }),
    });
    const v = (await r.json()).data?.address?.balance?.totalBalance;
    return v != null ? BigInt(v) : 0n;
  } catch {
    return null;
  }
}

export const suiExplorer = (network: Network, digest: string) => `https://suiscan.xyz/${network}/tx/${digest}`;
