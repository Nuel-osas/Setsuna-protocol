import { decodeEventLog } from "viem";

export const statuses = [
  "Ready", "Inactive", "No position", "Position changed", "Outstanding orders", "Venue unavailable",
  "Invalid mark", "Stale mark", "Not triggered", "Below minimum", "Insufficient budget", "Reserve insolvent",
];

/** One serialized account check. Re-read and simulate each time; cached/indexed risk never authorizes spending. */
export class PendingReceiptError extends Error {
  constructor(hash) { super("Transaction submitted; receipt not confirmed. Reconcile before sending again."); this.name = "PendingReceiptError"; this.hash = hash; }
}

export async function checkAccount({ publicClient, walletClient, address, abi, execute, maxGasPrice, minFee = 0n, gasLimit = 1_000_000n }) {
  const quote = await publicClient.readContract({ address, abi, functionName: "previewTopUp" });
  const report = { account: address, policyId: quote.policyId, status: statuses[quote.status] ?? "Unknown", quote };
  if (quote.status !== 0 || !execute) return { ...report, action: "observed" };
  if (quote.feeCNS < minFee) return { ...report, action: "fee-below-minimum" };
  if (!walletClient?.account || maxGasPrice == null) throw new Error("Execution requires a signer and gas-price ceiling");

  const gasPrice = await publicClient.getGasPrice();
  if (gasPrice > maxGasPrice) return { ...report, action: "gas-above-ceiling", gasPrice };
  const { request, result } = await publicClient.simulateContract({
    account: walletClient.account, address, abi, functionName: "topUp", gasPrice, gas: gasLimit,
  });
  if (result !== 0) return { ...report, action: "refused-in-simulation", simulatedStatus: statuses[result] };
  const hash = await walletClient.writeContract(request);
  let receipt;
  try { receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 45_000 }); }
  catch { throw new PendingReceiptError(hash); }
  if (receipt.status !== "success") return { ...report, action: "reverted", hash, blockNumber: receipt.blockNumber };

  // A successful receipt can be a non-reverting refusal after a racing rescuer.
  const events = receipt.logs.filter((log) => log.address.toLowerCase() === address.toLowerCase()).flatMap((log) => {
    try { return [decodeEventLog({ abi, data: log.data, topics: log.topics })]; } catch { return []; }
  });
  const rescue = events.find((event) => event.eventName === "ToppedUp");
  const refusal = events.find((event) => event.eventName === "Refused");
  return {
    ...report, action: rescue ? "rescued" : refusal ? "refused-onchain" : "unconfirmed-outcome",
    hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed,
    ...(rescue ? { rescue: rescue.args } : {}), ...(refusal ? { refusal: refusal.args } : {}),
  };
}

export function json(value) { return JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item); }
