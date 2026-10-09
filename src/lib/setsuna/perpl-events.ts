// Selected events from the pinned official Perpl SDK ABI.
// https://raw.githubusercontent.com/PerplFoundation/dex-sdk/01b9910761755b0a0d9c710c1ede62ab937daa7d/crates/sdk/abi/dex/Exchange.json
import { parseAbi } from "viem";
export const perplEvents = parseAbi([
  "event OrderRequest(uint256 perpId, uint256 accountId, uint256 orderDescId, uint256 orderId, uint8 orderType, uint256 pricePNS, uint256 lotLNS, uint256 expiryBlock, bool postOnly, bool fillOrKill, bool immediateOrCancel, uint256 maxMatches, uint256 leverageHdths, uint256 lastExecutionBlock, uint256 amountCNS, uint256 maxNegPnlCollatBPS, uint256 gasLeft)",
  "event OrderRequestV2(uint256 perpId, uint256 accountId, uint256 orderDescId, uint256 orderId, uint8 orderType, uint256 pricePNS, uint256 lotLNS, uint256 expiryBlock, bool postOnly, bool fillOrKill, bool immediateOrCancel, uint256 maxMatches, uint256 leverageHdths, uint256 lastExecutionBlock, uint256 amountCNS, uint256 maxNegPnlCollatBPS, uint256 gasLeft, bytes extension)",
  "event TakerOrderFilled(uint256 entryPricePNS, uint256 collatPricePNS, uint256 pnlPricePNS, uint256 lotLNS, uint256 feeCNS, int256 amountCNS, uint256 balanceCNS)",
  "event TakerOrderFilledV2(uint256 entryPricePNS, uint256 collatPricePNS, uint256 pnlPricePNS, uint256 lotLNS, uint256 feeCNS, int256 amountCNS, uint256 balanceCNS, uint256 builderId, uint256 builderFeeCNS)",
]);
