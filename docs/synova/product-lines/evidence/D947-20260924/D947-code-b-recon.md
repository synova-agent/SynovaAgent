# D947 · code-b · PR-2a 就绪侦察证据（M2 冲突扫描）

> **任务**：`task-2`（owner `code-b`）· **阶段**：PR-2 就绪侦察（**只读**）
> **工作树**：`D:\novis-backup-20260526\Novis\synova-agent\.synova-wt-d947-middleware`
> **分支**：`feat/d947-middleware-default-posture` · **HEAD**：`f25e61eb105690359dbe13baf64695e5ff1748f0`
> **与 `origin/main` 同步回执**：`$ git rev-list --left-right --count origin/main...HEAD` → `0	0`（即 `[ahead 0, behind 0]`）
> **取证时间**：2026-09-24 · **采集方式**：Git Bash（`grep`/`awk`/`wc`/`find`），脚本落 `%TEMP%`（临时产物不入库）
> **本任务写集**：仅 `docs/synova/product-lines/evidence/D947-20260924/D947-code-b-recon.md`；**未改任何 `src/` 或 `tests/` 文件**（见 C 节 S8 的 `git status --porcelain`）
> **本阶段未跑 vitest**（重型验证 ≤1，PR-1 期间由 code-a 占用）⇒ 本文全部结论为**静态取证**，不含运行时验证。

**口径声明**：本文所有数字均来自下方原始输出，`[[共 N 处]]` 由脚本用 `wc -l` 自动计数（非手写）；禁 `head` 截断，所有清单为完整输出。
下游读者请以 **B 节 / C 节原文**为准，不要引用 D 节转述。

---

## B. 原始输出 · 主脚本（逐字，未截断，`SCRIPT_EXIT=0`，560 行）

