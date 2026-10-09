import {
  decodeEventLog,
  parseAbi,
  type Address,
  type TransactionReceipt,
} from "viem";

export const demoFaucetAbi = parseAbi([
  "function DEMO_CHAIN_ID() view returns(uint256)",
  "function MON_AMOUNT() view returns(uint256)",
  "function TOKEN_AMOUNT() view returns(uint256)",
  "function MAX_CLAIMS() view returns(uint256)",
  "function COOLDOWN() view returns(uint256)",
  "function USDC() view returns(address)",
  "function AUSD() view returns(address)",
  "function dispatcher() view returns(address)",
  "function claims() view returns(uint256)",
  "function nextClaimAt(address) view returns(uint256)",
  "function claim(address)",
  "event DemoFundsClaimed(address indexed recipient, uint256 nextClaimAt)",
]);

export function confirmsDemoFunding(
  receipt: Pick<TransactionReceipt, "status" | "logs">,
  faucet: Address,
  recipient: Address,
) {
  return (
    receipt.status === "success" &&
    receipt.logs.some((log) => {
      if (log.address.toLowerCase() !== faucet.toLowerCase()) return false;
      try {
        const event = decodeEventLog({
          abi: demoFaucetAbi,
          data: log.data,
          topics: log.topics,
        });
        return (
          event.eventName === "DemoFundsClaimed" &&
          event.args.recipient.toLowerCase() === recipient.toLowerCase()
        );
      } catch {
        return false;
      }
    })
  );
}

export type FaucetStatus = {
  available: boolean;
  eligible: boolean;
  nextClaimAt: string;
  timestamp: string;
  remainingClaims: string;
  message?: string;
  hash?: `0x${string}`;
};
