import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const destination = new URL("contracts/abi/", root);
await mkdir(destination, { recursive: true });
for (const name of [
  "SetsunaAccount",
  "SetsunaFactory",
  "IPerplExchange",
  "SetsunaEarnVault",
  "SetsunaUSDCVault",
  "SetsunaUSDCV2Factory",
  "CurvanceUSDCAdapter",
  "EulerUSDCAdapter",
  "NeverlandUSDCAdapter",
  "SetsunaUSDCFactory",
  "AaveUSDCAdapter",
  "MorphoUSDCAdapter",
  "SetsunaMONVault",
  "SetsunaMONFactory",
  "SetsunaMONGateway",
  "NeverlandMONAdapter",
  "EulerMONAdapter",
  "SetsunaSpot",
  "SetsunaDemoFaucet",
]) {
  const artifact = JSON.parse(
    await readFile(
      new URL(`contracts/out/${name}.sol/${name}.json`, root),
      "utf8",
    ),
  );
  await writeFile(
    new URL(`${name}.json`, destination),
    JSON.stringify(artifact.abi, null, 2) + "\n",
  );
}
console.log(`Exported contract ABIs to ${fileURLToPath(destination)}`);