```
=========================== ENV ===========================
pwd   = /d/novis-backup-20260526/Novis/synova-agent/.synova-wt-d947-middleware
HEAD  = f25e61eb105690359dbe13baf64695e5ff1748f0
short = f25e61eb
branch= feat/d947-middleware-default-posture
server.ts 行数 = 520

====================== P0 冻结前提复核 ======================
$ grep -n "app.use(rbacMiddleware)" src/server.ts
373:  app.use(rbacMiddleware);
[exit=0]
[[共 1 处]]

$ grep -n "app.use(jwtAuthMiddleware)" src/server.ts
345:  app.use(jwtAuthMiddleware);
[exit=0]
[[共 1 处]]

$ grep -n "app.use(rateLimitMiddleware)" src/server.ts
353:  app.use(rateLimitMiddleware);
[exit=0]
[[共 1 处]]

$ grep -nE "^export" src/server.ts
92:export const uploadV2GoneRouter: Router = Router().all(
112:export const setupGuideGoneRouter: Router = Router().all(
124:export async function createServer(): Promise<Server> {
[exit=0]
[[共 3 处]]

$ grep -n "extractRbacContext" src/server.ts
19:import { rbacMiddleware, extractRbacContext, canAccessWorkspace, canModifyWorkspace } from './middleware/rbac';
247:  const rbacCtx = extractRbacContext({ headers: { 'x-synova-token': 'admin::dev' } }); // Slice 7 RBAC
[exit=0]
[[共 2 处]]

$ grep -n "admin::dev" src/server.ts
247:  const rbacCtx = extractRbacContext({ headers: { 'x-synova-token': 'admin::dev' } }); // Slice 7 RBAC
[exit=0]
[[共 1 处]]

$ grep -n "void canAccessWorkspace\|void canModifyWorkspace" src/server.ts
248:  void canAccessWorkspace(rbacCtx, { visibility: 'global' });
249:  void canModifyWorkspace(rbacCtx, { visibility: 'global' });
[exit=0]
[[共 2 处]]

$ grep -n "process.exit(1)" src/server.ts
141:    process.exit(1);
[exit=0]
[[共 1 处]]

$ grep -n "app.listen" src/server.ts
476:    const server = app.listen(config.port, () => {
[exit=0]
[[共 1 处]]

--- awk NR>=130 && NR<=148 (Bootstrap 失败分支 + degraded 分支) ---
130:   if (!result.ok) {
131:     logger.error({
132:       aborted: result.aborted,
133:       phases: result.phaseResults.map((r) => ({
134:         name: r.name,
135:         status: r.status,
136:         durationMs: r.durationMs,
137:         errors: r.errors,
138:       })),
139:       degraded: result.services.degradedModules,
140:     }, 'Bootstrap 启动失败 — 服务器将终止');
141:     process.exit(1);
142:   }
143: 
144:   if (result.degraded) {
145:     logger.warn({
146:       degradedModules: result.services.degradedModules,
147:     }, 'Bootstrap 启动完成 — 部分模块降级运行');
148:   }
[exit=0]

--- awk NR>=244 && NR<=250 (自欺块 244-249) ---
244:   // PRD v1.6 Slice 7: workspace-service 接线
245:   buildInheritedContext({ parentId: 'init', department: 'dept', title: 'init', source: 'boss_assigned', parentSummary: 'init' });
246:   detectConflicts([]); // Slice 7 冲突检测初始化
247:   const rbacCtx = extractRbacContext({ headers: { 'x-synova-token': 'admin::dev' } }); // Slice 7 RBAC
248:   void canAccessWorkspace(rbacCtx, { visibility: 'global' });
249:   void canModifyWorkspace(rbacCtx, { visibility: 'global' });
250: 
[exit=0]

====================== P1 中间件行号 ======================
$ grep -nE "app\.use\((rbacMiddleware|jwtAuthMiddleware|rateLimitMiddleware)\)" src/server.ts
345:  app.use(jwtAuthMiddleware);
353:  app.use(rateLimitMiddleware);
373:  app.use(rbacMiddleware);
[exit=0]
[[共 3 处]]

$ grep -nE "app\.use\((sanitizeCheckMiddleware|cors|express\.json)" src/server.ts
329:  app.use(cors());
330:  app.use(express.json({ limit: '10mb' }));
334:  app.use(sanitizeCheckMiddleware);
[exit=0]
[[共 3 处]]

$ grep -n "app.use(" src/server.ts
323:  app.use(setupGuideGoneRouter);
325:  app.use('/app', express.static(path.join(process.cwd(), 'app')));
329:  app.use(cors());
330:  app.use(express.json({ limit: '10mb' }));
334:  app.use(sanitizeCheckMiddleware);
341:  app.use(llmConfigRoutes);
344:  app.use(uploadV2GoneRouter);
345:  app.use(jwtAuthMiddleware);
348:  app.use(authRoutes);
353:  app.use(rateLimitMiddleware);
366:  app.use(homeRoutes);
367:  app.use(chatRoutes);
368:  app.use(workspaceRoutes);
369:  app.use(workspaceDataRoutes); // D74 — 工作台数据 API
370:  app.use(workspacesApiRoutes);
371:  app.use(gaDiagnosisRoutes);
372:  app.use(knowledgeAskRoutes);
373:  app.use(rbacMiddleware);
374:  app.use(deptWorkspaceRoutes);
375:  app.use(actionsApiRoutes);
376:  app.use(dataRoutes);
377:  app.use(dataLifecycleRoutes);
378:  app.use(healthRoutes);
379:  app.use(healthzRoutes);
380:  app.use(evolutionRoutes);
381:  app.use(gaEvolutionRoutes);
382:  app.use(ontologyRoutes);
383:  app.use(ontologyAdminRoutes);
384:  app.use(diagnosisRoutes);
385:  app.use(configRoutes); // D600 — config/dump 挂载（逐层 provenance 检查表面）
386:  app.use(sessionsRoutes);
387:  app.use(conversationsRoutes); // D590 — 对话 SSE 端点（sessionsRoutes 旁，spec §5.1）
388:  app.use(metricsRoutes);
389:  app.use(reviewRoutes);
390:  app.use(expertRoutes);
391:  app.use(agentObserverRoutes);
392:  app.use(imRoutes);
393:  app.use(knowledgeRoutes);
394:  app.use(credentialRoutes);
395:  app.use(documentRoutes);
396:  app.use(permissionRoutes);
397:  app.use('/api/sentinel', sentinelHealthRoutes);
398:  app.use('/api/sentinel', sentinelRoutes);
399:  app.use(reloadRoutes);
400:  app.use(adaptersRoutes);
401:  app.use(auditRoutes);
402:  app.use(gaAdminRoutes);
403:  app.use(adminKnowledgeRoutes);
404:  app.use(gaCorrectionsRoutes);
405:  app.use(gaAnnotationsRoutes);
406:  app.use(gaCalibrationRoutes); // D551 — /api/ga/calibration 端点族
407:  app.use(solutionsRoutes);
408:  app.use(notificationsRoutes);
409:  app.use(backupRoutes);
410:  app.use(selfOpsRoutes);
411:  app.use(enterpriseRoutes); // D103 — 企业路由
412:  app.use(importRoutes); // D231
413:  app.use(loopRoutes); // D20 — 循环状态 API
414:  app.use(cockpitRoutes); // D220-PHASE3 — 创始人仪表盘
415:  app.use(overflowRoutes); // D478 — 溢出仪表盘 API（D476 认证+隔离已就绪；修复 D90 仅 import 未挂载）
453:  app.use((_req, res) => {
[exit=0]
[[共 61 处]]


==================== P4 判别谓词（冻结口径）====================
PAT=app\.use\([A-Za-z0-9_]+(Router|Routes)\)|app\.(get|post|put|patch|delete)\(
L(grep -n 'app.use(rbacMiddleware)' src/server.ts | cut -d: -f1) = 373

--- P4.a 谓词匹配全集（本步不截行、不按行号过滤）---
323:  app.use(setupGuideGoneRouter);
326:  app.get('/', (_req, res) => res.redirect('/app/index.html'));
327:  app.get('/login', (_req, res) => res.redirect('/app/login.html'));
341:  app.use(llmConfigRoutes);
344:  app.use(uploadV2GoneRouter);
348:  app.use(authRoutes);
356:  app.get('/api/status/budget', (req, res) => {
366:  app.use(homeRoutes);
367:  app.use(chatRoutes);
368:  app.use(workspaceRoutes);
369:  app.use(workspaceDataRoutes); // D74 — 工作台数据 API
370:  app.use(workspacesApiRoutes);
371:  app.use(gaDiagnosisRoutes);
372:  app.use(knowledgeAskRoutes);
374:  app.use(deptWorkspaceRoutes);
375:  app.use(actionsApiRoutes);
376:  app.use(dataRoutes);
377:  app.use(dataLifecycleRoutes);
378:  app.use(healthRoutes);
379:  app.use(healthzRoutes);
380:  app.use(evolutionRoutes);
381:  app.use(gaEvolutionRoutes);
382:  app.use(ontologyRoutes);
383:  app.use(ontologyAdminRoutes);
384:  app.use(diagnosisRoutes);
385:  app.use(configRoutes); // D600 — config/dump 挂载（逐层 provenance 检查表面）
386:  app.use(sessionsRoutes);
387:  app.use(conversationsRoutes); // D590 — 对话 SSE 端点（sessionsRoutes 旁，spec §5.1）
388:  app.use(metricsRoutes);
389:  app.use(reviewRoutes);
390:  app.use(expertRoutes);
391:  app.use(agentObserverRoutes);
392:  app.use(imRoutes);
393:  app.use(knowledgeRoutes);
394:  app.use(credentialRoutes);
395:  app.use(documentRoutes);
396:  app.use(permissionRoutes);
399:  app.use(reloadRoutes);
400:  app.use(adaptersRoutes);
401:  app.use(auditRoutes);
402:  app.use(gaAdminRoutes);
403:  app.use(adminKnowledgeRoutes);
404:  app.use(gaCorrectionsRoutes);
405:  app.use(gaAnnotationsRoutes);
406:  app.use(gaCalibrationRoutes); // D551 — /api/ga/calibration 端点族
407:  app.use(solutionsRoutes);
408:  app.use(notificationsRoutes);
409:  app.use(backupRoutes);
410:  app.use(selfOpsRoutes);
411:  app.use(enterpriseRoutes); // D103 — 企业路由
412:  app.use(importRoutes); // D231
413:  app.use(loopRoutes); // D20 — 循环状态 API
414:  app.use(cockpitRoutes); // D220-PHASE3 — 创始人仪表盘
415:  app.use(overflowRoutes); // D478 — 溢出仪表盘 API（D476 认证+隔离已就绪；修复 D90 仅 import 未挂载）
430:  app.post('/api/connector/sync', async (req, res) => {
[exit=0]
[[共 55 处]]

--- P4.b 叠加 grep -v 'res.redirect' 后 ---
323:  app.use(setupGuideGoneRouter);
341:  app.use(llmConfigRoutes);
344:  app.use(uploadV2GoneRouter);
348:  app.use(authRoutes);
356:  app.get('/api/status/budget', (req, res) => {
366:  app.use(homeRoutes);
367:  app.use(chatRoutes);
368:  app.use(workspaceRoutes);
369:  app.use(workspaceDataRoutes); // D74 — 工作台数据 API
370:  app.use(workspacesApiRoutes);
371:  app.use(gaDiagnosisRoutes);
372:  app.use(knowledgeAskRoutes);
374:  app.use(deptWorkspaceRoutes);
375:  app.use(actionsApiRoutes);
376:  app.use(dataRoutes);
377:  app.use(dataLifecycleRoutes);
378:  app.use(healthRoutes);
379:  app.use(healthzRoutes);
380:  app.use(evolutionRoutes);
381:  app.use(gaEvolutionRoutes);
382:  app.use(ontologyRoutes);
383:  app.use(ontologyAdminRoutes);
384:  app.use(diagnosisRoutes);
385:  app.use(configRoutes); // D600 — config/dump 挂载（逐层 provenance 检查表面）
386:  app.use(sessionsRoutes);
387:  app.use(conversationsRoutes); // D590 — 对话 SSE 端点（sessionsRoutes 旁，spec §5.1）
388:  app.use(metricsRoutes);
389:  app.use(reviewRoutes);
390:  app.use(expertRoutes);
391:  app.use(agentObserverRoutes);
392:  app.use(imRoutes);
393:  app.use(knowledgeRoutes);
394:  app.use(credentialRoutes);
395:  app.use(documentRoutes);
396:  app.use(permissionRoutes);
399:  app.use(reloadRoutes);
400:  app.use(adaptersRoutes);
401:  app.use(auditRoutes);
402:  app.use(gaAdminRoutes);
403:  app.use(adminKnowledgeRoutes);
404:  app.use(gaCorrectionsRoutes);
405:  app.use(gaAnnotationsRoutes);
406:  app.use(gaCalibrationRoutes); // D551 — /api/ga/calibration 端点族
407:  app.use(solutionsRoutes);
408:  app.use(notificationsRoutes);
409:  app.use(backupRoutes);
410:  app.use(selfOpsRoutes);
411:  app.use(enterpriseRoutes); // D103 — 企业路由
412:  app.use(importRoutes); // D231
413:  app.use(loopRoutes); // D20 — 循环状态 API
414:  app.use(cockpitRoutes); // D220-PHASE3 — 创始人仪表盘
415:  app.use(overflowRoutes); // D478 — 溢出仪表盘 API（D476 认证+隔离已就绪；修复 D90 仅 import 未挂载）
430:  app.post('/api/connector/sync', async (req, res) => {
[exit=0]
[[共 53 处]]

--- P4.c 基线（L=373）：派单件冻结命令逐字 ---
$ grep -nE "$PAT" src/server.ts | grep -v 'res.redirect' | awk -F: -v L=$(grep -n 'app.use(rbacMiddleware)' src/server.ts | cut -d: -f1) '$1<L {print $1": "$0}'
323: 323:  app.use(setupGuideGoneRouter);
341: 341:  app.use(llmConfigRoutes);
344: 344:  app.use(uploadV2GoneRouter);
348: 348:  app.use(authRoutes);
356: 356:  app.get('/api/status/budget', (req, res) => {
366: 366:  app.use(homeRoutes);
367: 367:  app.use(chatRoutes);
368: 368:  app.use(workspaceRoutes);
369: 369:  app.use(workspaceDataRoutes); // D74 — 工作台数据 API
370: 370:  app.use(workspacesApiRoutes);
371: 371:  app.use(gaDiagnosisRoutes);
372: 372:  app.use(knowledgeAskRoutes);
[exit=0]
[[共 12 处]]

--- P4.d 基线（L=373）仅行号清单（去重复列，便于核对集合）---
323
341
344
348
356
366
367
368
369
370
371
372
[exit=0]

--- P4.e 前移后【只读模拟】L=366（未改任何文件；模拟 rbac 插入原 :366 位置、homeRoutes 下移一行）---
$ grep -nE "$PAT" src/server.ts | grep -v 'res.redirect' | awk -F: -v L=366 '$1<L {print $1": "$0}'
323: 323:  app.use(setupGuideGoneRouter);
341: 341:  app.use(llmConfigRoutes);
344: 344:  app.use(uploadV2GoneRouter);
348: 348:  app.use(authRoutes);
356: 356:  app.get('/api/status/budget', (req, res) => {
[exit=0]
[[共 5 处]]

--- P4.f 前移后模拟 L=366 仅行号清单 ---
323
341
344
348
356
[exit=0]

=========== P4 口径差异：REV-6 字面 awk（无谓词）===========
REV-6 原文（PLAN-REV2.md:115）：
  L=$(grep -n "app.use(rbacMiddleware)" src/server.ts | cut -d: -f1); awk -v L=$L 'NR<L && /app\.(use|get|post|put|patch|delete)\(/ {print NR": "$0}' src/server.ts

--- P4.g 字面口径，基线 L=373 ---
323:   app.use(setupGuideGoneRouter);
325:   app.use('/app', express.static(path.join(process.cwd(), 'app')));
326:   app.get('/', (_req, res) => res.redirect('/app/index.html'));
327:   app.get('/login', (_req, res) => res.redirect('/app/login.html'));
329:   app.use(cors());
330:   app.use(express.json({ limit: '10mb' }));
334:   app.use(sanitizeCheckMiddleware);
341:   app.use(llmConfigRoutes);
344:   app.use(uploadV2GoneRouter);
345:   app.use(jwtAuthMiddleware);
348:   app.use(authRoutes);
353:   app.use(rateLimitMiddleware);
356:   app.get('/api/status/budget', (req, res) => {
366:   app.use(homeRoutes);
367:   app.use(chatRoutes);
368:   app.use(workspaceRoutes);
369:   app.use(workspaceDataRoutes); // D74 — 工作台数据 API
370:   app.use(workspacesApiRoutes);
371:   app.use(gaDiagnosisRoutes);
372:   app.use(knowledgeAskRoutes);
[exit=0]
[[共 20 处]]

--- P4.h 字面口径，前移后模拟 L=366 ---
323:   app.use(setupGuideGoneRouter);
325:   app.use('/app', express.static(path.join(process.cwd(), 'app')));
326:   app.get('/', (_req, res) => res.redirect('/app/index.html'));
327:   app.get('/login', (_req, res) => res.redirect('/app/login.html'));
329:   app.use(cors());
330:   app.use(express.json({ limit: '10mb' }));
334:   app.use(sanitizeCheckMiddleware);
341:   app.use(llmConfigRoutes);
344:   app.use(uploadV2GoneRouter);
345:   app.use(jwtAuthMiddleware);
348:   app.use(authRoutes);
353:   app.use(rateLimitMiddleware);
356:   app.get('/api/status/budget', (req, res) => {
[exit=0]
[[共 13 处]]

==================== P3 引用/调用方扫描 ====================
$ grep -rn "canAccessWorkspace\|canModifyWorkspace" src/ tests/
src/middleware/rbac.ts:201:export function canAccessWorkspace(ctx: RbacContext, ws: {
src/middleware/rbac.ts:243:export function canModifyWorkspace(ctx: RbacContext, ws: {
src/routes/workspaces-api.ts:12:import { extractRbacContext, canAccessWorkspace } from '../middleware/rbac';
src/routes/workspaces-api.ts:132:  if (!canAccessWorkspace(ctx, { visibility: ws.visibility, department: ws.department, owner: ws.owner })) {
src/server.ts:19:import { rbacMiddleware, extractRbacContext, canAccessWorkspace, canModifyWorkspace } from './middleware/rbac';
src/server.ts:248:  void canAccessWorkspace(rbacCtx, { visibility: 'global' });
src/server.ts:249:  void canModifyWorkspace(rbacCtx, { visibility: 'global' });
tests/middleware/auth.integration.test.ts:26:import { rbacMiddleware, canModifyWorkspace } from '../../src/middleware/rbac';
tests/middleware/auth.integration.test.ts:57:    if (!canModifyWorkspace(ctx, { department: 'default' })) {
tests/middleware/rbac-ga-boundary.test.ts:9:  canAccessWorkspace, canModifyWorkspace, canDownloadRawData,
tests/middleware/rbac-ga-boundary.test.ts:19:  it('isFrozen=true → canAccessWorkspace false', () => {
tests/middleware/rbac-ga-boundary.test.ts:21:    expect(canAccessWorkspace(ctx, {})).toBe(false);
tests/middleware/rbac-ga-boundary.test.ts:26:    expect(canAccessWorkspace(ctx, {})).toBe(true);
tests/middleware/rbac-ga-boundary.test.ts:36:  it('过期合同 → canAccessWorkspace false', () => {
tests/middleware/rbac-ga-boundary.test.ts:38:    expect(canAccessWorkspace(ctx, {})).toBe(false);
tests/middleware/rbac-ga-boundary.test.ts:43:    expect(canAccessWorkspace(ctx, {})).toBe(true);
tests/middleware/rbac.test.ts:2:import { extractRbacContext, canAccessWorkspace, canModifyWorkspace, derivePermissions, BUILTIN_TEMPLATES, type RbacContext } from '../../src/middleware/rbac';
tests/middleware/rbac.test.ts:41:describe('canAccessWorkspace', () => {
tests/middleware/rbac.test.ts:45:    expect(canAccessWorkspace(r('admin'), { visibility: 'global' })).toBe(true);
tests/middleware/rbac.test.ts:46:    expect(canAccessWorkspace(r('admin'), { visibility: 'department', department: 'marketing' })).toBe(true);
tests/middleware/rbac.test.ts:47:    expect(canAccessWorkspace(r('admin'), { visibility: 'private', owner: 'bob' })).toBe(true);
tests/middleware/rbac.test.ts:51:    expect(canAccessWorkspace(r('liaison'), { visibility: 'global' })).toBe(true);
tests/middleware/rbac.test.ts:52:    expect(canAccessWorkspace(r('liaison'), { visibility: 'department', department: 'sales' })).toBe(true);
tests/middleware/rbac.test.ts:53:    expect(canAccessWorkspace(r('liaison'), { visibility: 'private', owner: 'bob' })).toBe(true);
tests/middleware/rbac.test.ts:57:    expect(canAccessWorkspace(r('manager', 'marketing'), { visibility: 'department', department: 'marketing' })).toBe(true);
tests/middleware/rbac.test.ts:61:    expect(canAccessWorkspace(r('manager', 'marketing'), { visibility: 'department', department: 'sales' })).toBe(false);
tests/middleware/rbac.test.ts:65:    expect(canAccessWorkspace(r('manager', 'marketing'), { visibility: 'global' })).toBe(false);
tests/middleware/rbac.test.ts:69:    expect(canAccessWorkspace(r('manager', 'marketing'), { visibility: 'private', owner: 'u' })).toBe(true);
tests/middleware/rbac.test.ts:73:    expect(canAccessWorkspace(r('manager', 'marketing'), { visibility: 'private', owner: 'bob' })).toBe(false);
tests/middleware/rbac.test.ts:77:describe('canModifyWorkspace', () => {
tests/middleware/rbac.test.ts:81:    expect(canModifyWorkspace(r('admin'), { department: 'sales' })).toBe(true);
tests/middleware/rbac.test.ts:85:    expect(canModifyWorkspace(r('manager', 'marketing'), { department: 'marketing' })).toBe(true);
tests/middleware/rbac.test.ts:89:    expect(canModifyWorkspace(r('manager'), { department: 'sales', owner: 'u' })).toBe(true);
tests/middleware/rbac.test.ts:93:    expect(canModifyWorkspace(r('manager'), { department: 'sales', owner: 'bob' })).toBe(false);
tests/middleware/rbac.test.ts:97:    expect(canModifyWorkspace(r('liaison'), { department: 'marketing' })).toBe(false);
tests/middleware/rbac.test.ts:109:    expect(canAccessWorkspace(r('ga'), { visibility: 'global' })).toBe(true);
tests/middleware/rbac.test.ts:110:    expect(canAccessWorkspace(r('ga'), { visibility: 'department', department: 'sales' })).toBe(true);
tests/middleware/rbac.test.ts:111:    expect(canAccessWorkspace(r('ga'), { visibility: 'private', owner: 'bob' })).toBe(true);
tests/middleware/rbac.test.ts:115:    expect(canModifyWorkspace(r('ga'), { department: 'marketing' })).toBe(false);
tests/middleware/rbac.test.ts:116:    expect(canModifyWorkspace(r('ga'), { department: 'sales', owner: 'ga_001' })).toBe(false);
[exit=0]
[[共 40 处]]

$ grep -rn "extractRbacContext" src/ tests/
src/middleware/rbac.ts:97:export function extractRbacContext(req: {
src/middleware/rbac.ts:259:  (req as Request & { rbac: RbacContext }).rbac = extractRbacContext(req);
src/routes/workspaces-api.ts:12:import { extractRbacContext, canAccessWorkspace } from '../middleware/rbac';
src/routes/workspaces-api.ts:131:  const ctx = extractRbacContext(req);
src/server.ts:19:import { rbacMiddleware, extractRbacContext, canAccessWorkspace, canModifyWorkspace } from './middleware/rbac';
src/server.ts:247:  const rbacCtx = extractRbacContext({ headers: { 'x-synova-token': 'admin::dev' } }); // Slice 7 RBAC
tests/middleware/rbac.test.ts:2:import { extractRbacContext, canAccessWorkspace, canModifyWorkspace, derivePermissions, BUILTIN_TEMPLATES, type RbacContext } from '../../src/middleware/rbac';
tests/middleware/rbac.test.ts:11:describe('extractRbacContext', () => {
tests/middleware/rbac.test.ts:13:    const ctx = extractRbacContext(mockReq('admin::dev') as any);
tests/middleware/rbac.test.ts:19:    const ctx = extractRbacContext(mockReq('manager:marketing:alice') as any);
tests/middleware/rbac.test.ts:26:    const ctx = extractRbacContext(mockReq('liaison::coordinator') as any);
tests/middleware/rbac.test.ts:31:    const ctx = extractRbacContext(mockReq('') as any);
tests/middleware/rbac.test.ts:36:    const ctx = extractRbacContext(mockReq('some-random-token') as any);
tests/middleware/rbac.test.ts:103:    const ctx = extractRbacContext({ auth: { sub: 'ga_001', role: 'ga', orgId: 'org-1' } } as any);
tests/middleware/rbac.test.ts:119:  it('extractRbacContext: JWT auth takes priority over x-synova-token', () => {
tests/middleware/rbac.test.ts:120:    const ctx = extractRbacContext({
[exit=0]
[[共 16 处]]

$ grep -rn "x-synova-token" src/ tests/
src/middleware/auth.ts:378: *   2. x-synova-token header（向下兼容旧格式）
src/middleware/auth.ts:394:  // 向下兼容 x-synova-token 格式
src/middleware/auth.ts:395:  const token = req.headers?.['x-synova-token'] as string | undefined;
src/middleware/rbac.ts:110:  const token = String((req.headers?.['x-synova-token'] as string) || (req.query?.token as string) || '');
src/routes/department-workspace.ts:13:  const token = String(_req.headers['x-synova-token'] || _req.query.token || '');
src/routes/department-workspace.ts:75:  try{const r=await fetch(API+'/api/workspaces/mine',{headers:{'x-synova-token':'manager:'+DEPT+':user'}});const d=await r.json();
src/routes/workspaces-api.ts:178:  const token = String(req.headers['x-synova-token'] || '');
src/server.ts:247:  const rbacCtx = extractRbacContext({ headers: { 'x-synova-token': 'admin::dev' } }); // Slice 7 RBAC
tests/middleware/auth.test.ts:383:  it('支持 x-synova-token 向下兼容', () => {
tests/middleware/auth.test.ts:384:    const req = { headers: { 'x-synova-token': 'admin:dev:user1' } };
tests/middleware/auth.test.ts:391:  it('x-synova-token 格式不对时返回 null', () => {
tests/middleware/auth.test.ts:392:    const req = { headers: { 'x-synova-token': 'not-a-valid-format' } };
tests/middleware/auth.test.ts:397:  it('legacy x-synova-token 缺 orgId 段 + SYNOVA_ORG_ID 已配置 → orgId 取配置值（D479）', () => {
tests/middleware/auth.test.ts:402:      const req = { headers: { 'x-synova-token': 'admin::user1' } };
tests/middleware/auth.test.ts:411:      const fallback = extractAuthFromRequest({ headers: { 'x-synova-token': 'admin::user2' } } as never);
tests/middleware/rbac.test.ts:8:  return { headers: { 'x-synova-token': token }, query: {} };
tests/middleware/rbac.test.ts:119:  it('extractRbacContext: JWT auth takes priority over x-synova-token', () => {
tests/middleware/rbac.test.ts:121:      headers: { 'x-synova-token': 'admin:dev:user1' },
tests/routes/department-workspace.test.ts:29:    const req = { headers: { 'x-synova-token': 'manager:marketing:alice' }, query: {} };
tests/routes/diagnosis-report-persistence.test.ts:337:    // （extractAuthFromRequest）。桌面 GA 实际形态 = D556 seed 的 x-synova-token 头
tests/routes/diagnosis-report-persistence.test.ts:341:      headers: { 'x-synova-token': 'ga:org-d593:u1' },
tests/routes/ga-auth.test.ts:7: *   - legacy x-synova-token header 向下兼容路径（middleware/auth 既有语义，提取不回改验证）
tests/routes/ga-auth.test.ts:77:  it('legacy x-synova-token header 路径: ga:org:userId 放行（middleware/auth 既有语义不回改）', async () => {
tests/routes/ga-auth.test.ts:80:    const ok = requireGa(makeReq(undefined, { 'x-synova-token': 'ga:org-d551:ga-legacy' }), res);
tests/routes/overflow.test.ts:72:/** 构造带 JWT auth 的 mock 请求（headers 无 x-synova-token，auth 走 JWT 注入路径） */
[exit=0]
[[共 25 处]]

$ grep -rn "rbacMiddleware" src/ tests/
src/middleware/rbac.ts:258:export function rbacMiddleware(req: Request, _res: Response, next: NextFunction): void {
src/server.ts:19:import { rbacMiddleware, extractRbacContext, canAccessWorkspace, canModifyWorkspace } from './middleware/rbac';
src/server.ts:373:  app.use(rbacMiddleware);
tests/middleware/auth.integration.test.ts:26:import { rbacMiddleware, canModifyWorkspace } from '../../src/middleware/rbac';
tests/middleware/auth.integration.test.ts:46:  app.use(rbacMiddleware);
[exit=0]
[[共 5 处]]

$ grep -rn "req\.rbac\|res\.locals\.rbac" src/ tests/
[exit=1]
[[共 0 处]]


==================== P8 运行时探针可行性 ====================
$ grep -rn "PORT" src/config.ts
107:  const port = parseInt(process.env.PORT || String(filePort || 3000), 10);
[exit=0]
[[共 1 处]]

$ grep -rn "createServer" src/ tests/ --include=*.ts
src/agent/synova-agent.ts:18:import { createServer } from '../server';
src/agent/synova-agent.ts:51:    this.server = await createServer();
src/index.ts:11: *   → createServer() (HTTP) + SentinelRunner (Cron 哨兵)
src/init/engine-context.ts:56:  // 幂等：SynovaAgent.start() 和 createServer() 都可能调用
src/server.ts:104:// 形态对齐 D590 先例（uploadV2GoneRouter）。挂载点必须早于 /app 静态挂载（createServer 内
src/server.ts:124:export async function createServer(): Promise<Server> {
tests/agent/tool-loop-tool-pairing.integration.test.ts:6: *   - 真实 bootstrap（src/server.ts createServer）+ 真实 express 路由
tests/agent/tool-loop-tool-pairing.integration.test.ts:32:import { createServer } from '../../src/server';
tests/agent/tool-loop-tool-pairing.integration.test.ts:203:      server: 'src/server.ts createServer()（真实 bootstrap）',
tests/agent/tool-loop-tool-pairing.integration.test.ts:288:  // bootstrap 假上游：仅承接 createServer 启动期的健康检查（GET /models）；场景各自另起实例
tests/agent/tool-loop-tool-pairing.integration.test.ts:292:  server = await createServer();
tests/agent/tool-loop-tool-pairing.integration.test.ts:294:  if (addr === null || typeof addr === 'string') throw new Error('createServer 未返回可解析的监听地址');
tests/agent/tool-loop-tool-pairing.integration.test.ts:310:describe('D819 工具接线（真实 createServer + 真实路由 + 假上游，零 mock 管线）', () => {
tests/agent-observer/report.integration.test.ts:9:import { createServer } from '../../src/server';
tests/agent-observer/report.integration.test.ts:19:  server = await createServer();
tests/e2e/ima-knowledge-e2e.test.ts:14:import { createServer } from '../../src/server';
tests/e2e/ima-knowledge-e2e.test.ts:30:  server = await createServer();
tests/electron/backend-spawn.test.ts:35:    const server = http.createServer((_req, res) => {
tests/electron/backend-spawn.test.ts:138:    const always503 = http.createServer((_req, res) => { res.statusCode = 503; res.end('down'); });
tests/electron/backend-spawn.test.ts:171:    const free = http.createServer();
tests/electron/backend-spawn.test.ts:475:    fs.writeFileSync(stub, `const http = require('http');\nconst t0 = Date.now();\nhttp.createServer((q, s) => {\n  if (Date.now() - t0 < 800) { s.statusCode = 503; s.end('starting'); return; }\n  s.statusCode = 200; s.end('{"status":"healthy"}');\n}).listen(${port}, '127.0.0.1');\n`);
tests/golden-scenarios/fixtures/dummy-server.ts:11:const server = http.createServer((req, res) => {
tests/helpers/fake-llm-upstream.ts:5: * 生产管线（createServer bootstrap → express 真实路由 → ConversationEngine → tool-loop →
tests/helpers/fake-llm-upstream.ts:22:import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
tests/integration/production-entry-conversation.integration.test.ts:5: * 铁律 12：起**真实** createServer（src/server.ts:124 真实 bootstrap + 真实 SQLite + 真实 express 路由）
tests/integration/production-entry-conversation.integration.test.ts:36:import { createServer } from '../../src/server';
tests/integration/production-entry-conversation.integration.test.ts:143:      server: 'src/server.ts:124 createServer()（真实 bootstrap；app.locals.orchestration 由 server.ts:286 装配）',
tests/integration/production-entry-conversation.integration.test.ts:224:  server = await createServer();
tests/integration/production-entry-conversation.integration.test.ts:226:  if (addr === null || typeof addr === 'string') throw new Error('createServer 未返回可解析的监听地址');
tests/integration/production-entry-conversation.integration.test.ts:241:describe('D817 生产入口级对话（真实 createServer + 真实路由 + 假上游）', () => {
tests/l1/qa-router.test.ts:7:import { createServer } from '../../src/server';
tests/l1/qa-router.test.ts:20:  server = await createServer();
tests/l3/e2e-autonomy.integration.test.ts:29:  // Minimal Express server for E2E test — not using full createServer to isolate
tests/metrics.test.ts:5:import { createServer } from '../src/server';
tests/metrics.test.ts:17:  server = await createServer();
tests/middleware/auth.integration.test.ts:4: * 测试完整的 JWT + RBAC 中间件链路，不依赖 createServer() 全部初始化。
tests/routes/llm-config.test.ts:9: * 铁律 12: createServer() + PORT=0 + 真实 fetch 走真实路由，不 mock 管线。
tests/routes/llm-config.test.ts:10: * Stub 上游 = node http.createServer 按 Authorization 分支返回（真实 HTTP 全链路，不 mock fetch）。
tests/routes/llm-config.test.ts:14:import { createServer } from '../../src/server';
tests/routes/llm-config.test.ts:16:import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
tests/routes/llm-config.test.ts:90:  server = await createServer();
tests/routes/sentinel-tickets.test.ts:79:    server = http.createServer(app);
tests/routes/setup-guide-retired.test.ts:250:      expect(encodedBody).not.toContain('createServer');
tests/routes/workspace-data.test.ts:38:    const server = http.createServer(app);
tests/sessions-api.test.ts:5:import { createServer } from '../src/server';
tests/sessions-api.test.ts:16:  server = await createServer();
tests/smoke.test.ts:9:import { createServer } from '../src/server';
tests/smoke.test.ts:19:  server = await createServer();
[exit=0]
[[共 48 处]]


==================== 收尾：工作树洁净度 ====================
$ git status --short
?? .claude/task-briefs/2026-09-24-D947-middleware-default-posture.md
?? docs/synova/product-lines/evidence/D947-20260924/
[exit=0]
[[共 2 处]]

=========================== END ===========================
```

