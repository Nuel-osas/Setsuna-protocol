import {
  decodeEventLog,
  decodeFunctionResult,
  encodeFunctionData,
  keccak256,
  numberToHex,
  pad,
  parseAbi,
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

const BPS = 10_000n;
const YEAR_DAYS = 365n;

/**
 * Off-chain spend gate. The contract decides what a rebalance does; this
 * decides whether it is worth gas. Repairs that fix a real limit always pass.
 * A repair caused only by the idle buffer drifting below 10% by accrued
 * interest is dust and must pay for itself like any other move.
 */
export function worthGas({ plan, idle, unsafe, policy, cycleCost }) {
  if (!plan || plan.grossMovement === 0n)
    return { worth: false, reason: "no-movement" };
  const tolerance = (plan.nav * policy.repairToleranceBps) / BPS;
  const minIdle = (plan.nav * policy.bufferBps + BPS - 1n) / BPS;
  if (plan.repairsLimits && (unsafe || minIdle > idle + tolerance))
    return { worth: true, reason: "material-repair" };
  if (cycleCost === undefined)
    return { worth: false, reason: "price-unavailable" };
  const value =
    ((plan.annualIncomeAfter - plan.annualIncomeBefore) * policy.horizonDays) /
    YEAR_DAYS;
  return value >= policy.profitFactor * cycleCost
    ? { worth: true, reason: "gain-covers-gas", value, cycleCost }
    : { worth: false, reason: "gain-below-gas", value, cycleCost };
}

/** A venue holding more than dust that the contract would force out on safety grounds. */
export function unsafeVenue({ positions, nav, venues, limits, tolerance }) {
  const cap = (nav * limits.destinationCapBps) / BPS;
  return venues.some((v, i) => {
    const position = positions[i];
    if (position <= tolerance) return false;
    if (
      v.disabled ||
      v.rate === 0n ||
      v.rate > limits.maxApr ||
      v.capacity === 0n ||
      v.supply < limits.minimumMarketSupply
    )
      return true;
    if (position > cap + tolerance) return true;
    return (
      v.cash !== undefined &&
      position > (v.cash * limits.marketCashCapBps) / BPS + tolerance
    );
  });
}

// Verified against mainnet storage; checked at runtime before every override.
const OBSERVATION_LAYOUT = {
  multi: { lastRebalanceAt: 13n, previous: 14n, latest: 17n },
  pair: { lastRebalanceAt: 15n, previous: 16n, latest: 20n },
};
const slotHex = (value) => pad(numberToHex(value), { size: 32 });

/**
 * previewRebalance() as it would read after two fresh observations, through
 * an eth_call state override. Costs no gas, so the keeper only pays to
 * observe when a rebalance would follow.
 */
export async function previewWithFreshRates({
  client,
  address,
  abi,
  multi,
  block,
  rates,
}) {
  const layout = OBSERVATION_LAYOUT[multi ? "multi" : "pair"];
  const [, latest] = await client.readContract({
    address,
    abi,
    functionName: "observations",
    blockNumber: block.number,
  });
  const stored = await client.getStorageAt({
    address,
    slot: slotHex(layout.latest),
    blockNumber: block.number,
  });
  if (BigInt(stored ?? 0) !== latest.timestamp)
    throw new Error("Unexpected vault storage layout");
  const diff = [];
  const write = (slot, value) =>
    diff.push({ slot: slotHex(slot), value: slotHex(value) });
  const observation = (slot, timestamp, blockNumber) => {
    write(slot, timestamp);
    write(slot + 1n, blockNumber);
    if (multi) {
      write(slot + 2n, BigInt(rates.length));
      const start = BigInt(keccak256(slotHex(slot + 2n)));
      rates.forEach((rate, i) => write(start + BigInt(i), rate));
    } else rates.forEach((rate, i) => write(slot + 2n + BigInt(i), rate));
  };
  observation(layout.previous, block.timestamp - 400n, block.number - 2n);
  observation(layout.latest, block.timestamp - 60n, block.number - 1n);
  write(layout.lastRebalanceAt, 0n);
  try {
    const { data } = await client.call({
      to: address,
      data: encodeFunctionData({ abi, functionName: "previewRebalance" }),
      blockNumber: block.number,
      stateOverride: [{ address, stateDiff: diff }],
    });
    return decodeFunctionResult({
      abi,
      functionName: "previewRebalance",
      data,
    });
  } catch {
    return undefined;
  }
}

const ADAPTER_ABI = parseAbi([
  "function supplyApr(int256) view returns (uint256)",
  "function depositCapacity() view returns (uint256)",
  "function marketSupply() view returns (uint256)",
  "function marketLiquidity() view returns (uint256)",
]);
// Kuru MON/USDC order book: native MON base, USDC quote, 18-decimal prices.
export const KURU_MON_USDC = "0x065c9d28e428a0db40191a54d33d5b7c71a9c394";
const KURU_ABI = parseAbi([
  "function bestBidAsk() view returns (uint256, uint256)",
  "function getMarketParams() view returns (uint32,uint96,address,uint256,address,uint256,uint32,uint96,uint96,uint256,uint256)",
]);

/** USDC base units per MON at Kuru's best ask, or undefined when unreadable. */
export async function monPriceUsdc({ client, block }) {
  try {
    const read = (functionName) =>
      client.readContract({
        address: KURU_MON_USDC,
        abi: KURU_ABI,
        functionName,
        blockNumber: block.number,
      });
    const [params, [, ask]] = await Promise.all([
      read("getMarketParams"),
      read("bestBidAsk"),
    ]);
    if (
      params[2] !== "0x0000000000000000000000000000000000000000" ||
      params[4].toLowerCase() !== MONAD_USDC ||
      ask === 0n
    )
      return undefined;
    return ask / 10n ** 12n;
  } catch {
    return undefined;
  }
}

const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
]);

