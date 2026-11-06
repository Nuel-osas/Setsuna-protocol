// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice The EIP-3009 call USDC and AUSD offer: a transfer the holder signed, which only `to` may execute.
interface IReceiveWithAuthorization {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

/// @notice The parts of a Curve stable-ng pool the sponsor uses.
interface ICurveStablePool {
    function coins(uint256 i) external view returns (address);
    function exchange(int128 i, int128 j, uint256 dx, uint256 minDy) external returns (uint256);
}

/// @notice Circle CCTP V2 TokenMessengerV2.
interface ITokenMessengerV2 {
    function depositForBurn(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold
    ) external;

    function depositForBurnWithHook(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold,
        bytes calldata hookData
    ) external;
}

/// @title SetsunaBridgeSponsor
/// @notice Bridges a holder's USDC or AUSD out of Monad through Circle CCTP V2 on a signature alone,
/// so whoever submits it pays the MON and the holder needs none. AUSD is first swapped to USDC on one
/// fixed Curve pool. With `forward`, Circle's Forwarding Service mints on the destination and takes
/// its fee from the USDC, so the recipient needs no gas there either.
/// @dev The holder signs the token's EIP-3009 ReceiveWithAuthorization naming this contract. Its
/// nonce is a hash of every bridge parameter (`authorizationNonce`), so changing the destination,
/// recipient, fee ceiling, finality, forwarding or swap minimum breaks the signature: a submitter
/// can carry out the transfer as signed or not at all. Only this contract can execute the
/// authorization, each nonce works once, and nothing is held between calls. No owner, admin or fee.
contract SetsunaBridgeSponsor {
    using SafeERC20 for IERC20;

    /// @notice Circle Forwarding Service hook data, version 0: "cctp-forward", version 0, length 0.
    bytes32 public constant FORWARD_HOOK = 0x636374702d666f72776172640000000000000000000000000000000000000000;
    /// @notice Least an AUSD swap may return, in basis points of the AUSD put in (99.8%), whatever was signed.
    uint256 public constant MIN_OUT_BPS = 9_980;
    /// @notice What the EIP-3009 nonce commits to, besides the owner, amount and validity window the
    /// token's own typed data already covers.
    bytes32 public constant BRIDGE_TYPEHASH = keccak256(
        "SetsunaBridge(address sponsor,uint256 chainId,address token,uint32 destinationDomain,bytes32 mintRecipient,uint256 maxFee,uint32 minFinalityThreshold,bool forward,uint256 minUsdcOut,bytes32 salt)"
    );

    struct Transfer {
        address owner;
        /// Amount of the token taken from the owner (USDC or AUSD, both 6 decimals).
        uint256 value;
        uint256 validAfter;
        uint256 validBefore;
        /// Any value that makes the nonce unique, so the same transfer can be signed again later.
        bytes32 salt;
        uint32 destinationDomain;
        bytes32 mintRecipient;
        /// Most Circle may keep, in USDC base units: the CCTP fee plus, with `forward`, the forwarding fee.
        uint256 maxFee;
        uint32 minFinalityThreshold;
        bool forward;
        /// AUSD only: least USDC the swap must return. Must be 0 for USDC.
        uint256 minUsdcOut;
    }

    IERC20 public immutable usdc;
    IERC20 public immutable ausd;
    ICurveStablePool public immutable pool;
    int128 public immutable ausdIndex;
    int128 public immutable usdcIndex;
    ITokenMessengerV2 public immutable tokenMessenger;

    event Bridged(
        address indexed owner,
        address indexed token,
        uint256 value,
        uint256 burned,
        uint32 indexed destinationDomain,
        bytes32 mintRecipient,
        uint256 maxFee,
        bool forward,
        address relayer
    );

    error InvalidConfiguration();
    error InvalidTransfer();

    constructor(
        IERC20 usdc_,
        IERC20 ausd_,
        ICurveStablePool pool_,
        int128 ausdIndex_,
        int128 usdcIndex_,
        ITokenMessengerV2 tokenMessenger_
    ) {
        if (
            address(usdc_).code.length == 0 || address(ausd_).code.length == 0
                || address(pool_).code.length == 0 || address(tokenMessenger_).code.length == 0
                || ausdIndex_ == usdcIndex_ || pool_.coins(uint256(uint128(ausdIndex_))) != address(ausd_)
                || pool_.coins(uint256(uint128(usdcIndex_))) != address(usdc_)
        ) {
            revert InvalidConfiguration();
        }
        usdc = usdc_;
        ausd = ausd_;
        pool = pool_;
        ausdIndex = ausdIndex_;
        usdcIndex = usdcIndex_;
        tokenMessenger = tokenMessenger_;
    }

    /// @notice The EIP-3009 nonce the owner signs for this transfer of `token`.
    function authorizationNonce(address token, Transfer calldata t) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                BRIDGE_TYPEHASH,
                address(this),
                block.chainid,
                token,
                t.destinationDomain,
                t.mintRecipient,
                t.maxFee,
                t.minFinalityThreshold,
                t.forward,
                t.minUsdcOut,
                t.salt
            )
        );
    }

    /// @notice Burn the owner's signed USDC for the destination, as signed.
    function bridgeUSDC(Transfer calldata t, uint8 v, bytes32 r, bytes32 s)
        external
        returns (uint256 burned)
    {
        if (t.minUsdcOut != 0) {
            revert InvalidTransfer();
        }
        _pull(usdc, t, v, r, s);
        burned = t.value;
        _burn(t, burned);
        emit Bridged(
            t.owner,
            address(usdc),
            t.value,
            burned,
            t.destinationDomain,
            t.mintRecipient,
            t.maxFee,
            t.forward,
            msg.sender
        );
    }

    /// @notice Swap the owner's signed AUSD to USDC on the fixed pool, then burn all of it as signed.
    function bridgeAUSD(Transfer calldata t, uint8 v, bytes32 r, bytes32 s)
        external
        returns (uint256 burned)
    {
        _pull(ausd, t, v, r, s);
        uint256 floor = (t.value * MIN_OUT_BPS) / 10_000;
        if (t.minUsdcOut > floor) {
            floor = t.minUsdcOut;
        }
        ausd.forceApprove(address(pool), t.value);
        burned = pool.exchange(ausdIndex, usdcIndex, t.value, floor);
        _burn(t, burned);
        emit Bridged(
            t.owner,
            address(ausd),
            t.value,
            burned,
            t.destinationDomain,
            t.mintRecipient,
            t.maxFee,
            t.forward,
            msg.sender
        );
    }

    function _pull(IERC20 token, Transfer calldata t, uint8 v, bytes32 r, bytes32 s) private {
        if (t.mintRecipient == bytes32(0)) {
            revert InvalidTransfer();
        }
        IReceiveWithAuthorization(address(token))
            .receiveWithAuthorization(
                t.owner,
                address(this),
                t.value,
                t.validAfter,
                t.validBefore,
                authorizationNonce(address(token), t),
                v,
                r,
                s
            );
    }

    /// @dev destinationCaller stays zero: the Forwarding Service does not work with one set.
    function _burn(Transfer calldata t, uint256 amount) private {
        usdc.forceApprove(address(tokenMessenger), amount);
        if (t.forward) {
            tokenMessenger.depositForBurnWithHook(
                amount,
                t.destinationDomain,
                t.mintRecipient,
                address(usdc),
                bytes32(0),
                t.maxFee,
                t.minFinalityThreshold,
                abi.encodePacked(FORWARD_HOOK)
            );
        } else {
            tokenMessenger.depositForBurn(
                amount,
                t.destinationDomain,
                t.mintRecipient,
                address(usdc),
                bytes32(0),
                t.maxFee,
                t.minFinalityThreshold
            );
        }
    }
}