---

## C. 原始输出 · 补充取证（逐字，未截断，`SUPP_EXIT=0`，66 行）

```
### S1  谁能承接 /health 与 /healthz —— 路由定义处
$ grep -rn "health" src/routes/health.ts src/routes/healthz.ts | grep -E "router\.(get|post)|\.get\(\x27"
src/routes/health.ts:16:router.get('/health', (_req, res) => {
src/routes/healthz.ts:323:router.get('/api/healthz', async (_req, res) => {
[exit=0]

### S2  /api/knowledge/ask 路由定义处
$ grep -rn "ask" src/routes/knowledge-ask.ts
2: * knowledge-ask.ts — 知识问答全局入口 (PRD v1.6 Slice 6)
4: * GET  /api/knowledge/ask?q=... → 返回答案+来源+可选操作
5: * POST /api/knowledge/ask → { question } → 返回答案+来源+可选操作
10:const log = createLogger('routes/knowledge-ask');
13:router.get('/api/knowledge/ask', async (req: Request, res: Response) => {
22:router.post('/api/knowledge/ask', async (req: Request, res: Response) => {
[exit=0]

### S3  REV-6 命令③ 引用的测试文件是否存在（全仓库 find，排除 node_modules）
$ find . -name 'workspace-access-write-endpoint*' -not -path '*/node_modules/*'
[exit=0]

### S4  P4/P6 待新建夹具是否已存在
$ find . -name 'middleware-order*' -not -path '*/node_modules/*'
[exit=0]

### S5  canModifyWorkspace 在 src/ 内的全部出现（定义处亦列出）
$ grep -rn 'canModifyWorkspace' src/
src/middleware/rbac.ts:243:export function canModifyWorkspace(ctx: RbacContext, ws: {
src/server.ts:19:import { rbacMiddleware, extractRbacContext, canAccessWorkspace, canModifyWorkspace } from './middleware/rbac';
src/server.ts:249:  void canModifyWorkspace(rbacCtx, { visibility: 'global' });
[exit=0]
$ grep -rn 'canModifyWorkspace' src/ | grep -v 'export function canModifyWorkspace'
src/server.ts:19:import { rbacMiddleware, extractRbacContext, canAccessWorkspace, canModifyWorkspace } from './middleware/rbac';
src/server.ts:249:  void canModifyWorkspace(rbacCtx, { visibility: 'global' });
[exit=0]

### S6  canAccessWorkspace 在 src/ 内的全部出现（定义处亦列出）
$ grep -rn 'canAccessWorkspace' src/
src/middleware/rbac.ts:201:export function canAccessWorkspace(ctx: RbacContext, ws: {
src/routes/workspaces-api.ts:12:import { extractRbacContext, canAccessWorkspace } from '../middleware/rbac';
src/routes/workspaces-api.ts:132:  if (!canAccessWorkspace(ctx, { visibility: ws.visibility, department: ws.department, owner: ws.owner })) {
src/server.ts:19:import { rbacMiddleware, extractRbacContext, canAccessWorkspace, canModifyWorkspace } from './middleware/rbac';
src/server.ts:248:  void canAccessWorkspace(rbacCtx, { visibility: 'global' });
[exit=0]
$ grep -rn 'canAccessWorkspace' src/ | grep -v 'export function canAccessWorkspace'
src/routes/workspaces-api.ts:12:import { extractRbacContext, canAccessWorkspace } from '../middleware/rbac';
src/routes/workspaces-api.ts:132:  if (!canAccessWorkspace(ctx, { visibility: ws.visibility, department: ws.department, owner: ws.owner })) {
src/server.ts:19:import { rbacMiddleware, extractRbacContext, canAccessWorkspace, canModifyWorkspace } from './middleware/rbac';
src/server.ts:248:  void canAccessWorkspace(rbacCtx, { visibility: 'global' });
[exit=0]

### S7  tests/routes 内 workspace 相关测试文件清单
$ ls tests/routes/ | grep -i workspace
department-workspace.test.ts
workspace-data.test.ts
workspace.test.ts
[exit=0]

### S8  分支同步回执
$ git rev-list --left-right --count origin/main...HEAD
0	0
[exit=0]
$ git status --porcelain
?? .claude/task-briefs/2026-09-24-D947-middleware-default-posture.md
?? docs/synova/product-lines/evidence/D947-20260924/
[exit=0]
=== SUPP END ===
```