async function readVenues({ client, address, abi, multi, blockNumber }) {
  const read = (functionName, args) =>
    client.readContract({ address, abi, functionName, args, blockNumber });
  const count = multi ? await read("destinationCount") : 2n;
  const venues = [];
  for (let i = 0n; i < count; i++) {
    const adapter = await read("adapters", [i]);
    const call = (functionName, args) =>
      client
        .readContract({
          address: adapter,
          abi: ADAPTER_ABI,
          functionName,
          args,
          blockNumber,
        })
        .catch(() => 0n);
    const [disabled, rate, capacity, supply, cash] = await Promise.all([
      read("disabled", [i]),
      call("supplyApr", [0n]),
      call("depositCapacity"),
      call("marketSupply"),
      multi ? call("marketLiquidity") : undefined,
    ]);
    venues.push({ disabled, rate, capacity, supply, cash });
  }
  return venues;
}

/**
 * Everything the spend gate needs, read at one block. Gas is priced at the
 * caller's max gas (Monad bills the limit) and converted into the vault asset.
 */
async function gasContext({ client, address, abi, gate, block, asset }) {
  const multi = gate.multi;
  const read = (functionName) =>
    client.readContract({
      address,
      abi,
      functionName,
      blockNumber: block.number,
    });
  const [venues, idle, gasPrice, bufferBps, destinationCapBps, maxApr, min] =
    await Promise.all([
      readVenues({ client, address, abi, multi, blockNumber: block.number }),
      client.readContract({
        address: asset,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address],
        blockNumber: block.number,
      }),
      client.getGasPrice(),
      read("BUFFER_BPS"),
      read("DESTINATION_CAP_BPS"),
      read("MAX_APR"),
      read("minimumMarketSupply"),
    ]);
  const marketCashCapBps = multi ? await read("MARKET_CASH_CAP_BPS") : 0n;
  // MON vaults pay gas in their own asset; USDC vaults use Kuru's live ask.
  const price = multi ? await monPriceUsdc({ client, block }) : undefined;
  const toAsset = (wei) =>
    !multi ? wei : price ? (wei * price) / 10n ** 18n : undefined;
  return {
    multi,
    venues,
    idle,
    limits: {
      destinationCapBps,
      maxApr,
      minimumMarketSupply: min,
      marketCashCapBps,
    },
    policy: { ...gate, bufferBps },
    rebalanceCost: toAsset(gasPrice * gate.maxGas),
    // Two observations, then the rebalance itself.
    cycleCost: toAsset(gasPrice * gate.maxGas * 3n),
  };
}

export function gateDecision({ plan, context }) {
  const tolerance = plan
    ? (plan.nav * context.policy.repairToleranceBps) / BPS
    : 0n;
  const unsafe =
    !!plan &&
    unsafeVenue({
      positions: plan.positions,
      nav: plan.nav,
      venues: context.venues,
      limits: context.limits,
      tolerance,
    });
  return { unsafe };
}

export async function inspectVault({
  client,
  address,
  abi,
  minimumGain = 0n,
  assetSymbol = "USDC",
  gate,
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
  let action = chooseAction({
    plan,
    latest,
    timestamp: block.timestamp,
    observationInterval,
    minimumGain: minimumGain > contractMinimum ? minimumGain : contractMinimum,
  });
  let spend;
  if (gate && action) {
    const context = await gasContext({
      client,
      address,
      abi,
      gate,
      block,
      asset: expectedAsset,
    });
    // Without fresh observations, judge the plan they would unlock.
    const candidate =
      plan ??
      (blockedBy === "RatesNotReady"
        ? await previewWithFreshRates({
            client,
            address,
            abi,
            multi: context.multi,
            block,
            rates: context.venues.map((v) => (v.disabled ? 0n : v.rate)),
          })
        : undefined);
    const { unsafe } = gateDecision({ plan: candidate, context });
    spend = worthGas({
      plan: candidate,
      idle: context.idle,
      unsafe,
      policy: context.policy,
      cycleCost: plan ? context.rebalanceCost : context.cycleCost,
    });
    if (!spend.worth) action = null;
    else if (plan && action !== "rebalance") action = null;
    if (action === "rebalance")
      spend.accept = (simulated) =>
        worthGas({
          plan: simulated,
          idle: context.idle,
          unsafe: gateDecision({ plan: simulated, context }).unsafe,
          policy: context.policy,
          cycleCost: context.rebalanceCost,
        }).worth;
  }
  return {
    ...(spend ? { spend } : {}),
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
  accept,
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
  if (action === "rebalance" && accept && !accept(result))
    return { action: "gain-below-gas" };
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
