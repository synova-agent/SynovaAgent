export const meta = {
  name: 'synova-code-audit',
  description: 'Execute SYNOVA-AUDIT-SPEC code audit across 15 commits on feat/prompt-architecture',
  phases: [
    { title: 'Audit P0 Agent Infrastructure (D8a-D8f)' },
    { title: 'Audit P0 Auth & Enterprise (D102+D103, D106+D107)' },
    { title: 'Audit P1 Scheduling (D91, D94)' },
    { title: 'Audit P1 Frontend (D96)' },
    { title: 'Audit P1 Messaging & Feedback (D17, D18, D19)' },
    { title: 'Audit D20 Loops UI' },
    { title: 'Run full vitest regression (D8a-D8f --no-verify)' },
    { title: 'Synthesize final report' },
  ],
}

const AUDIT_PROMPT = (item) => `You are auditing commit ${item.label} (${item.hash} — "${item.msg}") per SYNOVA-AUDIT-SPEC.

Files: ${item.files.join(', ')}

Run the following 5 checks on the **current state** of these files:

## Check 1: Wiring (接线)
For each new export function/class/const in the src/ files listed, run:
  grep -rn "symbolName" src/ --include="*.ts" | grep -v "\.test\." | grep -v "export.*symbolName"
- At least 1 caller in src/ outside the defining file → PASS
- Zero callers → P0 bug. Report file:line.

## Check 2: Exception (降级)
For each src/ file listed, check every catch block:
- grep -n "catch" the file, read context around each catch
- Every catch must have log.warn/error + return degraded:true
- Empty catch → P0 bug. Report file:line.

## Check 3: Type Safety (类型安全)
For each src/ file listed:
  grep -n "as any" the file (skip .test. files and .d.ts files)
- Any "as any" in non-test code → P1. Report file:line.

## Check 4: Test Coverage (测试覆盖)
For each test file listed (and any new src/ file that lacks a test):
- Does test file exist? If not → P1
- In each test file, count expect() calls — if < 3 per file → P1 (空壳测试)

## Check 5: Contract (契约)
For compute functions in src/ files:
  grep -B2 -A15 "export function compute" the files
- Must have @input @output @degraded JSDoc tags
- Missing → P1

## Historical error patterns to watch for (from spec 2.3):
- ExpertType written as 'unknown' literal
- ConvergenceEngine created via "new" instead of DI
- setMainAgent() with zero callers
- from" spacing damage (from" → should be from ")
- healthz used as business API

## Output format:
Return a JSON object:
{
  "label": "${item.label}",
  "hash": "${item.hash}",
  "msg": "${item.msg}",
  "results": { "Wiring": "PASS|P0|P1", "Exception": "PASS|P0|P1", "TypeSafety": "PASS|P1", "Test": "PASS|P1", "Contract": "PASS|P1" },
  "findings": [
    { "priority": "P0|P1|P2", "file": "path.ts", "line": 42, "issue": "description", "fix": "suggestion" }
  ]
}`

const AUDIT_SCHEMA = {
  type: 'object',
  properties: {
    label: { type: 'string' },
    hash: { type: 'string' },
    msg: { type: 'string' },
    results: {
      type: 'object',
      properties: {
        Wiring: { type: 'string', enum: ['PASS', 'P0', 'P1'] },
        Exception: { type: 'string', enum: ['PASS', 'P0', 'P1'] },
        TypeSafety: { type: 'string', enum: ['PASS', 'P1'] },
        Test: { type: 'string', enum: ['PASS', 'P1'] },
        Contract: { type: 'string', enum: ['PASS', 'P1'] },
      },
      required: ['Wiring', 'Exception', 'TypeSafety', 'Test', 'Contract'],
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          priority: { type: 'string', enum: ['P0', 'P1', 'P2'] },
          file: { type: 'string' },
          line: { type: 'integer' },
          issue: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['priority', 'file', 'line', 'issue', 'fix'],
      },
    },
  },
  required: ['label', 'hash', 'msg', 'results', 'findings'],
}