---

## D. 逐条对账（声称 ↔ 证据）

### D-1 冻结前提复核 —— 8 条全部成立

| # | 冻结前提（队长实测） | 命令 | 原始结果 | 判定 |
|---|---|---|---|---|
| 1 | `rbac@373` | `grep -n 'app.use(rbacMiddleware)' src/server.ts` | `373:  app.use(rbacMiddleware);`（共 1 处） | ✅ 成立 |
| 2 | `jwtAuth@345` | `grep -n 'app.use(jwtAuthMiddleware)' src/server.ts` | `345:  app.use(jwtAuthMiddleware);`（共 1 处） | ✅ 成立 |
| 3 | `rateLimit@353` | `grep -n 'app.use(rateLimitMiddleware)' src/server.ts` | `353:  app.use(rateLimitMiddleware);`（共 1 处） | ✅ 成立 |
| 4 | 路由注册前移前 **12** | P4.c 冻结谓词逐字命令 | `[[共 12 处]]` = `323/341/344/348/356/366/367/368/369/370/371/372` | ✅ 成立 |
| 5 | `server.ts:247` 硬编码 `admin::dev` | `grep -n 'admin::dev' src/server.ts` | `247:  const rbacCtx = extractRbacContext({ headers: { 'x-synova-token': 'admin::dev' } });`（共 1 处） | ✅ 成立 |
| 6 | `:248` `void canAccessWorkspace` / `:249` `void canModifyWorkspace` | `grep -n 'void canAccessWorkspace\|void canModifyWorkspace' src/server.ts` | `248:  void canAccessWorkspace(rbacCtx, { visibility: 'global' });` / `249:  void canModifyWorkspace(rbacCtx, { visibility: 'global' });`（共 2 处） | ✅ 成立 |
| 7 | `createServer()` 导出 @124 | `grep -nE '^export' src/server.ts` | `92` / `112` / `124`（导出面共 **3 处**；`124:export async function createServer(): Promise<Server> {`） | ✅ 成立 |
| 8 | `createServer()` 内 `app.listen(config.port)`；Bootstrap 失败 `process.exit(1)` | `grep -n 'app.listen'` + `grep -n 'process.exit(1)'` + `awk NR 130..148` | `476:    const server = app.listen(config.port, () => {`；`141:    process.exit(1);`（位于 `130: if (!result.ok) {` 块内，块尾 `142`） | ✅ 成立 |

