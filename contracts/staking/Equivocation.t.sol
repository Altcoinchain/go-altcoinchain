// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "forge-std/Test.sol";
import "../src/ValidatorStakingV3.sol";

contract EquivocationTest is Test {
    ValidatorStakingV3 staking;
    uint256 constant PK = 0xA11CE;
    address val;

    function setUp() public {
        staking = new ValidatorStakingV3();
        val = vm.addr(PK);
        vm.deal(val, 100 ether);
        vm.prank(val);
        staking.registerValidator{value: 32 ether}(0, "cheater");
    }

    function _sig(uint256 pk, uint256 bn, bytes32 h) internal pure returns (bytes memory) {
        bytes32 digest = keccak256(abi.encodePacked(bn, h));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_EvidenceSlashesDoubleSigner() public {
        uint256 bn = 5000;
        bytes32 hA = keccak256("blockA");
        bytes32 hB = keccak256("blockB");
        (, , , , , , bool slashedBefore, ) = staking.getValidator(val);
        assertFalse(slashedBefore, "should start unslashed");

        // anyone (not the validator) submits the evidence
        vm.prank(address(0xBEEF));
        staking.slashWithEvidence(val, bn, hA, _sig(PK, bn, hA), hB, _sig(PK, bn, hB));

        (, , , , , , bool slashedAfter, ) = staking.getValidator(val);
        assertTrue(slashedAfter, "double-signer must be slashed");
        assertGt(staking.slashedFunds(), 0, "penalty must be recorded");
    }

    function test_RejectsSameHash() public {
        uint256 bn = 5000;
        bytes32 h = keccak256("same");
        vm.expectRevert("Not conflicting");
        staking.slashWithEvidence(val, bn, h, _sig(PK, bn, h), h, _sig(PK, bn, h));
    }

    function test_CannotFrameHonestValidator() public {
        // attacker signs with a DIFFERENT key but claims it's `val`
        uint256 badPk = 0xB0B;
        uint256 bn = 5000;
        bytes32 hA = keccak256("x");
        bytes32 hB = keccak256("y");
        vm.expectRevert("sigA not validator");
        staking.slashWithEvidence(val, bn, hA, _sig(badPk, bn, hA), hB, _sig(badPk, bn, hB));
    }

    function test_CannotSlashTwice() public {
        uint256 bn = 5000;
        bytes32 hA = keccak256("a");
        bytes32 hB = keccak256("b");
        staking.slashWithEvidence(val, bn, hA, _sig(PK, bn, hA), hB, _sig(PK, bn, hB));
        vm.expectRevert("Already slashed");
        staking.slashWithEvidence(val, bn, hA, _sig(PK, bn, hA), hB, _sig(PK, bn, hB));
    }
}