const D102_PROMPT = `Audit commit D102+D103 (34eeff0) per SYNOVA-AUDIT-SPEC.

Files: src/routes/auth.ts, src/routes/enterprise.ts, src/server.ts, tests/routes/enterprise.test.ts

Run the 5 checks:
1. Wiring: Check all exports in auth.ts, enterprise.ts — have callers in src/?
2. Exception: Check catch blocks in auth.ts, enterprise.ts — log.warn/error + degraded?
3. Type Safety: Check auth.ts, enterprise.ts for "as any"
4. Test Coverage: Check enterprise.test.ts — exists? has >=3 expect()?
5. Contract: Check for compute functions with JSDoc

Historical pattern: Check from" spacing damage, healthz misuse.

Return JSON: { "label": "D102+D103", "hash": "34eeff0", "msg": "Auth+Enterprise", "results": {Wiring,Exception,TypeSafety,Test,Contract}, "findings": [...] }`

const D106_PROMPT = `Audit commit D106+D107 (77059b0) per SYNOVA-AUDIT-SPEC.

Files: src/growth/user-store.ts, tests/growth/user-store.test.ts

Run the 5 checks:
1. Wiring: Check exports in user-store.ts — have callers in src/ (not tests)?
2. Exception: Check catch blocks for log.warn/error + degraded
3. Type Safety: Check user-store.ts for "as any"
4. Test Coverage: Check user-store.test.ts — exists? has >=3 expect()? Non-empty?
5. Contract: Check for compute functions with JSDoc

Return JSON: { "label": "D106+D107", "hash": "77059b0", "msg": "GraphStore User", "results": {Wiring,Exception,TypeSafety,Test,Contract}, "findings": [...] }`

const D91_PROMPT = `Audit commit D91 (dfb5429) per SYNOVA-AUDIT-SPEC.

Files: src/deploy/bootstrap.ts, src/loops/loop-scheduler.ts, src/loops/loop-trigger-config.ts, tests/loops/loop-trigger-config.test.ts

Run the 5 checks:
1. Wiring: Check exports in loop-scheduler.ts, loop-trigger-config.ts for callers
2. Exception: Check catch blocks
3. Type Safety: Check as any
4. Test Coverage: Check loop-trigger-config.test.ts exists and has expect()
5. Contract: Check compute functions

Also check: loop-scheduler.ts exports — is registerLoop/onEvent called from bootstrap.ts?

Return JSON: { "label": "D91", "hash": "dfb5429", "msg": "Multi-scale Trigger Matrix", "results": {Wiring,Exception,TypeSafety,Test,Contract}, "findings": [...] }`

const D94_PROMPT = `Audit commit D94 (7ee8386) per SYNOVA-AUDIT-SPEC.

Files: src/cron/scheduler.ts, tests/cron/scheduler.test.ts

Run the 5 checks:
1. Wiring: Check exports in scheduler.ts — any callers?
2. Exception: Check catch blocks — log.warn/error + degraded?
3. Type Safety: Check as any
4. Test Coverage: Check scheduler.test.ts exists and has expect()
5. Contract: Check compute functions

Return JSON: { "label": "D94", "hash": "7ee8386", "msg": "CronScheduler Hybrid", "results": {Wiring,Exception,TypeSafety,Test,Contract}, "findings": [...] }`

const D96_PROMPT = `Audit commit D96 (c3f5164) per SYNOVA-AUDIT-SPEC.

Files: app/css/app.css, app/index.html, app/js/api-client.js, app/js/auth.js, app/js/shell.js, app/login.html, src/server.ts, .gitignore

Run checks:
1. Wiring: Check express.static in server.ts serves app/ directory. Check api-client.js, auth.js, shell.js are referenced by HTML files.
2. Exception: Check catch blocks in server.ts
3. Type Safety: Check server.ts for as any
4. Test: Mark PASS (frontend files)
5. Contract: Mark PASS (frontend)

Also check: JWT token management in auth.js (401 auto-refresh?), shared nav shell, offline detection.

Return JSON: { "label": "D96", "hash": "c3f5164", "msg": "Login+Auth UI+Shared Shell", "results": {Wiring,Exception,TypeSafety,Test,Contract}, "findings": [...] }`