### D-2 P4 基线 = 12（冻结谓词口径，逐字复现）

- 命令（派单件冻结，逐字）：见 B 节 **P4.c**。
- 原始计数：`[[共 12 处]]`
- 集合（B 节 **P4.d** 仅行号清单）：`323 341 344 348 356 366 367 368 369 370 371 372`
- 分解：**豁免 5 处** = `{323 setupGuideGoneRouter, 341 llmConfigRoutes, 344 uploadV2GoneRouter, 348 authRoutes, 356 内联 GET /api/status/budget}`；**rbac 之后 7 处** = `{366 homeRoutes, 367 chatRoutes, 368 workspaceRoutes, 369 workspaceDataRoutes, 370 workspacesApiRoutes, 371 gaDiagnosisRoutes, 372 knowledgeAskRoutes}`。5 + 7 = 12，自洽。
- ⇒ **基线 12 成立。**

### D-3 前移后 = 5 —— ⚠️ **只读模拟值，不是实测值**

- 命令：B 节 **P4.e**（同一谓词，把 `L` 代入目标行 `366`；**未改动任何文件**）
- 原始计数：`[[共 5 处]]` = `{323, 341, 344, 348, 356}`（B 节 **P4.f** 行号清单）
- 与派单件豁免集**逐行一致**。
- ⚠️ **性质声明**：这是**模拟**。C 节 S8 的 `git status --porcelain` 只有两条 untracked，`src/server.ts` 未被触碰 ⇒ 「前移后 5」尚未被实测验证，须在 PR-2a 实施后由**独立自验员**重跑 P4.c 复核。

