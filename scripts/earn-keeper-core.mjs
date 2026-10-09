import {
  decodeEventLog,
  encodeFunctionData,
  keccak256,
  parseUnits,
} from "viem";

export const MONAD_USDC = "0x754704bc059f8c67012fed69bc8a327a5aafb603";
export const MONAD_WMON = "0x3bd359c1119da7da1d913d1c4d2b7c461115433a";
export function assetPolicy(symbol = "USDC", minimum = "0.001") {
  if (!["USDC", "MON"].includes(symbol)) throw new Error("Choose USDC or MON");
  const decimals = symbol === "MON" ? 18 : 6;
  if (!new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`).test(minimum))
    throw new Error("Invalid asset-denominated gain");
  return {
    symbol,
    decimals,
    address: symbol === "MON" ? MONAD_WMON : MONAD_USDC,
    minimumGain: parseUnits(minimum, decimals),
  };
}
export const json = (value) =>
  JSON.stringify(value, (_, item) =>
    typeof item === "bigint" ? item.toString() : item,
  );

export class ReconciliationRequired extends Error {
  constructor(hash) {
    super(
      "A signed transaction has an unknown outcome; reconcile it before submitting again.",
    );
    this.name = "ReconciliationRequired";
    this.hash = hash;
  }
}

export function chooseAction({
  plan,
  latest,
  timestamp,
  observationInterval,
  minimumGain,
}) {
  // Rebalancing takes precedence, so a periodic executor cannot starve it by
  // repeatedly replacing the latest observation in the execution block.
  if (
    plan?.grossMovement > 0n &&
    (plan.repairsLimits ||
      plan.annualIncomeAfter >= plan.annualIncomeBefore + minimumGain)
  )
    return "rebalance";
  if (
    latest.timestamp === 0n ||
    timestamp >= latest.timestamp + observationInterval
  )
    return "observeRates";
  return null;
}

export async function inspectVault({
  client,
  address,
  abi,
  minimumGain = 0n,
  assetSymbol = "USDC",
}) {
  const expectedAsset = assetPolicy(assetSymbol).address;
  const block = await client.getBlock();
  const read = (functionName) =>
    client.readContract({
      address,
      abi,
      functionName,
      blockNumber: block.number,
    });
  const [
    initialized,
    asset,
    observations,
    observationInterval,
    contractMinimum,
  ] = await Promise.all([
    read("initialized"),
    read("asset"),
    read("observations"),
    read("OBSERVATION_INTERVAL"),
    read("MIN_ANNUAL_GAIN"),
  ]);
  if (!initialized || asset.toLowerCase() !== expectedAsset)
    throw new Error(`Not an initialized Monad ${assetSymbol} vault`);
  let plan;
  let blockedBy;
  try {
    plan = await read("previewRebalance");
  } catch (error) {
    const reverted = error.walk?.(
      (cause) => cause.name === "ContractFunctionRevertedError",
    );
    blockedBy = reverted?.data?.errorName;
    if (!["RatesNotReady", "RateChanged", "CooldownActive"].includes(blockedBy))
      throw error;
  }
  const [previous, latest] = observations;
  const action = chooseAction({
    plan,
    latest,
    timestamp: block.timestamp,
    observationInterval,
    minimumGain: minimumGain > contractMinimum ? minimumGain : contractMinimum,
  });
  return {
    vault: address,
    assetSymbol,
    blockNumber: block.number,
    timestamp: block.timestamp,
    previous,
    latest,
    plan,
    blockedBy,
    action,
  };
}

function receiptReport(receipt, pending, abi) {
  const expected =
    pending.action === "rebalance" ? "Rebalanced" : "RatesObserved";
  const event = receipt.logs
    .filter((log) => log.address.toLowerCase() === pending.vault.toLowerCase())
    .flatMap((log) => {
      try {
        return [decodeEventLog({ abi, data: log.data, topics: log.topics })];
      } catch {
        return [];
      }
    })
    .find((log) => log.eventName === expected);
  return {
    action:
      receipt.status !== "success"
        ? "reverted"
        : event
          ? "confirmed"
          : "unconfirmed-event",
    hash: pending.hash,
    operation: pending.action,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
    ...(event ? { event: event.args } : {}),
  };
}

/** Resolve earlier signed work before choosing another nonce or action. */
export async function reconcilePending({
  client,
  state,
  persist,
  abi,
  chainId,
  signer,
}) {
  if (!state?.pending) return null;
  const pending = state.pending;
  if (
    pending.chainId !== chainId ||
    pending.signer.toLowerCase() !== signer.toLowerCase()
  ) {
    throw new Error("Executor state belongs to a different chain or signer");
  }
  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: pending.hash });
  } catch {
    throw new ReconciliationRequired(pending.hash);
  }
  const report = receiptReport(receipt, pending, abi);
  if (report.action === "unconfirmed-event")
    throw new ReconciliationRequired(pending.hash);
  await persist({ pending: null, lastReceipt: report });
  return report;
}

/** Caller holds a signer lock. Sign locally, persist the hash, then broadcast. */
export async function executeAction({
  client,
  wallet,
  address,
  abi,
  action,
  chainId,
  maxGasPrice,
  maxGas = 1_000_000n,
  minimumGain = 0n,
  persist,
}) {
  if (!["rebalance", "observeRates"].includes(action))
    throw new Error("Unsupported action");
  if (!wallet?.account || maxGasPrice == null || maxGasPrice <= 0n)
    throw new Error("Missing execution bounds");
  const gasPrice = await client.getGasPrice();
  if (gasPrice > maxGasPrice) return { action: "gas-above-ceiling", gasPrice };
  const { result } = await client.simulateContract({
    account: wallet.account,
    address,
    abi,
    functionName: action,
    gasPrice,
    gas: maxGas,
  });
  if (
    action === "rebalance" &&
    !result.repairsLimits &&
    result.annualIncomeAfter < result.annualIncomeBefore + minimumGain
  ) {
    return { action: "gain-below-minimum" };
  }
  const data = encodeFunctionData({ abi, functionName: action });
  const estimate = await client.estimateGas({
    account: wallet.account,
    to: address,
    data,
    gasPrice,
  });
  const gas = (estimate * 120n + 99n) / 100n;
  if (gas > maxGas)
    return { action: "gas-limit-exceeded", estimatedGas: estimate };
  const nonce = await client.getTransactionCount({
    address: wallet.account.address,
    blockTag: "pending",
  });
  const raw = await wallet.signTransaction({
    account: wallet.account,
    chain: wallet.chain,
    chainId,
    to: address,
    data,
    value: 0n,
    type: "legacy",
    gasPrice,
    gas,
    nonce,
  });
  const hash = keccak256(raw);
  const pending = {
    hash,
    nonce,
    signer: wallet.account.address,
    chainId,
    vault: address,
    action,
  };
  // A crash after this durable write stops subsequent runs even if broadcast
  // failed or the RPC accepted the transaction but lost its response.
  await persist({ pending });
  let receipt;
  try {
    const sentHash = await client.sendRawTransaction({
      serializedTransaction: raw,
    });
    if (sentHash.toLowerCase() !== hash.toLowerCase())
      throw new Error("Unexpected transaction hash");
    receipt = await client.waitForTransactionReceipt({
      hash,
      confirmations: 1,
      timeout: 30_000,
    });
  } catch {
    throw new ReconciliationRequired(hash);
  }
  const report = receiptReport(receipt, pending, abi);
  if (report.action === "unconfirmed-event")
    throw new ReconciliationRequired(hash);
  await persist({ pending: null, lastReceipt: report });
  return report;
}
