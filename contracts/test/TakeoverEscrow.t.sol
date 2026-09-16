// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {TakeoverEscrow} from "../src/TakeoverEscrow.sol";
import {MockUSDT} from "./mocks/MockUSDT.sol";
import {ReentrantToken} from "./mocks/ReentrantToken.sol";

/// @notice Behavioural tests for TakeoverEscrow against
///         docs/escrow-contract-interface.md. Mock USDT (6 decimals);
///         the signer is a plain address impersonated via vm.prank.
contract TakeoverEscrowTest is Test {
    TakeoverEscrow internal escrow;
    MockUSDT internal token;

    address internal buyer = makeAddr("buyer");
    address internal provider = makeAddr("provider");
    address internal signer = makeAddr("signer");
    address internal stranger = makeAddr("stranger");

    bytes32 internal constant ID_A = keccak256("escrow-a");
    uint256 internal constant AMOUNT = 1_500_000; // 1.50 USDT at 6 decimals
    uint256 internal constant BUYER_SUPPLY = 1_000_000_000_000; // 1M USDT

    uint256 internal _nonce;

    function setUp() public {
        token = new MockUSDT();
        escrow = new TakeoverEscrow(address(token), signer);
        token.mint(buyer, BUYER_SUPPLY);
    }

    function _approve(address who, uint256 amount) internal {
        vm.prank(who);
        token.approve(address(escrow), amount);
    }

    function _deposit(address who, bytes32 id, uint256 amount) internal {
        _approve(who, amount);
        vm.prank(who);
        escrow.deposit(id, amount);
    }

    /// @notice Fresh escrowId funded by the buyer. Isolation for terminal tests.
    function _fundFresh() internal returns (bytes32) {
        bytes32 id = keccak256(abi.encode("fresh", _nonce++));
        _deposit(buyer, id, AMOUNT);
        return id;
    }

    // ---- deposit ----

    function test_Deposit_HappyPath() public {
        _approve(buyer, AMOUNT);
        vm.expectEmit(true, true, false, true);
        emit TakeoverEscrow.Deposited(ID_A, buyer, AMOUNT);
        vm.prank(buyer);
        escrow.deposit(ID_A, AMOUNT);

        (address recordedBuyer, uint256 recordedAmount, bool funded, bool released, bool refunded, bool disputed) =
            escrow.escrows(ID_A);
        assertEq(recordedBuyer, buyer);
        assertEq(recordedAmount, AMOUNT);
        assertTrue(funded);
        assertFalse(released);
        assertFalse(refunded);
        assertFalse(disputed);
        assertEq(token.balanceOf(address(escrow)), AMOUNT);
        assertEq(token.balanceOf(buyer), BUYER_SUPPLY - AMOUNT);
    }

    function test_Deposit_ZeroAmountReverts() public {
        _approve(buyer, 0);
        vm.prank(buyer);
        vm.expectRevert(TakeoverEscrow.ZeroAmount.selector);
        escrow.deposit(ID_A, 0);
    }

    function test_Deposit_UnderApprovalReverts() public {
        _approve(buyer, AMOUNT - 1);
        vm.prank(buyer);
        vm.expectRevert(TakeoverEscrow.InexactApproval.selector);
        escrow.deposit(ID_A, AMOUNT);
    }

    function test_Deposit_OverApprovalReverts() public {
        // Infinite approval must never be requested; anything but the exact
        // amount reverts, even when the transfer itself would succeed.
        _approve(buyer, AMOUNT + 1);
        vm.prank(buyer);
        vm.expectRevert(TakeoverEscrow.InexactApproval.selector);
        escrow.deposit(ID_A, AMOUNT);
    }

    function test_Deposit_WithoutApprovalReverts() public {
        vm.prank(buyer);
        vm.expectRevert(TakeoverEscrow.InexactApproval.selector);
        escrow.deposit(ID_A, AMOUNT);
    }

    function test_Deposit_SecondDepositReverts() public {
        _deposit(buyer, ID_A, AMOUNT);
        _approve(buyer, AMOUNT);
        vm.prank(buyer);
        vm.expectRevert(TakeoverEscrow.EscrowAlreadyFunded.selector);
        escrow.deposit(ID_A, AMOUNT);
    }

    function test_Deposit_AlreadyFundedIdRevertsForStranger() public {
        _deposit(buyer, ID_A, AMOUNT);
        _approve(stranger, AMOUNT);
        // Stranger's tokens cannot hijack a funded id, even with approval.
        token.mint(stranger, AMOUNT);
        vm.prank(stranger);
        vm.expectRevert(TakeoverEscrow.EscrowAlreadyFunded.selector);
        escrow.deposit(ID_A, AMOUNT);
    }

    // ---- release ----

    function test_Release_HappyPath() public {
        bytes32 id = _fundFresh();
        uint256 providerBefore = token.balanceOf(provider);
        vm.expectEmit(true, true, false, true);
        emit TakeoverEscrow.Released(id, provider, AMOUNT);
        vm.prank(signer);
        escrow.release(id, provider);
        assertEq(token.balanceOf(provider) - providerBefore, AMOUNT);
        assertEq(token.balanceOf(address(escrow)), 0);
        (,,, bool released,,) = escrow.escrows(id);
        assertTrue(released);
    }

    function test_Release_NonSignerReverts() public {
        bytes32 id = _fundFresh();
        vm.prank(buyer);
        vm.expectRevert(TakeoverEscrow.NotSigner.selector);
        escrow.release(id, provider);
        vm.prank(stranger);
        vm.expectRevert(TakeoverEscrow.NotSigner.selector);
        escrow.release(id, provider);
    }

    function test_Release_BeforeDepositReverts() public {
        vm.prank(signer);
        vm.expectRevert(TakeoverEscrow.EscrowNotFunded.selector);
        escrow.release(ID_A, provider);
    }

    function test_Release_SecondReleaseReverts() public {
        bytes32 id = _fundFresh();
        vm.prank(signer);
        escrow.release(id, provider);
        vm.prank(signer);
        vm.expectRevert(TakeoverEscrow.AlreadyReleased.selector);
        escrow.release(id, provider);
    }

    function test_Release_ZeroProviderReverts() public {
        bytes32 id = _fundFresh();
        vm.prank(signer);
        vm.expectRevert(TakeoverEscrow.ZeroAddress.selector);
        escrow.release(id, address(0));
    }

    // ---- refund ----

    function test_Refund_HappyPath() public {
        bytes32 id = _fundFresh();
        uint256 buyerBefore = token.balanceOf(buyer);
        vm.expectEmit(true, true, false, true);
        emit TakeoverEscrow.Refunded(id, buyer, AMOUNT);
        vm.prank(signer);
        escrow.refund(id);
        assertEq(token.balanceOf(buyer) - buyerBefore, AMOUNT);
        assertEq(token.balanceOf(address(escrow)), 0);
        (,,,, bool refunded,) = escrow.escrows(id);
        assertTrue(refunded);
    }

    function test_Refund_NonSignerReverts() public {
        bytes32 id = _fundFresh();
        vm.prank(buyer);
        vm.expectRevert(TakeoverEscrow.NotSigner.selector);
        escrow.refund(id);
        vm.prank(provider);
        vm.expectRevert(TakeoverEscrow.NotSigner.selector);
        escrow.refund(id);
    }

    function test_Refund_BeforeDepositReverts() public {
        vm.prank(signer);
        vm.expectRevert(TakeoverEscrow.EscrowNotFunded.selector);
        escrow.refund(ID_A);
    }

    function test_Refund_SecondRefundReverts() public {
        bytes32 id = _fundFresh();
        vm.prank(signer);
        escrow.refund(id);
        vm.prank(signer);
        vm.expectRevert(TakeoverEscrow.AlreadyRefunded.selector);
        escrow.refund(id);
    }

    function test_Refund_AfterReleaseReverts() public {
        bytes32 id = _fundFresh();
        vm.prank(signer);
        escrow.release(id, provider);
        vm.prank(signer);
        vm.expectRevert(TakeoverEscrow.AlreadyReleased.selector);
        escrow.refund(id);
    }

    function test_Release_AfterRefundReverts() public {
        bytes32 id = _fundFresh();
        vm.prank(signer);
        escrow.refund(id);
        vm.prank(signer);
        vm.expectRevert(TakeoverEscrow.AlreadyRefunded.selector);
        escrow.release(id, provider);
    }

    // ---- dispute ----

    function test_Dispute_HappyPath() public {
        _deposit(buyer, ID_A, AMOUNT);
        vm.expectEmit(true, true, false, true);
        emit TakeoverEscrow.Disputed(ID_A, buyer);
        vm.prank(buyer);
        escrow.dispute(ID_A);
        (,,,,, bool disputed) = escrow.escrows(ID_A);
        assertTrue(disputed);
    }

    function test_Dispute_NonBuyerReverts() public {
        _deposit(buyer, ID_A, AMOUNT);
        vm.prank(stranger);
        vm.expectRevert(TakeoverEscrow.NotBuyer.selector);
        escrow.dispute(ID_A);
        vm.prank(signer);
        vm.expectRevert(TakeoverEscrow.NotBuyer.selector);
        escrow.dispute(ID_A);
    }

    function test_Dispute_BeforeDepositReverts() public {
        vm.prank(buyer);
        vm.expectRevert(TakeoverEscrow.EscrowNotFunded.selector);
        escrow.dispute(ID_A);
    }

    function test_Dispute_AfterReleaseReverts() public {
        bytes32 id = _fundFresh();
        vm.prank(signer);
        escrow.release(id, provider);
        vm.prank(buyer);
        vm.expectRevert(TakeoverEscrow.AlreadyReleased.selector);
        escrow.dispute(id);
    }

    function test_Dispute_AfterRefundReverts() public {
        bytes32 id = _fundFresh();
        vm.prank(signer);
        escrow.refund(id);
        vm.prank(buyer);
        vm.expectRevert(TakeoverEscrow.AlreadyRefunded.selector);
        escrow.dispute(id);
    }

    function test_Dispute_RepeatDisputeReverts() public {
        // Single Disputed event per escrow: the flag is recorded on-chain.
        _deposit(buyer, ID_A, AMOUNT);
        vm.prank(buyer);
        escrow.dispute(ID_A);
        vm.prank(buyer);
        vm.expectRevert(TakeoverEscrow.AlreadyDisputed.selector);
        escrow.dispute(ID_A);
    }

    // ---- access matrix ----

    function extDeposit(address caller, bytes32 id, uint256 amount) external returns (bool ok) {
        vm.startPrank(caller);
        token.approve(address(escrow), amount);
        try escrow.deposit(id, amount) {
            ok = true;
        } catch {
            ok = false;
        }
        vm.stopPrank();
    }

    function extRelease(address caller, bytes32 id, address to) external returns (bool ok) {
        vm.prank(caller);
        try escrow.release(id, to) {
            ok = true;
        } catch {
            ok = false;
        }
    }

    function extRefund(address caller, bytes32 id) external returns (bool ok) {
        vm.prank(caller);
        try escrow.refund(id) {
            ok = true;
        } catch {
            ok = false;
        }
    }

    function extDispute(address caller, bytes32 id) external returns (bool ok) {
        vm.prank(caller);
        try escrow.dispute(id) {
            ok = true;
        } catch {
            ok = false;
        }
    }

    function test_AccessMatrix() public {
        token.mint(provider, AMOUNT);
        token.mint(signer, AMOUNT);
        token.mint(stranger, AMOUNT);

        // deposit: any caller may fund a fresh id (they become its buyer).
        assertTrue(this.extDeposit(buyer, keccak256("m-dep-0"), AMOUNT));
        assertTrue(this.extDeposit(provider, keccak256("m-dep-1"), AMOUNT));
        assertTrue(this.extDeposit(signer, keccak256("m-dep-2"), AMOUNT));
        assertTrue(this.extDeposit(stranger, keccak256("m-dep-3"), AMOUNT));

        // release: signer only.
        assertTrue(this.extRelease(signer, _fundFresh(), provider));
        assertFalse(this.extRelease(buyer, _fundFresh(), provider));
        assertFalse(this.extRelease(provider, _fundFresh(), provider));
        assertFalse(this.extRelease(stranger, _fundFresh(), provider));

        // refund: signer only.
        assertTrue(this.extRefund(signer, _fundFresh()));
        assertFalse(this.extRefund(buyer, _fundFresh()));
        assertFalse(this.extRefund(provider, _fundFresh()));
        assertFalse(this.extRefund(stranger, _fundFresh()));

        // dispute: the on-chain buyer only (each attempt on a fresh escrow
        // funded by `buyer`, so only `buyer` succeeds).
        assertTrue(this.extDispute(buyer, _fundFresh()));
        assertFalse(this.extDispute(provider, _fundFresh()));
        assertFalse(this.extDispute(signer, _fundFresh()));
        assertFalse(this.extDispute(stranger, _fundFresh()));
    }

    // ---- fuzz ----

    function testFuzz_Deposit(uint96 rawAmount, bytes32 id) public {
        uint256 amount = bound(rawAmount, 1, BUYER_SUPPLY);
        _deposit(buyer, id, amount);
        (, uint256 recorded, bool funded,,,) = escrow.escrows(id);
        assertEq(recorded, amount);
        assertTrue(funded);
        assertEq(token.balanceOf(address(escrow)), amount);
    }

    function testFuzz_ReleaseTo(address to) public {
        vm.assume(to != address(0));
        vm.assume(to != address(escrow));
        vm.assume(to != address(token));
        bytes32 id = _fundFresh();
        uint256 toBefore = token.balanceOf(to);
        uint256 escrowBefore = token.balanceOf(address(escrow));
        vm.prank(signer);
        escrow.release(id, to);
        assertEq(token.balanceOf(to) - toBefore, AMOUNT);
        assertEq(token.balanceOf(address(escrow)), escrowBefore - AMOUNT);
    }

    // ---- reentrancy ----

    function test_Reentrancy_DepositReentryFailsClosed() public {
        ReentrantToken evil = new ReentrantToken();
        TakeoverEscrow evilEscrow = new TakeoverEscrow(address(evil), signer);
        bytes32 id = keccak256("evil-deposit");
        evil.mint(buyer, AMOUNT);
        evil.arm(address(evilEscrow), id, stranger);

        vm.startPrank(buyer);
        evil.approve(address(evilEscrow), AMOUNT);
        evilEscrow.deposit(id, AMOUNT);
        vm.stopPrank();

        // The reentrant deposit hit the guard; the outer deposit completed once.
        assertTrue(evil.entered());
        (address recordedBuyer, uint256 recordedAmount, bool funded,,,) = evilEscrow.escrows(id);
        assertEq(recordedBuyer, buyer);
        assertEq(recordedAmount, AMOUNT);
        assertTrue(funded);
        assertEq(evil.balanceOf(address(evilEscrow)), AMOUNT);
        assertEq(evil.balanceOf(buyer), 0);
    }

    function test_Reentrancy_ReleaseReentryCannotDoubleSpend() public {
        ReentrantToken evil = new ReentrantToken();
        TakeoverEscrow evilEscrow = new TakeoverEscrow(address(evil), signer);
        bytes32 id = keccak256("evil-release");
        evil.mint(buyer, AMOUNT);
        vm.startPrank(buyer);
        evil.approve(address(evilEscrow), AMOUNT);
        evilEscrow.deposit(id, AMOUNT);
        vm.stopPrank();

        evil.arm(address(evilEscrow), id, stranger);
        vm.prank(signer);
        evilEscrow.release(id, provider);

        // The reentrant release hit the guard; funds moved exactly once.
        assertTrue(evil.entered());
        assertEq(evil.balanceOf(provider), AMOUNT);
        assertEq(evil.balanceOf(address(evilEscrow)), 0);
        assertEq(evil.balanceOf(stranger), 0);
        vm.prank(signer);
        vm.expectRevert(TakeoverEscrow.AlreadyReleased.selector);
        evilEscrow.release(id, provider);
    }
}

