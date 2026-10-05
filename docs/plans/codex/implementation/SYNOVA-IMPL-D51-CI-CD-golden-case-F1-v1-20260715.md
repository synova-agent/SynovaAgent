# SynovaAgent ? D51 CI/CD Golden Case F1 Gate Implementation v1.0

> 2026-07-15 | Auth Doc #9 Deployment Operations Ch5
> Standard: Anthropic Engineering ? Iron Law 0-2 (spec->test->impl->wire) ? 5-Layer Architecture
> **This doc is the sole execution basis for claude code. Replaces crashed v20260714 version.**

---

## Execution Constraints (5 Questions Per Commit)

```
1. Wiring Check: Who calls the new export? (grep for callers)
2. Exception Handling: Every catch has log + degraded? (Iron Law 24+31)
3. Type Safety: as any = 0? (Iron Law 38)
4. Test Coverage: Tests have expect() assertions? Normal/degrade/boundary? (Iron Law 48)
5. Dead Code: Any dead code? Old files deleted? Old functions still referenced?
```

---

## Current State (2026-07-15 Audit)

- D84: Integration contract check-integration.sh DONE (L1+L2 checks)
- D85: MVS Golden Dataset client-a-v1 DONE (frozen snapshot + checksums)
- D86: Self-diagnosis check-self-diagnosis.sh DONE (6+1 steps)
- D49-D52: Deployment batch complete
- CI pipeline: ci.yml with 7 jobs (quality/test/architecture/check/audit)
- Golden case fixtures: ZERO existence ? new build
- F1 scoring script: ZERO existence ? new build
- Previous D51 (v20260714) crashed during render ? this is a clean restart

---

## What We Build

### 1. tests/fixtures/golden-cases/ ? 5 Golden Case Snapshots (New)

Frozen static JSON, never dynamically updated:

| File | Scenario | Expected Root Cause | Expected Severity |
|------|----------|---------------------|-------------------|
| golden-case-01-cashflow-crisis.json | Cash flow crisis | E-05 CAPITAL_ACQUISITION | critical |
| golden-case-02-margin-erosion.json | Margin erosion | E-23 OPERATIONAL_EXECUTION | warning |
| golden-case-03-churn-surge.json | Customer churn surge | E-31 CLIENT_RETENTION | critical |
| golden-case-04-talent-drain.json | Talent drain | E-07 TALENT_ACQUISITION | warning |
| golden-case-05-competition-attack.json | Competition attack | E-33 MARKET_COMPETITION | critical |

Each fixture: input data snapshot + expected diagnosis result (root edge ID + root node type + severity level).

### 2. scripts/ci/golden-case-checker.ts ? F1 Scoring Script (New)

Core function:
```typescript
function computeF1Score(actual: DiagnosisResult, expected: GoldenCaseExpectation): F1Result
```

Three match dimensions, all must = 1.0 to pass:
- **Key edge hit rate**: Extract 42-edge IDs from actual report -> compare with expected edge IDs
- **Root node match rate**: Extract root node type from actual report -> compare with expected
- **Severity consistency rate**: actual sentinelFinding.severity -> compare with expected

Exit code 0 = all three 100% pass. Exit code 1 + detailed diff output = fail.

### 3. .github/workflows/ci.yml ? New L7 Golden Case Job (Modify)

Add 8th job after existing 7:

```yaml
golden-case:
  name: Golden Case F1 Gate
  needs: test
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: '22' }
    - run: npm ci
    - run: npx tsx scripts/ci/golden-case-checker.ts
```

### 4. Golden Case Maintenance Strategy

- Frozen snapshots never auto-updated (input stability)
- On each 42-edge major version change: experts re-lock expected conclusions
- To add new cases: drop JSON in tests/fixtures/golden-cases/ + register in checker

---

## What We Don't Do

- Don't create Docker multi-arch build (D52)
- Don't create Windows MSI/macOS DMG packaging (D52)
- Don't modify existing CI jobs (only append 8th job)
- Don't modify diagnosis pipeline

---

## Architecture Layer

CI Layer (.github/workflows/ci.yml) + Test Fixtures (tests/fixtures/golden-cases/) + Scripts (scripts/ci/)

---

## Completion Standard

```
[ ] 5 golden case JSON fixtures with input snapshot + expected root cause
[ ] golden-case-checker.ts with 3-dimension F1 scoring
[ ] F1 = 1.0 (all three dimensions) -> exit 0; any < 1.0 -> exit 1
[ ] ci.yml new golden-case job (8th job, needs: test)
[ ] Golden cases use frozen static data (no live DB dependency)
[ ] Checker script works offline (no network dependency in scoring logic)
[ ] Zero as any
[ ] tsc --noEmit zero new errors (checker script types OK)
[ ] >=5 tests for golden-case-checker.ts (5 golden cases + error path)
[ ] Failed case outputs human-readable diff: which edge(s) mismatched
```

---

## Auth Doc References

- Auth Doc #9: Deployment Operations Ch5 ? CI/CD Pipeline
  - S5.2: Release gate ? golden causal case regression + F1-Score matching
  - S5.2: Golden case maintenance ? freeze static snapshots, experts re-lock on version change
- Auth Doc #6: Test System Spec ? @contract testing / golden case standards
- D84: Integration test contracts (check-integration.sh)
- D85: MVS Golden Dataset (client-a-v1 snapshot)
- D86: Self-diagnosis (check-self-diagnosis.sh)
