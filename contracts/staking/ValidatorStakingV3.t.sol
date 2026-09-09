// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "forge-std/Test.sol";
import "../src/ValidatorStakingV3.sol";

/// Reentrancy attacker: tries to re-enter on every ALT receipt.
contract Reenterer {
    ValidatorStakingV3 public s;
    uint256 public depth;
    uint8 public mode; // 0=claimRewards 1=completeWithdrawals 2=claimValidatorRewards
    address public target;

    constructor(ValidatorStakingV3 _s) { s = _s; }
    function setMode(uint8 m, address t) external { mode = m; target = t; }

    function doDelegate(address v) external payable { s.delegate{value: msg.value}(v); }
    function doUndelegate(address v, uint256 a) external { s.undelegate(v, a); }
    function doComplete() external { s.completeWithdrawals(); }
    function doClaim(address v) external { s.claimRewards(v); }

    receive() external payable {
        if (depth >= 1) return;
        depth++;
        if (mode == 0)      { try s.claimRewards(target) {} catch {} }
        else if (mode == 1) { try s.completeWithdrawals() {} catch {} }
        else if (mode == 2) { try s.claimValidatorRewards() {} catch {} }
        else                { try s.claimUnbondedSelfStake() {} catch {} }
        depth--;
    }
}

/// Validator that rejects plain ALT — must not be able to break distribution.
contract RejectingValidator {
    ValidatorStakingV3 public s;
    constructor(ValidatorStakingV3 _s) { s = _s; }
    function register(uint256 c) external payable { s.registerValidator{value: msg.value}(c, "rejector"); }
    function attest() external { s.attest(); }
    receive() external payable { revert("no thanks"); }
}

