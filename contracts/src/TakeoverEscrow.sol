// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title TakeoverEscrow — USDT escrow for the TAKEOVER marketplace (Polygon).
/// @notice Implements docs/escrow-contract-interface.md exactly: buyer funds
///         one escrowId once with an exact-amount approval; the backend signer
///         releases to a provider-supplied payout address or refunds the
///         on-chain buyer; the buyer can flag a funded escrow as disputed.
///         Immutable: no owner, no admin, no pause, no upgrade path.
/// @dev Custom errors (no revert strings). All state-changing functions are
///      nonpayable and reentrancy-guarded; state is written before any
///      external token transfer, and each transition emits exactly one event.
contract TakeoverEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice USDT token accepted for deposits. Set once at construction.
    IERC20 public immutable TOKEN;

    /// @notice Backend signer allowed to call release()/refund(). Set once.
    address public immutable ESCROW_SIGNER;

    struct Escrow {
        address buyer;
        uint256 amount;
        bool funded;
        bool released;
        bool refunded;
        bool disputed;
    }

    mapping(bytes32 => Escrow) public escrows;

    error ZeroAddress();
    error ZeroAmount();
    error InexactApproval();
    error EscrowAlreadyFunded();
    error EscrowNotFunded();
    error NotSigner();
    error NotBuyer();
    error AlreadyReleased();
    error AlreadyRefunded();
    error AlreadyDisputed();

    event Deposited(bytes32 indexed escrowId, address indexed buyer, uint256 amount);
    event Released(bytes32 indexed escrowId, address indexed provider, uint256 amount);
    event Refunded(bytes32 indexed escrowId, address indexed buyer, uint256 amount);
    event Disputed(bytes32 indexed escrowId, address indexed buyer);

    /// @param token USDT contract address (never hardcoded; testnet/mainnet flexibility).
    /// @param signer Backend server signer address (sole release()/refund() caller).
    constructor(address token, address signer) {
        if (token == address(0) || signer == address(0)) revert ZeroAddress();
        TOKEN = IERC20(token);
        ESCROW_SIGNER = signer;
    }

    /// @notice Fund one escrowId with an exact-amount approval already in place.
    /// @dev The exact-allowance check is an on-chain require per the interface
    ///      doc: infinite approval must never be requested, so anything other
    ///      than exactly `amount` reverts before any state changes.
    function deposit(bytes32 escrowId, uint256 amount) external nonReentrant {
        Escrow storage escrow = escrows[escrowId];
        if (escrow.funded) revert EscrowAlreadyFunded();
        if (amount == 0) revert ZeroAmount();
        if (TOKEN.allowance(msg.sender, address(this)) != amount) revert InexactApproval();
        escrow.buyer = msg.sender;
        escrow.amount = amount;
        escrow.funded = true;
        emit Deposited(escrowId, msg.sender, amount);
        TOKEN.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Release the full deposit to the signer-supplied provider address.
    /// @dev The zero-address guard is fail-closed safety, not in the doc's
    ///      require list: with no admin recovery path, a zero payout address
    ///      would lock funds permanently. Conforming callers are unaffected.
    function release(bytes32 escrowId, address toProvider) external nonReentrant {
        if (msg.sender != ESCROW_SIGNER) revert NotSigner();
        if (toProvider == address(0)) revert ZeroAddress();
        Escrow storage escrow = escrows[escrowId];
        if (!escrow.funded) revert EscrowNotFunded();
        if (escrow.released) revert AlreadyReleased();
        if (escrow.refunded) revert AlreadyRefunded();
        escrow.released = true;
        emit Released(escrowId, toProvider, escrow.amount);
        TOKEN.safeTransfer(toProvider, escrow.amount);
    }

    /// @notice Refund the full deposit to the on-chain buyer. Terminal.
    function refund(bytes32 escrowId) external nonReentrant {
        if (msg.sender != ESCROW_SIGNER) revert NotSigner();
        Escrow storage escrow = escrows[escrowId];
        if (!escrow.funded) revert EscrowNotFunded();
        if (escrow.released) revert AlreadyReleased();
        if (escrow.refunded) revert AlreadyRefunded();
        escrow.refunded = true;
        emit Refunded(escrowId, escrow.buyer, escrow.amount);
        TOKEN.safeTransfer(escrow.buyer, escrow.amount);
    }

    /// @notice Buyer flags a funded, unterminated escrow as disputed.
    /// @dev The disputed flag is recorded on-chain (single Disputed event per
    ///      escrow; a repeat dispute reverts) so the backend can observe it as
    ///      an event and resolve off-chain. Delivery windows and resolutions
    ///      stay backend-owned per the trust boundary.
    function dispute(bytes32 escrowId) external nonReentrant {
        Escrow storage escrow = escrows[escrowId];
        if (!escrow.funded) revert EscrowNotFunded();
        if (escrow.released) revert AlreadyReleased();
        if (escrow.refunded) revert AlreadyRefunded();
        if (msg.sender != escrow.buyer) revert NotBuyer();
        if (escrow.disputed) revert AlreadyDisputed();
        escrow.disputed = true;
        emit Disputed(escrowId, escrow.buyer);
    }
}
