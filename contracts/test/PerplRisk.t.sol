// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IPerplExchange as E} from "../src/interfaces/IPerplExchange.sol";
import {PerplRisk} from "../src/PerplRisk.sol";

contract RiskHarness {
    function maintenance(E.PositionInfoV2 memory p, uint256 factor) external pure returns (uint256) {
        return PerplRisk.maintenance(p, 1, 5, factor);
    }
}

contract PerplRiskTest is Test {
    function testKnownNotionalAndMarginFactorUnits() public pure {
        E.PositionInfoV2 memory p;
        p.pricePNS = 1_000_000;
        p.lotLNS = 1_000;
        // $100,000 × 0.01 BTC = $1,000; at a 25x maintenance factor, $40.
        assertEq(PerplRisk.maintenance(p, 1, 5, 2500), 40_000_000);
        assertEq(PerplRisk.threshold(40_000_000, 2500), 50_000_000);
        assertEq(PerplRisk.threshold(40_000_000, 5000), 60_000_000);
    }

    function testLongAndShortResidueRepresentTheSameEffectiveEntry() public pure {
        E.PositionInfoV2 memory p;
        p.pricePNS = 1_000_001;
        p.lotLNS = 1_000;
        p.priceResiduePNSQ16 = 32_768;
        // Effective $100,000.05 entry: $40.000020 maintenance for 0.01 BTC.
        assertEq(PerplRisk.maintenance(p, 1, 5, 2500), 40_000_020);
        p.positionType = 1;
        p.pricePNS = 1_000_000;
        assertEq(PerplRisk.maintenance(p, 1, 5, 2500), 40_000_020);
    }

    function testSubCnsMaintenanceRoundsUp() public pure {
        E.PositionInfoV2 memory p;
        p.pricePNS = 1_000_001;
        p.lotLNS = 1_000;
        p.priceResiduePNSQ16 = 1;
        assertEq(PerplRisk.maintenance(p, 1, 5, 2500), 40_000_001);
    }

    function testInvalidVenueScalesAndResidueFailClosed() public {
        RiskHarness harness = new RiskHarness();
        E.PositionInfoV2 memory p;
        p.pricePNS = 1_000_000;
        p.lotLNS = 1_000;
        vm.expectRevert(PerplRisk.UnsupportedPosition.selector);
        harness.maintenance(p, 0);
        p.priceResiduePNSQ16 = 65_536;
        vm.expectRevert(PerplRisk.UnsupportedPosition.selector);
        harness.maintenance(p, 2500);
    }
}