const D17_PROMPT = `Audit commit D17 (0cc7ff7) per SYNOVA-AUDIT-SPEC.

Files: src/agent/proactive-push.ts, src/sentinel/runner.ts, tests/agent/proactive-push.test.ts

Run the 5 checks:
1. Wiring: Check exports in proactive-push.ts — onP0Finding, pushToChannel, retryFailed — have callers in src/?
2. Exception: Check catch blocks in both src files — log + degraded?
3. Type Safety: Check as any
4. Test Coverage: Check proactive-push.test.ts — exists? expects?
5. Contract: Check compute functions

Also check: runner.ts refers to ProactivePush? Wired in?

Return JSON: { "label": "D17", "hash": "0cc7ff7", "msg": "P0 Proactive Push", "results": {Wiring,Exception,TypeSafety,Test,Contract}, "findings": [...] }`

const D18_PROMPT = `Audit commit D18 (31f1152) per SYNOVA-AUDIT-SPEC.

Files: src/agent/interactive-card.ts, src/agent/proactive-push.ts, src/routes/sentinel.ts, tests/agent/interactive-card.test.ts

Run the 5 checks:
1. Wiring: Check exports in interactive-card.ts (buildCardMessage, handleAction) and sentinel.ts POST endpoint — have callers?
2. Exception: Check catch blocks — log + degraded?
3. Type Safety: Check as any
4. Test Coverage: Check interactive-card.test.ts
5. Contract: Check compute functions

Also check: ProactivePush calls InteractiveCard? sentinel route registered in server.ts?

Return JSON: { "label": "D18", "hash": "31f1152", "msg": "Interactive Card", "results": {Wiring,Exception,TypeSafety,Test,Contract}, "findings": [...] }`

const D19_PROMPT = `Audit commit D19 (9790414) per SYNOVA-AUDIT-SPEC.

Files: src/agent/interactive-card.ts, src/l3/ga-collaboration.ts, tests/l3/ga-collaboration.test.ts

Run the 5 checks:
1. Wiring: Check exports in ga-collaboration.ts (GAFeedbackHandler.processFeedback, triggerReDiagnosis) — callers?
2. Exception: Check catch blocks — log + degraded?
3. Type Safety: Check as any
4. Test Coverage: Check ga-collaboration.test.ts
5. Contract: Check compute functions

Also check: ga-collaboration.ts integrates with interactive-card.ts? D75/D93 integration?

Return JSON: { "label": "D19", "hash": "9790414", "msg": "GA Feedback", "results": {Wiring,Exception,TypeSafety,Test,Contract}, "findings": [...] }`

const D20_PROMPT = `Audit commit D20 (2d0f699) per SYNOVA-AUDIT-SPEC.

Files: app/js/loops.js, app/js/shell.js, app/loops.html, src/routes/loops.ts, src/server.ts

Run the 5 checks:
1. Wiring: Check GET /api/loops/status in loops.ts — route registered in server.ts? loops.js calls api.get()?
2. Exception: Check catch blocks in loops.ts — log + degraded?
3. Type Safety: Check loops.ts for as any
4. Test Coverage: Check tests/routes/loops.test.ts exists?
5. Contract: N/A

Also verify the 8-point D20 checklist:
[ ] Test file tests/routes/loops.test.ts exists with >=4 it()
[ ] HTML uses correct paths (/app/css/app.css, /app/js/shell.js)
[ ] Uses <header id="synova-shell"> + shell.js shared nav
[ ] Uses api.get() not bare fetch()
[ ] GET /api/loops/status has JWT auth middleware
[ ] MainAgent injected via server.ts into route handler
[ ] API response includes nextTrigger.nextAt field
[ ] lastRunAgoSeconds returns timestamp (client calculates)

Return JSON: { "label": "D20", "hash": "2d0f699", "msg": "Loops UI + fixes", "results": {Wiring,Exception,TypeSafety,Test,Contract}, "findings": [...] }`

