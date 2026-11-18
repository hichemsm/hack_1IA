// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {CareVault} from "../src/CareVault.sol";
import {MockUSD} from "./mocks/MockUSD.sol";

contract CareVaultTest is Test {
    CareVault internal vault;
    MockUSD internal usd;

    address internal guardian = makeAddr("guardian");
    address internal txAgent = makeAddr("txAgent");
    address internal kinePayout = makeAddr("kine");
    address internal secSigner;
    uint256 internal secKey;

    bytes32 internal constant KINE = keccak256("kine-dupont");
    uint8 internal constant PARAMEDICAL = 2;
    uint256 internal constant TX_CAP = 200e6;
    uint256 internal constant DAILY_CAP = 300e6;
    uint256 internal constant THRESHOLD = 150e6;

    function setUp() public {
        (secSigner, secKey) = makeAddrAndKey("security");
        usd = new MockUSD();
        vault = new CareVault(IERC20(address(usd)), guardian, 48 hours);

        vm.startPrank(guardian);
        vault.setAgents(txAgent, secSigner, uint64(block.timestamp + 30 days));
        vault.setRule(PARAMEDICAL, uint128(TX_CAP), uint128(DAILY_CAP));
        vault.setApprovalThreshold(THRESHOLD);
        vault.addProvider(KINE, kinePayout, PARAMEDICAL, 1);
        usd.mint(guardian, 1_000e6);
        usd.approve(address(vault), type(uint256).max);
        vault.deposit(1_000e6);
        vm.stopPrank();

        vm.warp(block.timestamp + 48 hours + 1);
    }

    // ───────── helpers ─────────

    function _order(bytes32 invoice, uint256 amount) internal view returns (CareVault.PaymentOrder memory o) {
        o = CareVault.PaymentOrder({
            invoiceHash: invoice,
            providerId: KINE,
            category: PARAMEDICAL,
            amount: amount,
            breakdown: CareVault.Breakdown({secu: 8_680_000, mutuelle: 6_450_000, resteACharge: 1_000_000}),
            baremeHash: keccak256("2026-11"),
            deadline: block.timestamp + 15 minutes
        });
    }

    function _sign(CareVault.PaymentOrder memory o, uint256 key) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, vault.hashApproval(o));
        return abi.encodePacked(r, s, v);
    }

    function _pay(CareVault.PaymentOrder memory o) internal returns (bool executed, uint256 id) {
        bytes memory sig = _sign(o, secKey);
        vm.prank(txAgent);
        return vault.agentPay(o, sig);
    }

    // ───────── parcours normal ─────────

    function test_PaysKineWithBothAgents() public {
        (bool executed,) = _pay(_order(keccak256("K-1"), 16_130_000));
        assertTrue(executed);
        assertEq(usd.balanceOf(kinePayout), 16_130_000);
    }

    function test_QueuesAboveThreshold_ThenGuardianApproves() public {
        (bool executed, uint256 id) = _pay(_order(keccak256("K-big"), 180e6));
        assertFalse(executed);
        assertEq(usd.balanceOf(kinePayout), 0);

        vm.prank(guardian);
        vault.approve(id);
        assertEq(usd.balanceOf(kinePayout), 180e6);
    }

    function test_GuardianRejectsQueuedPayment() public {
        (, uint256 id) = _pay(_order(keccak256("K-big"), 180e6));
        vm.prank(guardian);
        vault.reject(id);
        vm.prank(guardian);
        vm.expectRevert(CareVault.NotPending.selector);
        vault.approve(id);
    }

    // ───────── double signature ─────────

    function test_RevertWhen_SecuritySignatureMissing() public {
        CareVault.PaymentOrder memory o = _order(keccak256("K-1"), 16_130_000);
        vm.prank(txAgent);
        vm.expectRevert(abi.encodeWithSelector(ECDSA.ECDSAInvalidSignatureLength.selector, uint256(0)));
        vault.agentPay(o, "");
    }

    function test_RevertWhen_SignedByWrongKey() public {
        (, uint256 attackerKey) = makeAddrAndKey("attacker");
        CareVault.PaymentOrder memory o = _order(keccak256("K-1"), 16_130_000);
        bytes memory sig = _sign(o, attackerKey);
        vm.prank(txAgent);
        vm.expectRevert(CareVault.BadSecuritySignature.selector);
        vault.agentPay(o, sig);
    }

    function test_RevertWhen_AmountTamperedAfterSignature() public {
        CareVault.PaymentOrder memory o = _order(keccak256("K-1"), 16_130_000);
        bytes memory sig = _sign(o, secKey);
        o.amount = 2_000e6;
        vm.prank(txAgent);
        vm.expectRevert(CareVault.BadSecuritySignature.selector);
        vault.agentPay(o, sig);
    }

    function test_RevertWhen_CallerIsNotTransactionAgent() public {
        CareVault.PaymentOrder memory o = _order(keccak256("K-1"), 16_130_000);
        bytes memory sig = _sign(o, secKey);
        vm.prank(makeAddr("intruder"));
        vm.expectRevert(CareVault.NotTransactionAgent.selector);
        vault.agentPay(o, sig);
    }

    function test_RevertWhen_SignatureExpired() public {
        CareVault.PaymentOrder memory o = _order(keccak256("K-1"), 16_130_000);
        bytes memory sig = _sign(o, secKey);
        vm.warp(block.timestamp + 16 minutes);
        vm.prank(txAgent);
        vm.expectRevert(CareVault.ApprovalExpired.selector);
        vault.agentPay(o, sig);
    }

    function test_RevertWhen_AgentsRevoked() public {
        vm.prank(guardian);
        vault.revokeAgents();
        CareVault.PaymentOrder memory o = _order(keccak256("K-1"), 16_130_000);
        bytes memory sig = _sign(o, secKey);
        vm.prank(txAgent);
        vm.expectRevert(CareVault.AgentsAreRevoked.selector);
        vault.agentPay(o, sig);
    }

    // ───────── soignants ─────────

    function test_RevertWhen_UnknownProvider() public {
        CareVault.PaymentOrder memory o = _order(keccak256("K-1"), 16_130_000);
        o.providerId = keccak256("faux-kine");
        bytes memory sig = _sign(o, secKey);
        vm.prank(txAgent);
        vm.expectRevert(CareVault.UnknownProvider.selector);
        vault.agentPay(o, sig);
    }

    function test_RevertWhen_ProviderAddedLessThan48hAgo() public {
        bytes32 nouveau = keccak256("kine-nouveau");
        vm.prank(guardian);
        vault.addProvider(nouveau, makeAddr("nouveau"), PARAMEDICAL, 1);
        uint64 activeAt = uint64(block.timestamp + 48 hours);

        CareVault.PaymentOrder memory o = _order(keccak256("K-1"), 16_130_000);
        o.providerId = nouveau;
        bytes memory sig = _sign(o, secKey);
        vm.prank(txAgent);
        vm.expectRevert(abi.encodeWithSelector(CareVault.ProviderNotYetActive.selector, activeAt));
        vault.agentPay(o, sig);
    }

    function test_ChangingPayoutRestartsDelay() public {
        vm.prank(guardian);
        vault.addProvider(KINE, makeAddr("nouveau-rib"), PARAMEDICAL, 1);
        CareVault.PaymentOrder memory o = _order(keccak256("K-1"), 16_130_000);
        bytes memory sig = _sign(o, secKey);
        vm.prank(txAgent);
        vm.expectRevert(abi.encodeWithSelector(CareVault.ProviderNotYetActive.selector, uint64(block.timestamp + 48 hours)));
        vault.agentPay(o, sig);
    }

    function test_RevertWhen_CategoryMismatch() public {
        CareVault.PaymentOrder memory o = _order(keccak256("K-1"), 16_130_000);
        o.category = 1;
        bytes memory sig = _sign(o, secKey);
        vm.prank(txAgent);
        vm.expectRevert(CareVault.CategoryMismatch.selector);
        vault.agentPay(o, sig);
    }

    // ───────── plafonds et doublons ─────────

    function test_RevertWhen_InvoicePaidTwice() public {
        _pay(_order(keccak256("K-1"), 16_130_000));
        CareVault.PaymentOrder memory o = _order(keccak256("K-1"), 16_130_000);
        bytes memory sig = _sign(o, secKey);
        vm.prank(txAgent);
        vm.expectRevert(CareVault.InvoiceAlreadyUsed.selector);
        vault.agentPay(o, sig);
    }

    function test_RevertWhen_AboveTxCap() public {
        CareVault.PaymentOrder memory o = _order(keccak256("K-1"), TX_CAP + 1);
        bytes memory sig = _sign(o, secKey);
        vm.prank(txAgent);
        vm.expectRevert(abi.encodeWithSelector(CareVault.AboveTxCap.selector, TX_CAP));
        vault.agentPay(o, sig);
    }

    function test_RevertWhen_AboveDailyCap() public {
        _pay(_order(keccak256("K-1"), 100e6));
        _pay(_order(keccak256("K-2"), 100e6));
        CareVault.PaymentOrder memory o = _order(keccak256("K-3"), 101e6);
        bytes memory sig = _sign(o, secKey);
        vm.prank(txAgent);
        vm.expectRevert(abi.encodeWithSelector(CareVault.AboveDailyCap.selector, DAILY_CAP));
        vault.agentPay(o, sig);
    }

    function test_DailyCapResetsNextDay() public {
        _pay(_order(keccak256("K-1"), 100e6));
        _pay(_order(keccak256("K-2"), 100e6));
        vm.warp(block.timestamp + 1 days);
        (bool executed,) = _pay(_order(keccak256("K-3"), 101e6));
        assertTrue(executed);
    }

    // ───────── fuzzing ─────────

    /// Quel que soit le montant, l'agent ne fait jamais sortir plus que le seuil sans l'aidante
    function testFuzz_AgentNeverPaysMoreThanThresholdAlone(uint256 amount) public {
        amount = bound(amount, 1, 1_000e6);
        CareVault.PaymentOrder memory o = _order(keccak256(abi.encode(amount)), amount);
        bytes memory sig = _sign(o, secKey);
        vm.prank(txAgent);
        if (amount > TX_CAP) {
            vm.expectRevert(abi.encodeWithSelector(CareVault.AboveTxCap.selector, TX_CAP));
        }
        vault.agentPay(o, sig);
        assertLe(usd.balanceOf(kinePayout), THRESHOLD);
    }

    /// Une même facture ne sort jamais deux fois, quel que soit son hash
    function testFuzz_NoDoublePayment(bytes32 invoice) public {
        _pay(_order(invoice, 10e6));
        CareVault.PaymentOrder memory o = _order(invoice, 10e6);
        bytes memory sig = _sign(o, secKey);
        vm.prank(txAgent);
        vm.expectRevert(CareVault.InvoiceAlreadyUsed.selector);
        vault.agentPay(o, sig);
        assertEq(usd.balanceOf(kinePayout), 10e6);
    }
}
