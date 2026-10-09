// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IPerplExchange} from "./interfaces/IPerplExchange.sol";

/// @notice Six-decimal CNS calculations for Perpl, including the V2 entry-price residue.
/// @dev See docs/CONTRACTS.md for the pinned SDK and the distinction between venue validity
///      and Setsuna's separately configured mark-age limit.
library PerplRisk {
    uint256 internal constant BPS = 10_000;
    uint256 internal constant Q16 = 65_536;
    error UnsupportedPosition();

    function maintenance(
        IPerplExchange.PositionInfoV2 memory p,
        uint256 priceDecimals,
        uint256 lotDecimals,
        uint256 factorHdths
    ) internal pure returns (uint256) {
        if (
            p.positionType > 1 || p.pricePNS == 0 || p.pricePNS > type(uint32).max || p.lotLNS == 0
                || p.lotLNS > type(uint40).max || p.priceResiduePNSQ16 >= Q16 || priceDecimals > 18
                || lotDecimals > 18 || factorHdths == 0 || factorHdths > type(uint16).max
        ) {
            revert UnsupportedPosition();
        }
        uint256 entryQ16 = p.pricePNS * Q16;
        if (p.priceResiduePNSQ16 != 0) {
            // LONG entry is stored rounded up; SHORT entry is stored rounded down.
            if (p.positionType == 0) {
                entryQ16 -= Q16;
            }
            entryQ16 += p.priceResiduePNSQ16;
        }
        // factorHdths=2500 means 25x, i.e. a 4% maintenance requirement.
        // Entry notional / factor, converted into six-decimal collateral units.
        uint256 denominator = Q16 * 10 ** (priceDecimals + lotDecimals) * factorHdths;
        return Math.mulDiv(entryQ16, p.lotLNS * 100 * 1e6, denominator, Math.Rounding.Ceil);
    }

    function equity(IPerplExchange.PositionInfoV2 memory p) internal pure returns (int256) {
        // pnlCNS is the aggregate; adding it as well would double-count PnL.
        return SafeCast.toInt256(p.depositCNS) + p.deltaPnlCNS + p.premiumPnlCNS;
    }

    function threshold(uint256 maintenanceCNS, uint256 bufferBps) internal pure returns (uint256) {
        return Math.mulDiv(maintenanceCNS, BPS + bufferBps, BPS, Math.Rounding.Ceil);
    }
}
