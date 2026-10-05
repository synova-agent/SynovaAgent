# SynovaAgent -- D99 E2E Full Pipeline Integration Test Implementation v1.0

> 2026-07-17 | Pre-Launch Verification Track | Iron Law 0-2 | 5-Layer Architecture
> **This is the single most important test in the project. It determines whether 85 computes + 50 sentinels + 9 experts + 6 loops actually work together.**
> **This doc is the sole execution basis for claude code.**

---

## Problem Statement

We have 15 integration tests and 2 e2e tests. ZERO cover the complete pipeline from raw data to final report. Every existing test passes in isolation. We have never verified that data flows end-to-end across all layers.

When this test fails, it will find the bugs that unit tests cannot: sentinel Finding field names mismatched with signal aggregator expectations, expert prompt placeholders not replaced, Goal ID formats incompatible with GraphStore, compute function output shapes not matching sentinel input contracts.

---

## What We Build

### 1. tests/e2e/full-pipeline.integration.test.ts -- Single full-pipeline test

**Test: "complete pipeline: client-a-v1 data -> diagnosis report -> Goals -> Goal sentinel"**

Pipeline stages (each with expect() assertions on intermediate output):

```
Stage 0: Load golden dataset
  ??? Read data/golden/client-a-v1.json (8244 bytes, real enterprise data)
  ??? Verify JSON structure: enterprise profile + financial + customer + HR data

Stage 1: Data ingestion
  ??? Call POST /api/data/ingest with golden data
  ??? Verify: ingestion creates nodes in GraphStore
  ??? Verify: no PII leakage (D34 scrubber activated)

Stage 2: Compute functions (sample 5 critical edges)
  ??? E-05 computeCapitalAcquisition: verify output has transferFunction result
  ??? E-23 computeOperationalExecution: verify output shape
  ??? E-31 computeCustomerLockin: verify output shape
  ??? E-33 computeCompetitivePositioning: verify output shape
  ??? E-07 computeTalentAcquisition: verify output shape

Stage 3: Sentinel execution (sample 5 critical sentinels)
  ??? capital-health sentinel: aggregate() -> check() -> findings[]
  ??? margin-health sentinel: aggregate() -> check() -> findings[]
  ??? competitive-position sentinel: aggregate() -> check() -> findings[]
  ??? talent-density sentinel: aggregate() -> check() -> findings[]
  ??? cash-runway sentinel: aggregate() -> check() -> findings[]
  ??? Verify: each finding has id + severity + title + description + matchedEdgeIds

Stage 4: Signal aggregation
  ??? Import SignalAggregator from src/sentinel/
  ??? Feed sentinel findings -> aggregate()
  ??? Verify: aggregated signals have cross-correlations
  ??? Verify: severity escalation logic works (multiple P1 -> P0)

Stage 5: Expert routing + diagnosis (Phase 0-5)
  ??? Import DiagnosisOrchestrator from packages/engine-core
  ??? Run runModules() with golden data
  ??? Verify: Phase 0 scoping produces valid module list
  ??? Verify: Phase 1-2 evidence collection returns evidence[]
  ??? Verify: Phase 3 expert analysis routes to correct experts
  ??? Verify: Phase 4 cross-validation fires for multi-expert diagnoses
  ??? Verify: Phase 5 produces StructuredDiagnosisReport

Stage 6: Report generation
  ??? Verify: report has ceoSummary (non-empty string, >= 50 chars)
  ??? Verify: report has keyFindings (non-empty array)
  ??? Verify: report has actionRecommendations (ActionRecommendation[])
  ??? Verify: report has rootCauseTree with edge/node structure
  ??? Verify: report.confidence >= 0.5 (reasonable for golden data)

Stage 7: Goal creation from report
  ??? Call generateProposalFromDiagnosis(report)
  ??? Verify: proposal has 3 paths (??/??/??)
  ??? Call generateGoalFromProposal(proposal) -> goalId
  ??? Verify: Goal created with status='draft', ownerDeptId set

Stage 8: Goal sentinel monitoring
  ??? Call createGoalSentinel(goal)
  ??? Call sentinel.check()
  ??? Verify: check() returns ok + findings[]
  ??? Verify: findings are empty or have valid structure
```

### 2. Mock LLM strategy

All calls to LLM (DeepSeek/OpenAI) MUST be mocked. Use vitest mock:
```typescript
vi.mock('../src/providers', () => ({
  createProvider: () => ({
    chat: async () => ({ content: JSON.stringify(mockDiagnosisResponse) }),
    stream: async function* () { yield { content: 'mock' }; },
  }),
}));
```

Mock response data: create a mockDiagnosisResponse object in the test file with realistic CEO summary + findings + recommendations.

---

## What We Don't Do

- Don't test individual compute function accuracy (covered by D82/D59/D60 unit tests)
- Don't test individual sentinel logic (covered by sentinel unit tests)
- Don't use real LLM (cost + speed)
- Don't verify frontend rendering (D96/D97/D98 handle that)

---

## Completion Standard

```
[ ] test file: tests/e2e/full-pipeline.integration.test.ts
[ ] 8 pipeline stages, each with >=2 expect() assertions
[ ] Golden data loaded from data/golden/client-a-v1.json
[ ] 5 compute functions verified (E-05/E-23/E-31/E-33/E-07)
[ ] 5 sentinels verified (capital-health/margin-health/competitive-position/talent-density/cash-runway)
[ ] Signal aggregation: cross-correlation + escalation verified
[ ] Diagnosis Phase 0-5: all phases produce valid output
[ ] Report: ceoSummary + keyFindings + actionRecommendations + rootCauseTree present
[ ] Goal: proposal with 3 paths -> Goal created -> Goal sentinel check passes
[ ] Mock LLM: all provider calls intercepted
[ ] Zero as any
[ ] tsc --noEmit zero new errors
[ ] vitest run tests/e2e/full-pipeline.integration.test.ts -- PASS
[ ] Test runs in < 60 seconds (no real LLM, no real HTTP)
```

---

## Auth Doc References

- D85: MVS Golden Dataset (client-a-v1)
- D51: Golden Case F1 Gate
- D77: Growth Navigation Integration (e2e test pattern)
- Auth Doc #6: Test System Spec -- integration test standards
- Auth Doc #14: System Integration Roadmap -- MVS acceptance criteria
