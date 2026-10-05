# SynovaAgent -- D26 Golden Case Extension Implementation v1.0

> 2026-07-20 | Auth Doc #6: Test System Spec -- Chapter 5: Regression Baseline System
> **D51 has 5 golden cases. D26 extends to 10 with diverse industries + boundary conditions.**
> **This doc is the sole execution basis for claude code.**

---

## Loop Engineering V4.4.5 -- MANDATORY TASK-START (Q1-Q4)

### Q0: Project Identity
SynovaAgent test system. D26 extends the golden case regression suite from 5 to 10 cases, adding diverse industries, edge conditions, and boundary scenarios. All cases integrate with D51 golden-case-checker.ts.

### Q1: Research
- Industry: ML model regression suites, property-based testing (QuickCheck), snapshot testing
- Memory lessons: Iron Law 48 -- tests must not be empty shells. Every golden case must have real input data + real expected output. Not placeholder fixtures.

### Q2: Scope
- Minimal: 5 new golden case JSON fixtures + register in golden-case-checker.ts
- NOT doing: live data regression (D27), traversal YAML tests (D28), industry benchmark datasets

### Q3: Acceptance
- Entry: golden-case-checker.ts scans tests/fixtures/golden-cases/ for all JSON files
- Interaction: each new case passes F1 scoring (edge hit rate = 1.0, node match rate = 1.0, severity match = true)
- Result: 10/10 golden cases pass. CI golden-case job all green.

### Q4: Contract and Test
- Each golden case: GoldenCase JSON format (id/title/description/frozenAt/input/expected)
- @input: SentinelFinding[] + graphEdge state for a specific enterprise scenario
- @output: expected root cause edge IDs + root cause node types + severity
- Tests: 5 new golden case fixtures are valid JSON + pass F1 check

---

> Standard: Anthropic Engineering | Iron Law 0-2 | 5-Layer Architecture

---

## Loop Engineering V4.4.5 -- MANDATORY EXECUTION CONSTRAINTS

```
=== Pre-Commit Hard Gates ===
G1: as any = 0
G2: empty catch has log.warn
G3: secrets scan
G4: every new file paired with test
G5: new exports have callers

=== Post-Code Agent Self-Check ===
1. [WIRING] New golden cases registered in checker?
2. [EXCEPTION] Error handling in checker for invalid JSON?
3. [TYPES] as any = 0?
4. [TESTS] Each case has expected output that matches checker format?
5. [DEAD CODE] None

=== verify-incremental.sh ===
L1 oxlint -> L2 tsc -> L3 vitest --changed -> L4 wiring
```

---

## Current State (2026-07-20, verified by grep)

- D51: Golden Case F1 Gate DONE (golden-case-checker.ts, 5 cases)
- D85: MVS Golden Dataset (client-a-v1.json) DONE -- real enterprise data
- D99: Full pipeline E2E test DONE
- Existing 5 cases: cashflow-crisis, margin-erosion, churn-surge, talent-drain, competition-attack
- Golden case format: { id, title, description, frozenAt, input: { sentinelFindings[], graphEdges[] }, expected: { rootCauseEdgeIds[], rootCauseNodeTypes[], severity, matchedEdgeIds[], explanation } }

---

## What We Build

### 5 New Golden Case Fixtures

| # | Case ID | Scenario | Industry | Expected Root Cause | Severity |
|---|---------|----------|----------|---------------------|----------|
| 6 | efficiency-attraction-failure | Low operational efficiency repels top talent and investor capital | Cross-industry | E-11 (EFFICIENCY_ATTRACTION) | critical |
| 7 | tech-debt-explosion | Accumulated technical debt causes slowdown | SaaS/Tech | E-24 (TECH_INFRASTRUCTURE) | warning |
| 8 | regulatory-fine-risk | Compliance gap triggers potential penalty | Finance | E-17 (RULE_CONSTRAINT) | critical |
| 9 | market-expansion-failure | New market entry fails to capture share against incumbents | Retail | E-30 (MARKET_SHARE_CAPTURE) | warning |
| 10 | knowledge-loss-crisis | Key person departure causes knowledge drain across teams | Professional Services | E-19 (KNOWLEDGE_SHARING) | critical |

Each fixture:
- 3-5 sentinel findings simulating real alert scenarios
- Expected root cause with edge IDs matching 42-edge system
- Severity classification (critical vs warning)
- Frozen at 2026-07-20

### Register in golden-case-checker.ts (Modify)

Add the following entries to EDGE_TO_NODE mapping:

```typescript
const EDGE_TO_NODE: Record<string, string> = {
  // ... existing entries ...
  'E-11': 'EFFICIENCY_ATTRACTION',
  'E-17': 'RULE_CONSTRAINT',
  'E-19': 'KNOWLEDGE_SHARING',
  'E-24': 'TECH_INFRASTRUCTURE',
  'E-30': 'MARKET_SHARE_CAPTURE',
};
```

Add 5 new cases to the checker's scan list (already scans by glob `golden-case-*.json`).
Update EDGE_TO_NODE mapping if new edge IDs introduced.
Add new expected node types to the mapping.

### Regression validation

Re-run all 10 cases:
```
npx tsx scripts/ci/golden-case-checker.ts
```
Verify: 10/10 pass, 0 failures.

---

## What We Don't Do

- Don't create live data regression tests (D27)
- Don't create traversal YAML test suites (D28)
- Don't modify golden-case-checker.ts scoring algorithm
- Don't use real enterprise data (all fixtures are synthetic scenarios)

---

## Completion Standard

```
[ ] 5 new golden case JSON fixtures in tests/fixtures/golden-cases/
[ ] Each fixture: id/title/description/frozenAt/input/expected all non-empty
[ ] Each fixture: 3-5 sentinel findings with realistic severity + matchedEdgeIds
[ ] EDGE_TO_NODE mapping updated for any new edge types
[ ] golden-case-checker.ts: no code changes needed (glob scans all files)
[ ] Run checker: 10/10 cases pass F1 scoring (100% edge hit + node match + severity)
[ ] CI golden-case job: all green
[ ] Zero as any (no TypeScript changes)
[ ] tsc --noEmit zero new errors
[ ] vitest run tests/ci/golden-case-checker.test.ts -- all existing + new tests pass (>=15 tests: 5 existing + 5 new golden cases + 5 checker)
```

---

## Auth Doc References

- Auth Doc #6: Test System Spec -- Chapter 5: Regression Baseline System
- D51: Golden Case F1 Gate (golden-case-checker.ts)
- D85: MVS Golden Dataset (client-a-v1.json -- reference pattern)