const REGRESSION_PROMPT = `Run full vitest regression on ALL test suites.

The commits D8a through D8f were committed with --no-verify (bypassed pre-commit hooks). Need full regression.

Execute:
  npx vitest run tests/agent/ 2>&1

Report how many tests passed/failed, and any failures with exact error messages (file:line).

Also run:
  npx vitest run tests/routes/ tests/growth/ tests/cron/ tests/loops/ tests/l3/ 2>&1

Return JSON: {
  "agentTestResult": "PASS|FAIL|ERROR",
  "agentTestSummary": "X passed, Y failed",
  "agentTestFailures": [{"file": "...", "line": 0, "error": "..."}],
  "otherTestsResult": "PASS|FAIL",
  "otherTestSummary": "..."
}`

// =====================================================================
// Phase 1: Audit P0 Agent Infrastructure (D8a-D8f) — 6 commits
// =====================================================================
phase('Audit P0 Agent Infrastructure (D8a-D8f)')

const d8Commits = [
  { label: 'D8a', hash: 'f0cdf83', msg: 'L2 Main Agent', files: ['src/agent/loop-handlers.ts', 'src/agent/main-agent.ts', 'src/deploy/bootstrap.ts', 'tests/agent/main-agent.test.ts'] },
  { label: 'D8b', hash: 'c4152e4', msg: 'Task Decomposition', files: ['src/agent/main-agent.ts', 'src/agent/task-decomposer.ts', 'tests/agent/task-decomposer.test.ts'] },
  { label: 'D8c', hash: '152dfb7', msg: 'Expert Router', files: ['src/agent/expert-router.ts', 'src/agent/task-decomposer.ts', 'tests/agent/expert-router.test.ts'] },
  { label: 'D8d', hash: 'f7bcbe0', msg: 'Cross Validator', files: ['src/agent/cross-validator.ts', 'src/agent/main-agent.ts', 'tests/agent/cross-validator.test.ts'] },
  { label: 'D8e', hash: 'db5251f', msg: 'Conflict Arbitration', files: ['src/agent/conflict-arbitrator.ts', 'tests/agent/conflict-arbitrator.test.ts'] },
  { label: 'D8f', hash: 'a6a2322', msg: 'Convergence Engine', files: ['src/agent/conflict-arbitrator.ts', 'src/agent/convergence-engine.ts', 'src/agent/main-agent.ts', 'tests/agent/convergence-engine.test.ts'] },
]

const grp1 = await pipeline(
  d8Commits,
  item => agent(AUDIT_PROMPT(item), { phase: 'Audit P0 Agent Infrastructure (D8a-D8f)', schema: AUDIT_SCHEMA, label: `audit:${item.label}` }),
)

// =====================================================================
// Phase 2: P0 Auth & Enterprise
// =====================================================================
phase('Audit P0 Auth & Enterprise (D102+D103, D106+D107)')

const grp2 = await parallel([
  () => agent(D102_PROMPT, { phase: 'Audit P0 Auth & Enterprise (D102+D103, D106+D107)', schema: AUDIT_SCHEMA, label: 'audit:D102+D103' }),
  () => agent(D106_PROMPT, { phase: 'Audit P0 Auth & Enterprise (D102+D103, D106+D107)', schema: AUDIT_SCHEMA, label: 'audit:D106+D107' }),
])

// =====================================================================
// Phase 3: P1 Scheduling
// =====================================================================
phase('Audit P1 Scheduling (D91, D94)')

const grp3 = await parallel([
  () => agent(D91_PROMPT, { phase: 'Audit P1 Scheduling (D91, D94)', schema: AUDIT_SCHEMA, label: 'audit:D91' }),
  () => agent(D94_PROMPT, { phase: 'Audit P1 Scheduling (D91, D94)', schema: AUDIT_SCHEMA, label: 'audit:D94' }),
])

// =====================================================================
// Phase 4: P1 Frontend
// =====================================================================
phase('Audit P1 Frontend (D96)')

const grp4 = await agent(D96_PROMPT, { phase: 'Audit P1 Frontend (D96)', schema: AUDIT_SCHEMA, label: 'audit:D96' })

