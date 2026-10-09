// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SetsunaSpot, IKuruSpotMarket} from "../src/spot/SetsunaSpot.sol";

contract SpotToken is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}
contract SpotMarketMock is IKuruSpotMarket {
    SpotToken public token;
    bool public changed;
    bool public lie;
    constructor(SpotToken t) { token = t; }
    function setFault(bool config, bool delta) external { changed = config; lie = delta; }
    function getMarketParams() external view returns (uint32, uint96, address, uint256, address, uint256, uint32, uint96, uint96, uint256, uint256) {
        return (1e8, 1e10, changed ? address(1) : address(0), 18, address(token), 6, 100, 1, type(uint96).max, 0, 0);
    }
    function placeAndExecuteMarketSell(uint96, uint256, bool margin, bool fok) external payable returns (uint256) {
        require(!margin && fok);
        token.transfer(msg.sender, 1e6);
        return lie ? 2e6 : 1e6;
    }
    function placeAndExecuteMarketBuy(uint96 quote, uint256, bool margin, bool fok) external payable returns (uint256) {
        require(!margin && fok);
        token.transferFrom(msg.sender, address(this), uint256(quote) / 100);
        (bool ok,) = msg.sender.call{value: 1 ether}(""); require(ok);
        return lie ? 2 ether : 1 ether;
    }
}
contract SpotReceiver {
    SetsunaSpot spot;
    SpotToken token;
    bool rejecting;
    bool public reentered;
    constructor(SetsunaSpot s, SpotToken t, bool r) { spot = s; token = t; rejecting = r; }
    function buy() external { token.approve(address(spot), 1e6); spot.buyMON(1e6, 1, block.timestamp); }
    receive() external payable {
        require(!rejecting, "reject native");
        (reentered,) = address(spot).call(abi.encodeCall(spot.buyMON, (1e6, 1, block.timestamp)));
    }
}
contract SetsunaSpotTest is Test {
    SpotToken token;
    SpotMarketMock market;
    SetsunaSpot spot;
    function setUp() public {
        token = new SpotToken(); market = new SpotMarketMock(token); spot = new SetsunaSpot(market, token);
        token.mint(address(this), 10e6); token.mint(address(market), 100e6);
        token.approve(address(spot), 10e6);
        vm.deal(address(this), 10 ether); vm.deal(address(market), 10 ether);
    }
    receive() external payable {}
    function testSpotUnexpectedVenueDeltaRollsBackBothDirections() public {
        market.setFault(false, true);
        vm.expectRevert(SetsunaSpot.UnexpectedDelta.selector);
        spot.sellMON{value: 1 ether}(1, block.timestamp);
        vm.expectRevert(SetsunaSpot.UnexpectedDelta.selector);
        spot.buyMON(1e6, 1, block.timestamp);
        assertEq(token.balanceOf(address(this)), 10e6);
        assertEq(address(this).balance, 10 ether);
        assertEq(token.allowance(address(spot), address(market)), 0);
    }
    function testSpotChangedVenueConfigBlocksSwaps() public {
        market.setFault(true, false);
        vm.expectRevert(SetsunaSpot.InvalidMarket.selector);
        spot.sellMON{value: 1 ether}(1, block.timestamp);
        vm.expectRevert(SetsunaSpot.InvalidMarket.selector);
        spot.buyMON(1e6, 1, block.timestamp);
    }
    function testSpotRecipientCannotReenter() public {
        SpotReceiver receiver = new SpotReceiver(spot, token, false);
        token.mint(address(receiver), 2e6);
        receiver.buy();
        assertFalse(receiver.reentered());
        assertEq(address(receiver).balance, 1 ether);
        assertEq(token.balanceOf(address(receiver)), 1e6);
    }
    function testSpotRejectedNativePaymentRollsBackInput() public {
        SpotReceiver receiver = new SpotReceiver(spot, token, true);
        token.mint(address(receiver), 1e6);
        vm.expectRevert(SetsunaSpot.NativeTransferFailed.selector);
        receiver.buy();
        assertEq(token.balanceOf(address(receiver)), 1e6);
        assertEq(address(market).balance, 10 ether);
        assertEq(token.allowance(address(spot), address(market)), 0);
    }
    function testSpotExistingDonationsAreNeverPaidToNextCaller() public {
        vm.deal(address(spot), 5 ether); token.mint(address(spot), 5e6);
        spot.buyMON(1e6, 1, block.timestamp);
        spot.sellMON{value: 1 ether}(1, block.timestamp);
        assertEq(address(spot).balance, 5 ether);
        assertEq(token.balanceOf(address(spot)), 5e6);
    }
}
