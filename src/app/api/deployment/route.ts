import { NextResponse } from "next/server";
import { mainnetDeployment } from "@/lib/setsuna/mainnet-deployment";

export const dynamic = "force-dynamic";

export async function GET() {
  const deployment = mainnetDeployment();
  return NextResponse.json(deployment, {
    headers: {
      "Cache-Control":
        deployment.mode === "mainnet"
          ? "public, max-age=0, s-maxage=60, stale-while-revalidate=300"
          : "no-store",
    },
  });
}