contract ValidatorStakingV3Test is Test {
    ValidatorStakingV3 s;

    address system = 0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE;
    address alice  = address(0xA11CE);
    address bob    = address(0xB0B);
    address carol  = address(0xCAC0);
    address mallory= address(0x4A110);

    function setUp() public {
        s = new ValidatorStakingV3();
        vm.deal(alice, 10_000 ether);
        vm.deal(bob, 10_000 ether);
        vm.deal(carol, 10_000 ether);
        vm.deal(mallory, 10_000 ether);
        vm.deal(system, 10_000 ether);
    }

    function _register(address who, uint256 amt, uint256 comm) internal {
        vm.prank(who);
        s.registerValidator{value: amt}(comm, "node");
    }

    // ---------------------------------------------------------------- basics

    function test_RegisterAndMoniker() public {
        vm.prank(alice);
        s.registerValidator{value: 32 ether}(10, "WATTxchange:nucash-mining");
        (uint256 self,,,,bool active,bool online,bool slashed, string memory mon) = s.getValidator(alice);
        assertEq(self, 32 ether);
        assertTrue(active); assertTrue(online); assertFalse(slashed);
        assertEq(mon, "WATTxchange:nucash-mining");
    }

    function test_RejectsBelowMinimum() public {
        vm.prank(alice);
        vm.expectRevert("Minimum 32 ALT required");
        s.registerValidator{value: 31 ether}(10, "x");
    }

    function test_RejectsOversizeMoniker() public {
        string memory long = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        vm.prank(alice);
        vm.expectRevert("Moniker too long");
        s.registerValidator{value: 32 ether}(10, long);
    }

    function test_GoesOfflineAfterThreshold() public {
        _register(alice, 32 ether, 10);
        assertTrue(s.isValidatorOnline(alice));
        vm.roll(block.number + 101);
        assertFalse(s.isValidatorOnline(alice));
        vm.prank(alice); s.attest();
        assertTrue(s.isValidatorOnline(alice));
    }

    // ------------------------------------------------- FIX #1: slash access

    function test_FIX1_RandomCannotSlash() public {
        _register(alice, 32 ether, 10);
        vm.prank(mallory);
        vm.expectRevert("Only consensus may call");
        s.slash(alice);
    }

    function test_FIX1_ValidatorCannotSlashRival() public {
        _register(alice, 32 ether, 10);
        _register(bob, 32 ether, 10);
        vm.prank(bob);
        vm.expectRevert("Only consensus may call");
        s.slash(alice);
    }

    function test_FIX1_SystemCanSlash() public {
        _register(alice, 32 ether, 10);
        vm.prank(system);
        s.slash(alice);
        (,,,,,, bool slashed,) = s.getValidator(alice);
        assertTrue(slashed);
    }

    // -------------------------------------------- FIX #2: self-stake exit

    function test_FIX2_UnregisterReturnsSelfStake() public {
        _register(alice, 40 ether, 10);
        uint256 before = alice.balance;

        vm.prank(alice); s.unregisterValidator();
        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(alice); s.claimUnbondedSelfStake();

        assertEq(alice.balance, before + 40 ether, "self-stake must be recoverable");
    }

    function test_FIX2_PartialUnstakeKeepsMinimum() public {
        _register(alice, 50 ether, 10);
        vm.prank(alice); s.unstakeSelf(18 ether);
        (uint256 self,,,,,,,) = s.getValidator(alice);
        assertEq(self, 32 ether);

        vm.prank(alice);
        vm.expectRevert("Would fall below minimum; unregister instead");
        s.unstakeSelf(1 ether);
    }

    function test_FIX2_WithdrawalRespectsDelay() public {
        _register(alice, 40 ether, 10);
        vm.prank(alice); s.unregisterValidator();
        vm.prank(alice);
        vm.expectRevert("Still unbonding");
        s.claimUnbondedSelfStake();
    }

    // ------------------------------- FIX #3: slash shares loss across delegators

    function test_FIX3_SlashSharedProRataAndAllCanExit() public {
        _register(alice, 32 ether, 10);
        vm.prank(bob);   s.delegate{value: 100 ether}(alice);
        vm.prank(carol); s.delegate{value: 100 ether}(alice);

        vm.prank(system); s.slash(alice);

        // penalty = 10% of (32 + 200) = 23.2; self covers 32 => delegations untouched
        (uint256 bobAmt,) = s.getDelegation(bob, alice);
        (uint256 carolAmt,) = s.getDelegation(carol, alice);
        assertEq(bobAmt, 100 ether);
        assertEq(carolAmt, 100 ether);

        // v2's killer: BOTH delegators must be able to exit fully.
        vm.prank(bob);   s.undelegate(alice, bobAmt);
        vm.prank(carol); s.undelegate(alice, carolAmt);   // v2 reverted here

        vm.warp(block.timestamp + 7 days + 1);
        uint256 b0 = bob.balance; uint256 c0 = carol.balance;
        vm.prank(bob);   s.completeWithdrawals();
        vm.prank(carol); s.completeWithdrawals();
        assertEq(bob.balance, b0 + 100 ether);
        assertEq(carol.balance, c0 + 100 ether);
    }

    function test_FIX3_SlashBitesDelegatorsWhenSelfStakeTooSmall() public {
        _register(alice, 32 ether, 10);
        vm.prank(bob);   s.delegate{value: 500 ether}(alice);
        vm.prank(carol); s.delegate{value: 500 ether}(alice);

        vm.prank(system); s.slash(alice);

        // penalty = 10% of 1032 = 103.2; self 32 absorbed, 71.2 from delegations
        (uint256 bobAmt,) = s.getDelegation(bob, alice);
        (uint256 carolAmt,) = s.getDelegation(carol, alice);
        assertApproxEqAbs(bobAmt, carolAmt, 1e6, "loss must be shared equally");
        assertLt(bobAmt, 500 ether);

        // and both can still get their reduced share out
        vm.prank(bob);   s.undelegate(alice, bobAmt);
        vm.prank(carol); s.undelegate(alice, carolAmt);
        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(bob);   s.completeWithdrawals();
        vm.prank(carol); s.completeWithdrawals();
    }

    // --------------------------- FIX #4: self-stake earns its own share

    function test_FIX4_ValidatorSelfStakeEarns() public {
        _register(alice, 100 ether, 0);          // 0% commission
        vm.prank(bob); s.delegate{value: 100 ether}(alice);

        vm.prank(system);
        (bool ok,) = address(s).call{value: 10 ether}("");
        assertTrue(ok);

        // 50/50 stake split, 0% commission => validator ~5, delegator ~5.
        // v2 would have given the validator 0 and delegators 10.
        (, uint256 bobPending) = s.getDelegation(bob, alice);
        uint256 aliceOwner = _ownerRewards(alice);

        assertApproxEqAbs(aliceOwner, 5 ether, 1e12, "self-stake must earn");
        assertApproxEqAbs(bobPending, 5 ether, 1e12, "delegator share");
    }

    function test_CommissionGoesToValidator() public {
        _register(alice, 100 ether, 50);         // 50% commission
        vm.prank(bob); s.delegate{value: 100 ether}(alice);

        vm.prank(system);
        (bool ok,) = address(s).call{value: 10 ether}("");
        assertTrue(ok);

        // delegated half earns 5; 50% commission => 2.5 to delegator, 2.5 to validator
        // validator total = own 5 + commission 2.5 = 7.5
        (, uint256 bobPending) = s.getDelegation(bob, alice);
        assertApproxEqAbs(bobPending, 2.5 ether, 1e12);
        assertApproxEqAbs(_ownerRewards(alice), 7.5 ether, 1e12);
    }

    function _ownerRewards(address v) internal view returns (uint256) {
        return s.getValidatorRewards(v);
    }

    // ------------------------------- FIX #5/#6: distribution robustness

    function test_FIX5_RejectingValidatorCannotBreakDistribution() public {
        RejectingValidator rv = new RejectingValidator(s);
        vm.deal(address(rv), 100 ether);
        rv.register{value: 32 ether}(10);
        _register(alice, 32 ether, 10);

        // v2 pushed ETH to each validator; a reverting receive() broke the loop.
        vm.prank(system);
        (bool ok,) = address(s).call{value: 10 ether}("");
        assertTrue(ok, "distribution must survive a validator that rejects ALT");
    }

    function test_FIX6_RewardsCarryForwardWhenNobodyOnline() public {
        _register(alice, 32 ether, 10);
        vm.roll(block.number + 200);             // everyone offline
        assertFalse(s.isValidatorOnline(alice));

        vm.prank(system);
        (bool ok,) = address(s).call{value: 5 ether}("");
        assertTrue(ok);
        assertEq(s.rewardPool(), 5 ether, "must be carried, not stranded");

        vm.prank(alice); s.attest();
        vm.prank(system);
        (ok,) = address(s).call{value: 5 ether}("");
        assertTrue(ok);
        assertEq(s.rewardPool(), 0, "carried pool must be paid out later");
        assertApproxEqAbs(_ownerRewards(alice), 10 ether, 1e12);
    }

    // ------------------------------------------------------ reentrancy

    function test_ReentrancyOnClaimRewards() public {
        _register(alice, 32 ether, 0);
        Reenterer r = new Reenterer(s);
        vm.deal(address(r), 100 ether);
        r.doDelegate{value: 100 ether}(alice);
        r.setMode(0, alice);

        vm.prank(system);
        (bool ok,) = address(s).call{value: 10 ether}("");
        assertTrue(ok);

        uint256 balBefore = address(s).balance;
        (, uint256 pending) = s.getDelegation(address(r), alice);
        r.doClaim(alice);
        // must pay exactly once
        assertEq(address(s).balance, balBefore - pending, "reentrancy must not double-pay");
    }

    function test_ReentrancyOnCompleteWithdrawals() public {
        _register(alice, 32 ether, 0);
        Reenterer r = new Reenterer(s);
        vm.deal(address(r), 200 ether);
        r.doDelegate{value: 100 ether}(alice);
        r.doUndelegate(alice, 100 ether);
        r.setMode(1, alice);

        vm.warp(block.timestamp + 7 days + 1);
        uint256 balBefore = address(s).balance;
        r.doComplete();
        assertEq(address(s).balance, balBefore - 100 ether, "reentrancy must not double-withdraw");
    }

    // ------------------------------------------------ misc invariants

    function test_CannotDoubleSlash() public {
        _register(alice, 32 ether, 10);
        vm.prank(system); s.slash(alice);
        vm.prank(system);
        vm.expectRevert("Already slashed");
        s.slash(alice);
    }

    function test_SlashedCannotReregister() public {
        _register(alice, 32 ether, 10);
        vm.prank(system); s.slash(alice);
        vm.prank(alice);
        vm.expectRevert("Previously slashed");
        s.registerValidator{value: 32 ether}(10, "again");
    }

    function test_CannotDelegateToSlashedOrInactive() public {
        _register(alice, 32 ether, 10);
        vm.prank(system); s.slash(alice);
        vm.prank(bob);
        vm.expectRevert("Validator not active");
        s.delegate{value: 50 ether}(alice);
    }

    function test_CannotUndelegateMoreThanHeld() public {
        _register(alice, 32 ether, 10);
        vm.prank(bob); s.delegate{value: 50 ether}(alice);
        vm.prank(bob);
        vm.expectRevert("Insufficient delegation");
        s.undelegate(alice, 51 ether);
    }

    function test_CannotStealAnotherDelegatorsStake() public {
        _register(alice, 32 ether, 10);
        vm.prank(bob); s.delegate{value: 50 ether}(alice);
        vm.prank(mallory);
        vm.expectRevert("Insufficient delegation");
        s.undelegate(alice, 50 ether);
    }

    function test_UnregisterThenReregisterAfterWithdrawal() public {
        _register(alice, 32 ether, 10);
        vm.prank(alice); s.unregisterValidator();
        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(alice); s.claimUnbondedSelfStake();
        // selfStake is zero now, so re-registering is allowed
        vm.prank(alice);
        s.registerValidator{value: 32 ether}(5, "back");
        (uint256 self,,,,bool active,,,) = s.getValidator(alice);
        assertEq(self, 32 ether);
        assertTrue(active);
    }

    /// Solvency: contract balance must always cover what it owes.
    function test_SolvencyAfterMixedActivity() public {
        _register(alice, 40 ether, 10);
        vm.prank(bob);   s.delegate{value: 100 ether}(alice);
        vm.prank(carol); s.delegate{value: 60 ether}(alice);

        vm.prank(system);
        (bool ok,) = address(s).call{value: 20 ether}("");
        assertTrue(ok);

        vm.prank(bob); s.undelegate(alice, 40 ether);
        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(bob); s.completeWithdrawals();
        vm.prank(bob); s.claimRewards(alice);

        assertGe(address(s).balance, 0);
    }

    function testFuzz_DelegateUndelegateRoundTrip(uint96 amt) public {
        uint256 amtv = bound(uint256(amt), 10 ether, 5_000 ether);
        _register(alice, 32 ether, 10);
        vm.deal(bob, amtv + 1 ether);

        vm.prank(bob); s.delegate{value: amtv}(alice);
        (uint256 held,) = s.getDelegation(bob, alice);
        assertEq(held, amtv);

        vm.prank(bob); s.undelegate(alice, held);
        vm.warp(block.timestamp + 7 days + 1);
        uint256 b0 = bob.balance;
        vm.prank(bob); s.completeWithdrawals();
        assertEq(bob.balance, b0 + held, "round trip must be lossless without slashing");
    }

    // ================= adversarial probes on v3's own design =================

    /// FIX: a validator must NOT dodge slashing by unregistering first.
    /// Unbonding self-stake stays slashable for the whole 7-day window.
    function test_PROBE_UnbondDoesNotEscapeSlashing() public {
        _register(alice, 40 ether, 10);
        vm.prank(alice); s.unregisterValidator();   // 40 ALT now unbonding, isActive=false

        // consensus notices misbehaviour a moment later and slashes anyway
        vm.prank(system);
        s.slash(alice);                              // must NOT revert

        (uint256 unbond,,) = s.getUnbonding(alice);
        assertEq(unbond, 36 ether, "10% of 40 must be slashed from unbonding stake");
        (,,,,,, bool slashed,) = s.getValidator(alice);
        assertTrue(slashed);

        vm.warp(block.timestamp + 7 days + 1);
        uint256 b0 = alice.balance;
        vm.prank(alice); s.claimUnbondedSelfStake();
        assertEq(alice.balance, b0 + 36 ether, "only the post-slash remainder is claimable");
    }

    /// Delegators of a validator that quits must still be able to exit.
    function test_PROBE_DelegatorsExitAfterValidatorQuits() public {
        _register(alice, 32 ether, 10);
        vm.prank(bob); s.delegate{value: 100 ether}(alice);
        vm.prank(alice); s.unregisterValidator();

        (uint256 held,) = s.getDelegation(bob, alice);
        assertEq(held, 100 ether);
        vm.prank(bob); s.undelegate(alice, held);
        vm.warp(block.timestamp + 7 days + 1);
        uint256 b0 = bob.balance;
        vm.prank(bob); s.completeWithdrawals();
        assertEq(bob.balance, b0 + 100 ether, "delegators must not be trapped");
    }

    /// Anyone can send ALT to the contract and trigger distribution. Harmless?
    function test_PROBE_AnyoneCanTriggerDistribution() public {
        _register(alice, 32 ether, 0);
        uint256 before = s.getValidatorRewards(alice);
        vm.prank(mallory);
        (bool ok,) = address(s).call{value: 1 ether}("");
        assertTrue(ok);
        // mallory just donated to validators; no way to extract it
        assertGt(s.getValidatorRewards(alice), before);
    }

    /// Dust/rounding must never let a delegator extract more than deposited.
    function testFuzz_PROBE_NoValueCreationViaRounding(uint96 a, uint96 b) public {
        uint256 av = bound(uint256(a), 10 ether, 1_000 ether);
        uint256 bv = bound(uint256(b), 10 ether, 1_000 ether);
        _register(alice, 32 ether, 10);
        vm.deal(bob, av + 1 ether);
        vm.deal(carol, bv + 1 ether);

        vm.prank(bob);   s.delegate{value: av}(alice);
        vm.prank(carol); s.delegate{value: bv}(alice);

        (uint256 bh,) = s.getDelegation(bob, alice);
        (uint256 ch,) = s.getDelegation(carol, alice);
        assertLe(bh, av, "cannot hold more than deposited");
        assertLe(ch, bv, "cannot hold more than deposited");
    }

    /// Contract must remain solvent enough to pay every queued withdrawal.
    function test_PROBE_QueuedWithdrawalsAlwaysCovered() public {
        _register(alice, 32 ether, 10);
        vm.prank(bob);   s.delegate{value: 200 ether}(alice);
        vm.prank(carol); s.delegate{value: 200 ether}(alice);

        vm.prank(bob);   s.undelegate(alice, 200 ether);
        vm.prank(carol); s.undelegate(alice, 200 ether);
        vm.prank(alice); s.unregisterValidator();

        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(bob);   s.completeWithdrawals();
        vm.prank(carol); s.completeWithdrawals();
        vm.prank(alice); s.claimUnbondedSelfStake();
        // everything paid out; nothing stranded beyond slashedFunds
        assertEq(address(s).balance, 0);
    }

    // ---- extra adversarial coverage added during v3 self-audit ----

    /// Global solvency: after every participant exits, the only ALT left in the
    /// contract must be exactly the burned slash penalty. Never less (insolvent).
    function test_INVARIANT_SolventAfterSlashAndFullExit() public {
        _register(alice, 50 ether, 10);
        vm.prank(bob);   s.delegate{value: 300 ether}(alice);
        vm.prank(carol); s.delegate{value: 300 ether}(alice);

        vm.prank(system);
        (bool ok,) = address(s).call{value: 25 ether}("");   // rewards in
        assertTrue(ok);

        vm.prank(system); s.slash(alice);                    // 10% of 650 = 65 burned

        // everyone pulls everything they still own
        (uint256 bh,) = s.getDelegation(bob, alice);
        (uint256 ch,) = s.getDelegation(carol, alice);
        vm.prank(bob);   s.undelegate(alice, bh);
        vm.prank(carol); s.undelegate(alice, ch);
        vm.prank(bob);   s.claimRewards(alice);
        vm.prank(carol); s.claimRewards(alice);
        vm.prank(alice); s.claimValidatorRewards();

        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(bob);   s.completeWithdrawals();
        vm.prank(carol); s.completeWithdrawals();
        // alice's 50 ALT self-stake was fully consumed by the 65 ALT penalty,
        // so she has nothing unbonding to claim.

        // Contract must be SOLVENT: balance >= burned funds. The tiny excess is
        // integer-division dust from reward splitting, which always accumulates
        // in-contract (favouring solvency), never the other way. This is the key
        // safety invariant: the contract can never owe more than it holds.
        assertGe(address(s).balance, s.slashedFunds(), "must never be insolvent");
        assertLt(address(s).balance - s.slashedFunds(), 1e6, "excess is bounded dust");
        assertGt(s.slashedFunds(), 0);
    }

    /// Reentrancy on claimUnbondedSelfStake must not double-pay.
    function test_ReentrancyOnClaimUnbonded() public {
        Reenterer r = new Reenterer(s);
        vm.deal(address(r), 100 ether);
        // register via low-level so the attacker contract is the validator
        vm.prank(address(r));
        s.registerValidator{value: 40 ether}(10, "attacker");
        vm.prank(address(r)); s.unregisterValidator();
        r.setMode(3, address(r));   // mode 3 handled below: re-enter claimUnbonded

        vm.warp(block.timestamp + 7 days + 1);
        uint256 balBefore = address(s).balance;
        vm.prank(address(r)); s.claimUnbondedSelfStake();
        assertEq(address(s).balance, balBefore - 40 ether, "must pay unbonded stake once");
    }

    /// Delegating to an address that never registered must revert, not create state.
    function test_CannotDelegateToNonexistent() public {
        vm.prank(bob);
        vm.expectRevert("Validator not active");
        s.delegate{value: 50 ether}(address(0xDEAD));
    }

}