/// @notice Stateful handler for the escrow-balance invariant. Every action is
///         guarded so reverts are the exception, not the norm
///         (fail_on_revert=false in foundry.toml all the same).
contract EscrowHandler is Test {
    TakeoverEscrow internal escrow;
    MockUSDT internal token;
    address internal escrowSigner;
    address[] internal actors;
    bytes32[] internal liveIds;
    uint256 internal nonce;

    uint256 public activeDeposits;

    uint256 internal constant MAX_DEPOSIT = 1_000_000 * 1e6; // 1M USDT

    constructor(TakeoverEscrow _escrow, MockUSDT _token, address _signer) {
        escrow = _escrow;
        token = _token;
        escrowSigner = _signer;
        actors.push(makeAddr("h-actor-0"));
        actors.push(makeAddr("h-actor-1"));
        actors.push(makeAddr("h-actor-2"));
    }

    function deposit(uint256 actorSeed, uint256 rawAmount) public {
        address actor = actors[actorSeed % actors.length];
        uint256 amount = bound(rawAmount, 1, MAX_DEPOSIT);
        bytes32 id = keccak256(abi.encode("inv", nonce++));
        token.mint(actor, amount);
        vm.startPrank(actor);
        token.approve(address(escrow), amount);
        try escrow.deposit(id, amount) {
            liveIds.push(id);
            activeDeposits += amount;
        } catch {}
        vm.stopPrank();
    }

    function release(uint256 idSeed, uint256 toSeed) public {
        if (liveIds.length == 0) return;
        bytes32 id = liveIds[idSeed % liveIds.length];
        address to = actors[toSeed % actors.length];
        (, uint256 amount,,,,) = escrow.escrows(id);
        vm.prank(escrowSigner);
        try escrow.release(id, to) {
            activeDeposits -= amount;
        } catch {}
    }

    function refund(uint256 idSeed) public {
        if (liveIds.length == 0) return;
        bytes32 id = liveIds[idSeed % liveIds.length];
        (, uint256 amount,,,,) = escrow.escrows(id);
        vm.prank(escrowSigner);
        try escrow.refund(id) {
            activeDeposits -= amount;
        } catch {}
    }

    function dispute(uint256 idSeed, uint256 actorSeed) public {
        if (liveIds.length == 0) return;
        bytes32 id = liveIds[idSeed % liveIds.length];
        vm.prank(actors[actorSeed % actors.length]);
        try escrow.dispute(id) {} catch {}
    }
}

/// @notice Invariant: the contract never holds more or less than the sum of
///         deposits that were never released or refunded.
contract TakeoverEscrowInvariant is Test {
    TakeoverEscrow internal escrow;
    MockUSDT internal token;
    EscrowHandler internal handler;

    function setUp() public {
        token = new MockUSDT();
        address signer = makeAddr("inv-signer");
        escrow = new TakeoverEscrow(address(token), signer);
        handler = new EscrowHandler(escrow, token, signer);
        targetContract(address(handler));
    }

    function invariant_EscrowBalanceMatchesActiveDeposits() public view {
        assertEq(token.balanceOf(address(escrow)), handler.activeDeposits());
    }
}
