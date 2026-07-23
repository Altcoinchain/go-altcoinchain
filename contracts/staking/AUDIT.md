# ValidatorStaking security audit — v2 findings and v3 remediation

Scope: `ValidatorStaking` (v2, deployed on Altcoinchain mainnet at
`0x347F496c887a92ed9706ff3EDF4f0b822Ab00d3E`) and its replacement
`ValidatorStakingV3`.

Method: line-by-line review plus an adversarial Foundry suite (34 tests,
5,000-run fuzzing) that attempts each exploit and asserts it fails. Built and
tested under `evm_version = paris` to match Altcoinchain's pre-Shanghai geth
(v1.10.24), which rejects PUSH0.

> **Caveat on independence.** This is a rigorous *self-audit* by the same party
> that wrote v3, not an independent third-party audit. It found and fixed a real
> hole in v3 itself (V3-01 below), which is evidence the process has teeth — but
> for the amounts intended here (100k+ ALT), independent review before large
> delegations remains worthwhile. Deploying the bytecode is safe; the risk is in
> what gets staked into it.

---

## Part 1 — v2 findings (all present in the live contract)

| ID | Severity | Finding | Fund impact |
|----|----------|---------|-------------|
| V2-01 | **Critical** | `slash()` is `external` with no access control and no proof of misbehaviour. Anyone can slash any validator. | 10% of any validator's stake destroyed on demand; `isSlashed` is permanent so the address can never validate again. |
| V2-02 | **Critical** | Self-stake has no withdrawal path. Every write to `selfStake` only adds or slashes. | 100% of every validator's self-stake permanently locked. |
| V2-03 | **High** | `slash()` decrements `v.totalDelegated` but not each `d.amount`, desyncing the two. | The last delegator to exit hits an underflow revert and is permanently stuck. |
| V2-04 | **High** | Validator self-stake earns only commission; the reward attributable to self-stake is pushed to delegators via `accRewardPerShare`. | Validators are systematically underpaid; running a validator with no delegators earns fine, but self-stake alongside delegators is unrewarded. |
| V2-05 | **Medium** | `receive()` (called by consensus every block) loops all validators and pushes ETH to each. | Unbounded gas as the set grows; one validator with a reverting `receive()` breaks reward distribution for everyone. |
| V2-06 | **Medium** | `rewardPool` accumulates when no validator is online and is never distributable. | Those rewards are permanently stuck. |
| V2-07 | **Low** | No voluntary deactivation (`ValidatorDeactivated` declared, never emitted); `validatorExists` accepts slashed validators. | Operational, not a direct loss. |

V2-01 and V2-02 are why funds were being "wasted": stake goes in and cannot come
out, and anyone can burn 10% of it at will.

**v3 cannot recover ALT already locked in v2.** That stake is unreachable by any
code path in the deployed v2 bytecode.

---

## Part 2 — v3 remediation

Each v2 finding is fixed and covered by a test that would fail against v2:

- **V2-01 →** `slash()` is `onlySystem`: only `SYSTEM_CALLER`
  (`0x000000000000000000000000000000000000FFFE`, the consensus system address,
  which has no private key) may call it. Pre-fork, nothing can call slash at all.
  Tests: `test_FIX1_RandomCannotSlash`, `test_FIX1_ValidatorCannotSlashRival`,
  `test_FIX1_SystemCanSlash`.
- **V2-02 →** `unstakeSelf` and `unregisterValidator` move self-stake into an
  unbonding slot claimable after the 7-day delay via `claimUnbondedSelfStake`.
  Tests: `test_FIX2_*`.
- **V2-03 →** slashing scales a per-validator `slashFactor`; every delegation is
  valued through it (`effective = raw * slashFactor / 1e18`), so losses are shared
  pro-rata in O(1) with no desync. Tests: `test_FIX3_*`.
- **V2-04 →** rewards split by actual stake ownership: the delegated portion pays
  delegators (minus commission), the self-stake portion pays the validator.
  Tests: `test_FIX4_ValidatorSelfStakeEarns`, `test_CommissionGoesToValidator`.
- **V2-05 →** distribution is O(n) accounting only, no external calls; everything
  is pull-based (`claimRewards`, `claimValidatorRewards`). A validator that rejects
  ALT cannot break it. Test: `test_FIX5_RejectingValidatorCannotBreakDistribution`.
- **V2-06 →** undistributable rewards are carried in `rewardPool` into the next
  round. Test: `test_FIX6_RewardsCarryForwardWhenNobodyOnline`.