// =====================================================================
// Phase 5: P1 Messaging & Feedback
// =====================================================================
phase('Audit P1 Messaging & Feedback (D17, D18, D19)')

const grp5 = await parallel([
  () => agent(D17_PROMPT, { phase: 'Audit P1 Messaging & Feedback (D17, D18, D19)', schema: AUDIT_SCHEMA, label: 'audit:D17' }),
  () => agent(D18_PROMPT, { phase: 'Audit P1 Messaging & Feedback (D17, D18, D19)', schema: AUDIT_SCHEMA, label: 'audit:D18' }),
  () => agent(D19_PROMPT, { phase: 'Audit P1 Messaging & Feedback (D17, D18, D19)', schema: AUDIT_SCHEMA, label: 'audit:D19' }),
])

// =====================================================================
// Phase 6: D20 Loops UI (Special 8-point checklist)
// =====================================================================
phase('Audit D20 Loops UI')

const grp6 = await agent(D20_PROMPT, { phase: 'Audit D20 Loops UI', schema: AUDIT_SCHEMA, label: 'audit:D20' })

// =====================================================================
// Phase 7: Full Regression (D8a-D8f --no-verify)
// =====================================================================
phase('Run full vitest regression (D8a-D8f --no-verify)')

const regressionResult = await agent(REGRESSION_PROMPT, {
  phase: 'Run full vitest regression (D8a-D8f --no-verify)',
  schema: {
    type: 'object',
    properties: {
      agentTestResult: { type: 'string' },
      agentTestSummary: { type: 'string' },
      agentTestFailures: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, line: { type: 'integer' }, error: { type: 'string' } }, required: ['file', 'line', 'error'] } },
      otherTestsResult: { type: 'string' },
      otherTestSummary: { type: 'string' },
    },
    required: ['agentTestResult', 'agentTestSummary', 'agentTestFailures', 'otherTestsResult', 'otherTestSummary'],
  },
  label: 'regression:vitest',
})

// =====================================================================
// Phase 8: Synthesize Final Report
// =====================================================================
phase('Synthesize final report')

const allResults = [...grp1, ...grp2, ...grp3, grp4, ...grp5, grp6]

log(`Total audits completed: ${allResults.length} / 15 commits`)

// Count findings
let p0Count = 0, p1Count = 0, p2Count = 0
const allFindings = []
for (const r of allResults) {
  if (r && r.findings) {
    for (const f of r.findings) {
      if (f.priority === 'P0') p0Count++
      else if (f.priority === 'P1') p1Count++
      else if (f.priority === 'P2') p2Count++
      allFindings.push({ commit: r.label, hash: r.hash, ...f })
    }
  }
}

const passCount = allResults.filter(r => {
  if (!r || !r.results) return false
  const v = r.results
  return v.Wiring === 'PASS' && v.Exception === 'PASS' && v.TypeSafety === 'PASS' && v.Test === 'PASS' && v.Contract === 'PASS'
}).length

return {
  summary: {
    auditDate: '2026-07-22',
    totalCommits: 15,
    totalAudited: allResults.length,
    p0Count,
    p1Count,
    p2Count,
    passCount,
    failedCount: allResults.length - passCount,
    regression: {
      agentTestResult: regressionResult?.agentTestResult || 'UNKNOWN',
      agentTestSummary: regressionResult?.agentTestSummary || '',
      agentTestFailures: regressionResult?.agentTestFailures || [],
      otherTestsResult: regressionResult?.otherTestsResult || 'UNKNOWN',
      otherTestSummary: regressionResult?.otherTestSummary || '',
    },
  },
  commitResults: allResults.map(r => ({
    label: r?.label || 'UNKNOWN',
    hash: r?.hash || '',
    msg: r?.msg || '',
    results: r?.results || {},
    findingCount: r?.findings?.length || 0,
  })),
  p0Findings: allFindings.filter(f => f.priority === 'P0'),
  p1Findings: allFindings.filter(f => f.priority === 'P1'),
  p2Findings: allFindings.filter(f => f.priority === 'P2'),
}