### D-4 ⚠️ REV-6 字面 awk 命令的口径差异（本任务要求点明）

REV-6 原文（`PLAN-REV2.md:115`）：`L=$(grep -n "app.use(rbacMiddleware)" src/server.ts | cut -d: -f1); awk -v L=$L 'NR<L && /app\.(use|get|post|put|patch|delete)\(/ {print NR": "$0}' src/server.ts` —— **不带谓词**。

| 口径 | 基线 | 前移后（`L=366` 模拟） | 证据 |
|---|---|---|---|
| **冻结谓词**（`app.use(<Name>Router\|Routes)` 或 `app.get/post/put/patch/delete(`，再 `grep -v 'res.redirect'`） | **12** | **5** | B 节 P4.c / P4.e |
| **REV-6 字面 awk**（仅 `app.(use\|get\|post\|put\|patch\|delete)(`） | **20** | **13** | B 节 P4.g / P4.h |

两口径之差恒为 **8 处**，多出的 8 行逐行点名（B 节 **P4.g** 原文）：

| 行 | 内容 | 为何不应计入「路由挂载」 |
|---|---|---|
| 325 | `app.use('/app', express.static(path.join(process.cwd(), 'app')));` | 全局静态目录挂载 |
| 326 | `app.get('/', (_req, res) => res.redirect('/app/index.html'));` | redirect 页，非路由注册 |
| 327 | `app.get('/login', (_req, res) => res.redirect('/app/login.html'));` | redirect 页，非路由注册 |
| 329 | `app.use(cors());` | 全局中间件 |
| 330 | `app.use(express.json({ limit: '10mb' }));` | 全局中间件 |
| 334 | `app.use(sanitizeCheckMiddleware);` | 全局中间件 |
| 345 | `app.use(jwtAuthMiddleware);` | 全局中间件（认证） |
| 353 | `app.use(rateLimitMiddleware);` | 全局中间件（限流） |

