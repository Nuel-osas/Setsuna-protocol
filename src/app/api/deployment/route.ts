import { readFile } from "node:fs/promises";
import {
  createPublicClient,
  http,
  isAddress,
  parseAbi,
  type Address,
} from "viem";
import { NextResponse } from "next/server";
import type { Deployment } from "@/lib/setsuna/types";
import { validatedDemo } from "@/lib/setsuna/demo-server";
import { parseUSDCEarn, validateUSDCEarn } from "@/lib/setsuna/usdc-deployment";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const host = new URL(request.url).hostname;
  const localHost = ["localhost", "127.0.0.1", "[::1]"].includes(host);
  const preview: Deployment = {
    mode: "preview",
    chainId: 143,
    name: "Monad",
    rpc: "https://rpc.monad.xyz",
    collateral: "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a",
    exchange: "0x34B6552d57a35a1D042CcAe1951BD1C370112a6F",
    perpId: 1,
  };
  if (process.env.SETSUNA_DEMO_MANIFEST) {
    try {
      return NextResponse.json(
        await validatedDemo(new URL(request.url).origin),
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch {
      return NextResponse.json(
        { ...preview, status: "demo-unavailable" },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
  }
  if (["1", "5"].includes(process.env.SETSUNA_LOCAL_USDC ?? "") && localHost) {
    const withCurvance = process.env.SETSUNA_LOCAL_USDC === "5";
    try {
      const m = JSON.parse(
        await readFile(
          `${process.cwd()}/.local/${withCurvance ? "setsusdc-five" : "setsusdc"}/demo.json`,
          "utf8",
        ),
      );
      if (
        m.mode !== "LOCAL_USDC_FORK_ONLY" ||
        m.syntheticFunding !== true ||
        m.chainId !== 31337 ||
        !isAddress(m.owner)
      )
        throw new Error("Invalid USDC demo");
      const rpc = withCurvance
        ? "http://127.0.0.1:18613"
        : "http://127.0.0.1:18612";
      const client = createPublicClient({
        transport: http(rpc, { timeout: 8000, retryCount: 0 }),
      });
      if ((await client.getChainId()) !== 31337)
        throw new Error("Wrong demo chain");
      const earnUSDC = parseUSDCEarn(m.earnUSDC);
      if (
        (await client.getBlock({ blockNumber: BigInt(earnUSDC.forkBlock) }))
          .hash !== m.forkHash
      )
        throw new Error("Wrong source fork");
      await validateUSDCEarn(client, earnUSDC);
      return NextResponse.json(
        {
          ...preview,
          mode: "local",
          name: "Local Monad fork · test funds",
          chainId: 31337,
          rpc,
          owner: m.owner,
          earnUSDC,
        } satisfies Deployment,
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch {
      return NextResponse.json(
        { ...preview, status: "demo-unavailable" },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
  }
  const trading = process.env.SETSUNA_LOCAL_TRADING === "1";
  if ((process.env.SETSUNA_LOCAL_EARN === "1" || trading) && localHost) {
    try {
      const m = JSON.parse(
        await readFile(
          `${process.cwd()}/.local/${trading ? "trading" : "setsmon"}/demo.json`,
          "utf8",
        ),
      );
      if (
        m.chainId !== 31337 ||
        m.mode !== "LOCAL_FORK_ONLY" ||
        m.syntheticFunding !== true
      )
        throw new Error("Invalid Earn demo");
      for (const key of [
        "vault",
        "gateway",
        "asset",
        "owner",
        "neverland",
        "euler",
      ])
        if (!isAddress(m[key])) throw new Error("Invalid Earn address");
      if (
        m.asset.toLowerCase() !== "0x3bd359c1119da7da1d913d1c4d2b7c461115433a"
      )
        throw new Error("Wrong Earn asset");
      const rpc = trading ? "http://127.0.0.1:18608" : "http://127.0.0.1:18607";
      const client = createPublicClient({
        transport: http(rpc, { timeout: 2000, retryCount: 0 }),
      });
      const abi = parseAbi([
        "function vault() view returns(address)",
        "function asset() view returns(address)",
        "function initialized() view returns(bool)",
      ]);
      const [chainId, linkedVault, asset, initialized] = await Promise.all([
        client.getChainId(),
        client.readContract({ address: m.gateway, abi, functionName: "vault" }),
        client.readContract({ address: m.vault, abi, functionName: "asset" }),
        client.readContract({
          address: m.vault,
          abi,
          functionName: "initialized",
        }),
      ]);
      if (
        chainId !== 31337 ||
        !initialized ||
        linkedVault.toLowerCase() !== m.vault.toLowerCase() ||
        asset.toLowerCase() !== m.asset.toLowerCase()
      )
        throw new Error("Earn fork unavailable");
      let tradeConfig: Partial<Deployment> = {};
      if (trading) {
        for (const key of [
          "perplFactory",
          "spotGateway",
          "spotMarket",
          "usdc",
        ]) {
          if (!isAddress(m[key])) throw new Error("Invalid trading manifest");
        }
        if (
          m.spotMarket.toLowerCase() !==
            "0x065c9d28e428a0db40191a54d33d5b7c71a9c394" ||
          m.usdc.toLowerCase() !==
            "0x754704bc059f8c67012fed69bc8a327a5aafb603" ||
          m.perplFixture?.mode !== "FIXED_HISTORICAL_MARK" ||
          m.perplFixture?.oracleGuardDisabledOnFork !== true
        ) {
          throw new Error("Unreviewed trading market or fixture");
        }
        const tradeABI = parseAbi([
          "function exchange() view returns(address)",
          "function collateral() view returns(address)",
          "function perpId() view returns(uint256)",
          "function market() view returns(address)",
          "function usdc() view returns(address)",
        ]);
        const [venue, token, perp, spotMarket, usdc] = await Promise.all([
          client.readContract({
            address: m.perplFactory,
            abi: tradeABI,
            functionName: "exchange",
          }),
          client.readContract({
            address: m.perplFactory,
            abi: tradeABI,
            functionName: "collateral",
          }),
          client.readContract({
            address: m.perplFactory,
            abi: tradeABI,
            functionName: "perpId",
          }),
          client.readContract({
            address: m.spotGateway,
            abi: tradeABI,
            functionName: "market",
          }),
          client.readContract({
            address: m.spotGateway,
            abi: tradeABI,
            functionName: "usdc",
          }),
        ]);
        if (
          venue.toLowerCase() !== preview.exchange.toLowerCase() ||
          token.toLowerCase() !== preview.collateral.toLowerCase() ||
          perp !== BigInt(1) ||
          spotMarket.toLowerCase() !== m.spotMarket.toLowerCase() ||
          usdc.toLowerCase() !== m.usdc.toLowerCase()
        ) {
          throw new Error("Trading deployment mismatch");
        }
        tradeConfig = {
          factory: m.perplFactory,
          startBlock: m.startBlock,
          spot: {
            gateway: m.spotGateway,
            market: m.spotMarket,
            usdc: m.usdc,
            startBlock: m.startBlock,
          },
          perplFixture: {
            mode: "FIXED_HISTORICAL_MARK",
            markPNS: m.perplFixture.markPNS,
            oracleGuardDisabledOnFork: true,
          },
        };
      }
      return NextResponse.json(
        {
          ...preview,
          ...tradeConfig,
          mode: "local",
          name: "Local Monad fork",
          chainId: 31337,
          rpc,
          owner: m.owner,
          earnMON: {
            vault: m.vault,
            gateway: m.gateway,
            asset: m.asset,
            adapters: [m.neverland, m.euler],
            forkBlock: m.forkBlock,
            startBlock: m.startBlock,
          },
        } satisfies Deployment,
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch {
      /* An unavailable fork never advertises signing access. */
    }
    return NextResponse.json(preview, {
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (process.env.SETSUNA_LOCAL_DEMO === "1" && localHost) {
    try {
      const manifest = JSON.parse(
        await readFile(`${process.cwd()}/.local/demo.json`, "utf8"),
      );
      if (
        manifest.chainId !== 31337 ||
        manifest.mode !== "LOCAL_FORK_ONLY" ||
        manifest.syntheticFunding !== true
      )
        throw new Error("Invalid demo manifest");
      for (const key of [
        "account",
        "owner",
        "factory",
        "collateral",
        "exchange",
      ])
        if (!isAddress(manifest[key])) throw new Error("Invalid address");
      const rpc = "http://127.0.0.1:18549";
      const client = createPublicClient({
        transport: http(rpc, { timeout: 1500, retryCount: 0 }),
      });
      if (
        (await client.getChainId()) !== 31337 ||
        !(await client.getCode({ address: manifest.factory as Address }))
      )
        throw new Error("Demo unavailable");
      return NextResponse.json(
        {
          ...preview,
          mode: "local",
          name: "Local Monad fork",
          chainId: 31337,
          rpc,
          factory: manifest.factory,
          account: manifest.account,
          owner: manifest.owner,
          startBlock: String(manifest.forkBlock),
        } satisfies Deployment,
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch {
      /* Stopped or stale demo never advertises signing access. */
    }
  }
  return NextResponse.json(preview, {
    headers: { "Cache-Control": "no-store" },
  });
}