- **V2-07 →** `unregisterValidator` exists and emits; modifiers reject slashed
  validators. Plus the missing feature: a `moniker` string
  (`registerValidator(commission, moniker)`, `setMoniker`), so
  "WATTxchange:nucash-mining" lives on-chain.

---

## Part 3 — issues found in v3 itself during this audit

- **V3-01 (High, FIXED).** First draft queued unbonding self-stake in the normal
  withdrawal queue and kept `require(isActive)` on `slash()`. That let a validator
  escape slashing by calling `unregisterValidator()` first — the classic unbonding
  hole. Fix: unbonding self-stake is held in the validator record (not the queue),
  `slash()` no longer requires `isActive`, and the penalty base includes unbonding
  funds. A quitting validator stays fully slashable for the whole 7-day window.
  Test: `test_PROBE_UnbondDoesNotEscapeSlashing`.

- **V3-02 (Informational).** Integer-division dust from reward splitting
  accumulates in the contract, so its balance is always ≥ what it owes. This is the
  safe direction — the contract can never become insolvent. Proven by
  `test_INVARIANT_SolventAfterSlashAndFullExit` (balance == burned penalty + bounded
  dust after a full exit).

- **V3-03 (Informational, accepted).** Slashed funds stay in the contract forever
  (burned in place), tracked by `slashedFunds`. This is deflationary by design;
  an alternative would redistribute them to honest validators. No fund is at risk
  either way. Documented, not changed.

- **V3-04 (Informational, accepted).** `completeWithdrawals` loops the caller's own
  queue. A delegator could bloat their own queue with many tiny `undelegate` calls
  and out-of-gas their own withdrawal. This is self-inflicted only — no other
  account is affected — and each `undelegate` costs the griefer gas. Accepted.

- **V3-06 (Critical, FIXED before deploy).** The first draft hardcoded
  `SYSTEM_CALLER = 0x0000…FFFE`, but the consensus system caller in
  `consensus/hybrid/systemcall.go` is
  `0xfffffffffffffffffffffffffffffffffffffffe` — a completely different address.
  As written, `slash()` would have been permanently uncallable: consensus could
  never punish a misbehaving validator. Caught by cross-checking the deployed
  consensus code, not by a test (the test used the same wrong constant, so it
  passed — a reminder that self-consistent tests can't catch a wrong external
  assumption). Fixed to the real system address; both contract and tests updated.

- **V3-05 (Design note).** `commission` (≤50%) is changeable by the validator at
  any time, so a validator can raise it before a reward round. This is standard
  DPoS behaviour; changes emit `CommissionChanged`. A future version could add a
  change delay. Not a fund-loss bug.

---

## Reviewed and found safe

- **Reentrancy:** all four ALT-sending paths (`claimRewards`,
  `claimValidatorRewards`, `completeWithdrawals`, `claimUnbondedSelfStake`) apply
  checks-effects-interactions — state is zeroed before the external call. Tested
  with a re-entering attacker on three of them; none double-pay.
- **Overflow:** Solidity 0.8.20 checked arithmetic. `slashFactor` math peaks around
  1e42, far under 2^256. `slashFactor` cannot reach 0 from a single 10% slash.
- **Raw/effective rounding:** always rounds in the contract's favour; a delegator
  can never withdraw more than deposited (5,000-run fuzz:
  `testFuzz_PROBE_NoValueCreationViaRounding`, `testFuzz_DelegateUndelegateRoundTrip`).
- **Accounting invariant:** `sum(d.rawAmount) == v.totalDelegatedRaw` is preserved by
  every mutation, so `undelegate` cannot underflow.
- **Access:** delegating to a non-existent or slashed validator reverts without
  creating state.

## Deployment notes

- Compile with `evm_version = "paris"` (ALT geth v1.10.24 is pre-Shanghai; the
  solc 0.8.20 default emits PUSH0 and the node rejects it).
- After deploy, point `params/config.go` `StakingContract` at the new address (the
  same one-line change made for v1→v2). The hybrid engine's `systemcall.go` reward
  path and the `SYSTEM_CALLER` slash path must agree on this address.
- `SYSTEM_CALLER` = `0x…FFFE` must match the address the hybrid consensus uses to
  call `slash()`. Confirm against `consensus/hybrid/systemcall.go` before the fork.
- Runtime size 12,681 bytes, well under the 24,576 EIP-170 limit.
