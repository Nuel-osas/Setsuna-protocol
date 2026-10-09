import { formatUnits, parseUnits } from "viem";
export function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
export function ausd(value: bigint | undefined, digits = 2) {
  return value === undefined
    ? "—"
    : Number(formatUnits(value, 6)).toLocaleString("en-US", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
}
export function amount(value: string, decimals = 6) {
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`).test(value))
    throw new Error(
      `Enter a positive amount with at most ${decimals} decimal places.`,
    );
  const parsed = parseUnits(value, decimals);
  if (parsed <= BigInt(0)) throw new Error("Amount must be greater than zero.");
  return parsed;
}
export function message(error: unknown) {
  const e = error as {
    code?: number | string;
    name?: string;
    shortMessage?: string;
    message?: string;
  };
  if (e?.code === 4001 || /rejected|denied/i.test(e?.shortMessage ?? ""))
    return "Request cancelled. No action was completed.";
  if (e?.code === "PRF_UNAVAILABLE")
    return "This authenticator does not support passkey PRF. Try a compatible passkey provider or connect a browser wallet.";
  if (e?.code === "PASSKEY_OPERATION_FAILED")
    return "Passkey request was cancelled or unavailable. On this preview, open localhost (not 127.0.0.1) and use a compatible authenticator.";
  // Perpl's pinned Errors.abi.json: UnmatchedLotRemainsInFillOrKill(uint256,uint256,uint256).
  // https://github.com/PerplFoundation/dex-sdk/blob/01b9910761755b0a0d9c710c1ede62ab937daa7d/crates/sdk/abi/dex/Errors.abi.json
  if (
    /0x578f7fed|UnmatchedLotRemainsInFillOrKill/i.test(
      `${e?.shortMessage} ${e?.message}`,
    )
  )
    return "Order cannot fill completely at this limit. Try a different price or size.";
  return (
    e?.shortMessage ||
    e?.message ||
    "The request failed. Please try again."
  )
    .split("Request body:")[0]
    .replace(/[\u0000-\u001f]/g, " ")
    .slice(0, 280);
}