⇒ **REV-6 命令① 不能作为「前移后仅剩 5 行」的判据**：前移后它给 **13**（≠5），且其中 8 处是全局中间件与两条 redirect，与「路由注册」判据无关。照字面执行，P4 要么**被永久判红**（13 ≠ 5），要么**被错误放宽**。
⇒ **建议**：REV-6 §P3+P4 命令① 正名为冻结谓词版（派单件 §2 已给出）。
⇒ 本条同时**复现并解释了**审计件 `D947-T-V-verifier-raw-evidence.md:241` 记录的 F1「文字判据数到 **20**，基线却写 **12**」——两数之差正是上述 8 行，**不是**基线写错。

### D-5 谓词盲区（P4 判据的表述边界，须写明）

冻结谓词只覆盖 `app.use(<标识符>)` 形式，**不覆盖** `app.use('<path>', <router>)` 带路径前缀的挂载：
- `325` `app.use('/app', express.static(...))`
- `397` `app.use('/api/sentinel', sentinelHealthRoutes);`
- `398` `app.use('/api/sentinel', sentinelRoutes);`
- `453` `app.use((_req, res) => { ... })`（404 兜底 handler）

⇒ **P4 的正确表述**是「rbac 之前，`app.use(<Router/Routes 标识符>)` 与 `app.get/post/...(` 形式的**路由注册**仅剩豁免集」，**不能**表述为「rbac 之前全部挂载仅剩 5」。
⇒ 在 rbac 之前的区域内，盲区**只有 `325`**（`/app` 静态目录，本即全局中间件），故对「12 → 5」判据**无实质影响**；但表述必须收窄。

### D-6 P3 接线真相（P3/P4 成对验收的物理依据）

| 侦察项 | 命令 | 原始结果 | 含义 |
|---|---|---|---|
| `req.rbac` 消费者 | `grep -rn 'req\.rbac\|res\.locals\.rbac' src/ tests/` | `[exit=1] [[共 0 处]]` | **零消费者** ⇒ 前移 rbac 是**行为空操作**（与 `PLAN.md:231` N2 一致） |
| `rbacMiddleware` 本体 | `src/middleware/rbac.ts:257-261`（read 全文核对） | `(req as Request & { rbac: RbacContext }).rbac = extractRbacContext(req);` + `next();` | 仅**注入 + next()**：无白名单、无 401/403 ⇒ 当前 **fail-open** |
| 无 token 时的默认上下文 | `src/middleware/rbac.ts:119` | `return { role: 'admin', userId: DEFAULT_USER };` | **无凭证默认 admin** —— fail-open 根因 |
| `rbacMiddleware` 全部引用 | B 节 P6 | `rbac.ts:258`（定义）· `server.ts:19`（import）· `server.ts:373`（挂载）· `tests/middleware/auth.integration.test.ts:26,46` → 共 5 处 | 无第三方消费者 |
| `extractRbacContext` 生产消费者 | B 节 P3 | `rbac.ts:259`（rbacMiddleware 内）· `routes/workspaces-api.ts:131` · `server.ts:247`（待删） | 删 `server.ts:247` 后该 import 在 server.ts 内**变成未使用** ⇒ 必须收窄 `server.ts:19` |

### D-7 自欺块（244-249）删除后的引用面 —— PR-2a 写集风险点

- **`canAccessWorkspace`**（C 节 S6）：`src/` 内共 5 处 = `rbac.ts:201`（定义）· `routes/workspaces-api.ts:12`（import）· `routes/workspaces-api.ts:132`（**真实生产调用** `if (!canAccessWorkspace(...))`）· `server.ts:19`（import）· `server.ts:248`（待删 `void`）。
  ⇒ 删 `:248` 后**仍有生产调用方**，不产生死代码。
- **`canModifyWorkspace`**（C 节 S5）：`src/` 内共 3 处 = `rbac.ts:243`（定义）· `server.ts:19`（import）· `server.ts:249`（待删 `void`）。
  ⇒ 删 `:249` 后 **`src/` 内零调用方**；生产引用只剩测试（`tests/middleware/auth.integration.test.ts:57`、`tests/middleware/rbac.test.ts:77+`、`tests/middleware/rbac-ga-boundary.test.ts:9`）。
  ⇒ **需队长裁决（见 D-9 F-4）**：是否落在铁律 37（dead code 入仓库即违规）射程内。code-b 的读法是「**不是**」——函数本体未删、仍有测试引用、且属 PR-1 的公开能力面。但 `server.ts:19` 的 import **必须**收窄（否则 `canModifyWorkspace` 以「已 import 未使用」形态残留，可能触发 tsc `noUnusedLocals` / oxlint）。

### D-8 P8 运行时探针可行性 —— **成立**（附一个必须先告知队长的风险）

**端口注入缝（逐字）**：
- `src/config.ts:107` → `const port = parseInt(process.env.PORT || String(filePort || 3000), 10);`
- `src/config.ts:121` → 返回值 `{ port, devMode, dbPath, orgId, ... }` 中**直接是 `port`，无二次 `|| 3000` 兜底**
- ⇒ `process.env.PORT = '0'` ⇒ `config.port === 0` ⇒ `app.listen(0)`（`server.ts:476`）由 OS 分配临时端口 ⇒ **探针可行**

**先例骨架要点**（`tests/routes/llm-config.test.ts`，已 read 全文 324 行）：

1. **环境隔离**（`:38-49`）：先存原值到 `savedEnv`（`SYNOVA_DATA_DIR`/`DEV_MODE`/`LLM_API_KEY`/`SYNOVA_LLM_TEST_TIMEOUT_MS`），再设 `DEV_MODE='true'` · `PORT='0'` · `SYNOVA_DB_PATH=':memory:'` · `SYNOVA_DATA_DIR = mkdtempSync(join(tmpdir(), 'synova-d575-api-'))` · `delete process.env.LLM_API_KEY`。
2. **真起服务**（`:90-93`）：`server = await createServer();` → `const addr = server.address(); const port = typeof addr === 'object' && addr ? addr.port : 3098;` → `BASE = \`http://localhost:${port}\``。
3. **真打 HTTP**（`:117-124` 等全部用例）：断言只走 `await fetch(\`${BASE}/api/llm/config\`)`，**不 mock fetch、不 mock 管线**（铁律 12）。
4. **stub 上游**（`:52-82`）：用 `node:http` 的 `createServer` 起**真实** HTTP 服务、按 `Authorization` 分支返回，`upstream.listen(0, '127.0.0.1', resolve)` 后取 `.address().port` —— 需要外部依赖时用真链路替身。
5. **teardown**（`:96-105`）：`server.close()` + `upstream.close()` + `rmSync(tmpDataDir, { recursive: true, force: true })` + 逐项还原 `savedEnv`。
6. **超时注入缝**（`:223-232`）：`process.env.SYNOVA_LLM_TEST_TIMEOUT_MS = '300'` 缩短等待，`finally` 中 `delete` ——「注入缝缩短等待、默认值不变」的写法可复用。

⚠️ **风险（PR-2a 夹具设计必须先处理）**：`createServer()` 内部 `boot.run()` 失败会走 `server.ts:130-142` 的 `process.exit(1)`。在测试进程里这**不是抛异常，而是直接杀进程** —— vitest 会呈现为进程异常退出（拿不到期望的断言失败摘要），排障成本高。`llm-config.test.ts` 正是靠「`DEV_MODE=true` + `:memory:` DB + tmp data dir」规避 bootstrap 失败。`middleware-order.test.ts` 必须同样规避；建议夹具在 `beforeAll` 里**先打一条 bootstrap 健康探针**（`/health` 定义在 `src/routes/health.ts:16`，`/api/healthz` 定义在 `src/routes/healthz.ts:323`，见 C 节 S1），以便把「bootstrap 挂了」与「rbac 前移后断言不符」两类红区分开。

### D-9 需队长裁决 / 需写进卡面的事项（★ 影响 PR-2a 可执行性）

| 编号 | 发现 | 证据 | 对 PR-2a 的影响 |
|---|---|---|---|
| **F-1** ★ | **REV-6 §P3+P4 命令③ 引用的测试文件在 main 上不存在**：`tests/routes/workspace-access-write-endpoint.test.ts` | C 节 **S3**：`find . -name 'workspace-access-write-endpoint*' -not -path '*/node_modules/*'` → **零命中**（`[exit=0]`，无输出）；C 节 **S7**：`ls tests/routes/ \| grep -i workspace` 仅 `department-workspace.test.ts` / `workspace-data.test.ts` / `workspace.test.ts` | 命令③当前**必然失败**（vitest 找不到文件）。要么 PR-2 新建它，要么 REV-6 改指既有文件。**需队长明确该文件是否进 PR-2 写集**（写集互斥：`tests/routes/**` 归谁） |
| **F-2** ★ | **「前移后 5」是模拟值**，且被两个约束共同钉死：① 谓词点数=5 要求 `356 < L ≤ 366`；② `PLAN-REV2.md:95` 要求 `GET /api/status/budget` 前移后**仍直达** ⇒ 同样要求 `L > 356` | B 节 P4.e/P4.f；`PLAN-REV2.md:92,95` | ⇒ **rbac 只能插在「内联 `app.get('/api/status/budget')` 块（355-365）之后、`app.use(homeRoutes)`（原 366）之前」**。实施后必须实测 `L` 落在 **[357, 366]**（得 5 处）；`L ≤ 356` 会变 4 处并拦死 `/api/status/budget`；`L ≥ 367` 会让 `homeRoutes` 落到 rbac 之前（语义变化，且点数变 6）。**请把该区间写进 PR-2a 卡面** |
| **F-3** ★ | **`PLAN-REV2.md:95` 的「前移后仍须直达」清单与豁免集不自洽**：清单含 `/health`、`GET /api/knowledge/ask`，但二者**不在**豁免集 `{323,341,344,348,356}` 内 —— `knowledgeAskRoutes`@372、`healthRoutes`@378、`healthzRoutes`@379，前移后全部落到 rbac **之后** | B 节 P1 全量挂载清单；C 节 S1/S2 路由定义 | ⇒ 该清单**只有在 `rbacMiddleware` 保持「仅注入、不拦截」时才成立**。故 **PR-2a 不得把 `rbacMiddleware` 改成 fail-closed 守卫**（否则 `/health`、`/api/healthz`、`/api/knowledge/ask` 被拦）。这与「P4 单独前移 = 行为空操作」一致。**请队长确认 PR-2a 写集边界 = 顺序前移 + 删 244-249 + 收窄 import，不含 rbac 语义改动** |
| **F-4** | `canModifyWorkspace` 删 `server.ts:249` 后 **`src/` 内零调用方**（仅测试引用） | C 节 S5 | 请队长按铁律 37 口径裁决；code-b 读法：不算 dead code（函数本体未删、测试仍引用），但 `server.ts:19` import 必须收窄 |
| **F-5** | REV-6 命令① 口径错误（见 D-4） | B 节 P4.g/P4.h | 建议正名为冻结谓词版；否则 P4 判据自相矛盾 |

### D-10 未采信 / 未验证项（诚实边界）

- **零测试执行**：按派单件「本阶段禁跑 vitest（重型验证 ≤1，PR-1 期间由 code-a 占用）」，本次**未跑任何 vitest / 全量门禁 / tsc**。全部结论为**静态取证**（grep/read），不含运行时行为验证。
- **未验证前移后的实际红/绿**：`tests/middleware/auth.integration.test.ts`、`tests/routes/setup-guide-retired.test.ts`（`:250` 有 `createServer` 源码断言）等在前移后是否仍绿 —— 属 PR-2a 实施后的**独立自验**范围。
- **未核对 REV-6 命令② 引用的 `tests/routes/middleware-order.test.ts` 内容** —— 该文件尚不存在（C 节 S4 零命中）。
- **未做任何 `src/` 或 `tests/` 改动**；未 `git add` / 未 commit；临时脚本与原始输出只落 `%TEMP%`。

---

**证据文件路径**：`docs/synova/product-lines/evidence/D947-20260924/D947-code-b-recon.md`
**临时产物（不入库）**：`%TEMP%\d947_code_b_recon.sh` · `%TEMP%\d947_code_b_recon.out` · `%TEMP%\d947_code_b_recon_supp.sh` · `%TEMP%\d947_code_b_recon_supp.out`
**交付语义**：本文不含任何「通过 / 不通过」判定；定性为 **`可提请独立审计`**（判定权在 CTO 收件闸 + K3 终审）。
