<!--
  SYNOVA-IMPL-D476: GA 上游 enterpriseId 断点 + overflow 隔离收紧（D338 审计移交 O7/O8）
  状态: dev doc | 2026-08-23 | 优先级 P1
  权威文档: docs/synova/audit-reports/2026-08-22-D338-org-audit.md（移交 O7「overflow 路由无认证」/ O8「GA 反馈上游 'default' 硬编码断点」）; docs/synova/research/AUTHORITY-DEVIATION-REGISTRY-v2.md（P1-A5）; docs/synova/research/跨文档一致性审计-20260727/SYNOVA-CROSS-AUDIT-最终审计报告-v3-20260727.md（P1-22 GA 中国墙）; src/config.ts（orgId = SYNOVA_ORG_ID）
  依赖: D338（多租户隔离主修复已合并——本任务收其写集外观察项）
  并行: 写集=src/l3/ga-collaboration.ts + src/agent/interactive-card.ts + src/routes/overflow.ts + tests/（l3/routes），与 D477（data-ingest + tags.json）**文件级零交集**，可 worktree 隔离并行；与 DSH 线（src/sentinel/、scripts/）零重叠；若必须并行先 worktree 隔离
-->

# SYNOVA-IMPL-D476 GA 上游 enterpriseId 断点 + overflow 隔离收紧

## 1. 权威文档引用

* **D338 审计报告移交项**（docs/synova/audit-reports/2026-08-22-D338-org-audit.md）：「📋 移交：O7（overflow 路由无认证）、O8（GA 反馈上游 `'default'` 硬编码断点）」——本任务即收这两条。
* **P1-A5 / P1-22**（AUTHORITY-DEVIATION-REGISTRY-v2 + 跨文档一致性审计 v3）：单实例内 orgId 逐表覆盖 + 「ga 角色无跨企业隔离机制」。D338 已修路由层（ga-annotations/ga-corrections fail-closed），本任务补**上游写入链**。
* **config.orgId**（src/config.ts L19/L96）：`process.env.SYNOVA_ORG_ID || 'default'` —— 实例默认 org 的唯一权威来源。
* **auth 中间件**（src/middleware/auth.ts + rbac.ts）：`req.auth`（JwtPayload：role/userId/orgId）——ga-corrections.ts L18-19 已用同款（ORG_REQUIRED + FORBIDDEN），overflow 路由沿用该模式。

## 2. 代码审计——现状（全部实测 file:line）

### 缺陷 A（O8 上游断点①）：interactive-card 构建 GA 反馈 action 时硬编码 enterpriseId
* `src/agent/interactive-card.ts` L173：`enterpriseId: 'default'` —— GAFeedbackAction 有 enterpriseId 字段（L37），但卡片在**构建 action 处**写死 'default'，无论当前请求属于哪个 org。GA 反馈从源头就丢了企业上下文。

### 缺陷 B（O8 上游断点②）：recordCorrection 写入时再次硬编码 'default' 且无 orgId 参数
* `src/l3/ga-collaboration.ts` L211：`collectFeedback({ enterpriseId: 'default', ... })`；且 `recordCorrection(findingId, correction, gaUserId)` 签名**无 orgId/enterpriseId 参数**（L203）——调用方即使有上下文也传不进来。GAFeedbackHandler.processFeedback → handleCorrect → recordCorrection 整条链无企业上下文透传。

### 缺陷 C（O7）：overflow 路由无认证 + enterpriseId 字面 'default' 回退
* `src/routes/overflow.ts` L69 `(req.body?.enterpriseId as string) || 'default'`、L90 `(req.query.enterpriseId as string) || 'default'` —— ①无 auth（该文件零 `req.auth` 引用，对照 ga-corrections L18-19）；②回退值是**字面 'default'** 而非实例默认 org（config.orgId）——配置了 SYNOVA_ORG_ID 的实例，未传 enterpriseId 的请求仍落全局 'default' 图。

## 3. 实现方案

### 3.1 写集 (4 修改 + 1 新建)
| 文件 | 操作 | 说明 |
|------|------|------|
| src/agent/interactive-card.ts | 修改 | L173 `enterpriseId: 'default'` → 优先取构造调用方传入的 org 上下文（若存在），否则 `config.orgId` 兜底（**注意：SentinelFinding 无 orgId（D338 缺陷 F），实现时不要追 finding.orgId**）；不硬编码字面 'default' |
| src/l3/ga-collaboration.ts | 修改 | `recordCorrection` 加 `enterpriseId?: string` 参数（缺省 = config.orgId）；L211 用 `enterpriseId ?? config.orgId`；processFeedback/handleCorrect 透传 action.enterpriseId |
| src/routes/overflow.ts | 修改 | ①路由挂 auth（对齐 ga-corrections：`auth.orgId` 缺失 → 400 ORG_REQUIRED；enterpriseId 优先 body/query，其次 auth.orgId，再回退 config.orgId）；②L69/L90 回退值从字面 'default' 改 config.orgId |
| tests/l3/ga-collaboration.test.ts | 修改 | recordCorrection 传 enterpriseId → collectFeedback 收到该值（red=现状 'default'）；不传 → config.orgId；collector 未配置降级不变 |
| tests/routes/overflow.test.ts | 新建 | auth 缺失 → 400/401；enterpriseId 显式传 → 用该值；未传 → 用 config.orgId（red=现状字面 'default' → green） |

> 共享资源标注（S-8）：本写集不含 VERSION.md（隔离强化，非门禁/工具行为变化，不 bump）；current-brief / 暂存区共享，串行触碰；interactive-card.ts 与 D338 的 ga-annotations/ga-corrections 是 GA 链路相邻文件但零重叠（D338 已合并）。

### 3.2 最终实现同 commit 回填（2026-08-23 交付）

> 实现与 §3.1 方案的有据偏离，逐项记录（S-6）：

1. **overflow 租户权威 = auth.orgId（修正 §3.1「body/query 优先」）**。§3.1 原案「enterpriseId 优先 body/query，其次 auth.orgId，再回退 config.orgId」在强制 auth 后存在**跨租户覆盖漏洞**：org-a 认证用户可在 body/query 声明 org-b，读/写 org-b 命名空间。证据链：D338 审计报告 fail-closed 定调（「缺租户上下文 → 拒绝，绝不回落全局命名空间」）；ga-corrections.ts L14-21 只用 auth.orgId（D338 已交付的路由层形态）；dashboard.js 前端传 user.orgId 与 auth.orgId 同源（同源请求不会触发 403，兼容已验证）。实现：三端点 requireAuth（401 UNAUTHORIZED / 400 ORG_REQUIRED，对齐 ga-corrections 形态）；显式 enterpriseId（路径参数/body/query）与 auth.orgId 不一致 → 403 FORBIDDEN；**config.orgId 第三跳删除**（强制 auth 下不可达死代码 + 潜在 fail-open）。
2. **不加 role 检查**。实现只做 401/400/403（跨租户）。理由：O7 移交范围是「纳入认证体系」而非 RBAC 重做，且现有前端 dashboard.js 用户为 workspace 角色（非 ga/admin）——加 role 门槛会 403 打爆现有调用方。参考：DeepSeek 最小侵入 + 第一性原理。
3. **`||` 而非 `??`**。§3.1 写 `enterpriseId ?? config.orgId`；实现用 `enterpriseId || config.orgId`——空串 '' 同样兜底，fail-closed 更彻底。
4. **模块级 config 缓存**。interactive-card.ts / ga-collaboration.ts 均 `const config = loadConfig()` 模块级一次加载（orgId 是启动期常量 SYNOVA_ORG_ID，GA 反馈构建在请求热路径，per-call loadConfig 有文件 I/O + 日志）。与仓内 per-call 惯例不同，属有意例外，代码内注释已说明。
5. **§5「生产链路」修正（dev doc 声称不实，交付前实测）**：GAFeedbackHandler 在生产代码中**零实例化**（仅 tests 引用）；overflowRoutes **从未被 server.ts 挂载**（D90 commit message 声称挂载实为仅 import，端点恒 404）；overflow graphStore 生产**零注入**（setOverflowGraphStore 无调用方）。故本任务对 overflow 是**预防性硬化**（接口就绪即生效）；overflow 挂载与 graphStore 注入缺口建议另立任务。§5 接线表与生产调用点注释按实测改写。
6. **§4 测试表按实改写**：ga-collaboration +4 用例（a 4 参直传 / b 环境变量缺省 / d processFeedback 透传 / e 卡片端到端）；overflow 新建 6 用例（①401 ②400 ③同租户透传 ④body 跨租户 403 ⑤快照 auth.orgId 权威 ⑥路径参数跨租户 403）。§4 原案「未传 → config.orgId」落实为「未传 → auth.orgId」（强制 auth 下 config 第三跳不可达，见第 1 项）。
7. **观察项（写集外，本任务不修）**：src/sentinel/sentinel.ts L119 同类硬编码回退 `|| 'synova'`（O6 类，D338 已 defer）；src/middleware/auth.ts L366 x-synova-token legacy 解析合成 orgId 'default'（旧格式兼容路径，需旧 token 才触达）。建议另立任务。

### 3.3 不做的事
* 不改 D338 已交付的 ga-annotations/ga-corrections 路由（已 fail-closed，只读消费）。
* 不改 src/sentinel/、scripts/（DSH 地盘）。
* 不改 D477 写集（data-ingest-service.ts、tags.json）。
* 不做 GA 认证体系重设计（沿用现有 auth 中间件，不新建）。
* 不碰 客户A客户数据。

## 4. 测试要求（测试优先：先写 red → 再实现 green）

| 层 | 类型 | 数量 | 覆盖 |
|----|------|------|------|
| L1 | 单元 tests/l3/ga-collaboration.test.ts（修改） | +4 | a 4 参直传 → collectFeedback 收到该值（green-only）；b 环境变量 SYNOVA_ORG_ID → 3 参缺省回落实例 org（red=现状 'default'）；d processFeedback correct → 透传 action.enterpriseId（red）；e 卡片 handleAction 端到端透传（red）；collector 未配置降级不变 |
| L1 | 路由 tests/routes/overflow.test.ts（新建） | +6 | ①无认证 401（red=修复前放行）②auth.orgId 缺失 400 ORG_REQUIRED（red）③body 与 auth 一致 → 业务透传 auth.orgId（green-only）④body 跨租户 403（red=修复前跨租户覆盖）⑤未传 → auth.orgId 权威（red=修复前 'default'）⑥路径参数跨租户 403（red） |
| L1 | 回归 interactive-card 相关既有测试 | 全量 | 卡片构建行为不变（enterpriseId 默认值修正后既有断言不破） |

**RED 必须覆盖失败模式（S-5）——已执行**：修复前 8 用例失败（ga-collaboration b/d/e + overflow ①②④⑤⑥；其中 ⑤ 实测收到 'default'，直击 O8 断点），11 通过（既有 + green-only ③）；修复后 20/20 全绿。

## 4.5 决策参考（S-12）
* 决策点 1：GA 反馈 enterpriseId 取哪？
  * 参考系：第一性原理——企业上下文应从源头（action 构造处）带起，写入层兜底用实例默认（config.orgId）；Anthropic——fail-closed 优于静默 'default'。
  * 结论：action.enterpriseId（源头）→ recordCorrection 参数 → config.orgId 兜底；'default' 字面只在 config.orgId 自身缺省时出现。
* 决策点 2：overflow 挂 auth 的爆炸半径？
  * 参考系：DeepSeek——最小侵入；若调用方未带凭据，认证部分 deferred 而非强行破坏既有链路。
  * 结论：auth 对齐 ga-corrections 接入；接入后若既有调用方 401 → §3.2 回填 + 认证另立任务（enterpriseId 回退修正不受影响）。

## 5. 接线要求

| 新 export/函数 | 调用方 | 确认方式 |
|---------------|--------|---------|
| recordCorrection（加 enterpriseId 参数） | GAFeedbackHandler.processFeedback → handleCorrect（同文件内部链，唯一生产调用方） | `grep -n "recordCorrection" src/l3/ga-collaboration.ts` 调用处传 action.enterpriseId |
| overflow 路由 auth + org 权威 | 三端点内联 requireAuth；HTTP 调用方 dashboard.js（带 Bearer，user.orgId 与 auth.orgId 同源） | `grep -n "requireAuth\|extractAuthFromRequest" src/routes/overflow.ts` 命中；`grep -rn "api/overflow" app/ scripts/` 命中 |
| interactive-card action.enterpriseId | GA 反馈卡片构建处（handleAction GA 分支） | `grep -n "enterpriseId" src/agent/interactive-card.ts` 命中且零字面 'default' |

> 生产调用点（S-3）核验结论（2026-08-23 实测，见 §3.2.5）：GAFeedbackHandler 生产代码零实例化（仅 tests 引用）；overflowRoutes 从未被 server.ts 挂载（D90 声称挂载实为仅 import，端点恒 404）+ overflow graphStore 生产零注入。本任务为**预防性硬化**：接口就绪即生效；overflow 挂载与 graphStore 注入缺口建议另立任务。interactive-card → GAFeedbackHandler 链为源码级接线（测试用例 e 端到端验证）。测试调用不计入。

## 6. 完成标准

* **DS1 源头不再硬编码**：`grep -n "enterpriseId: 'default'" src/agent/interactive-card.ts` **零命中**（字面硬编码已删；config.orgId 兜底除外）。
* **DS2 写入链带上下文**：`grep -n "enterpriseId" src/l3/ga-collaboration.ts` 命中 recordCorrection 参数与透传，无裸 'default' 写入。
* **DS3 overflow 隔离**：`grep -n "auth\|SYNOVA_ORG_ID" src/routes/overflow.ts` 命中（auth 接入 + 回退 config.orgId），且 `grep -n "|| 'default'" src/routes/overflow.ts` **零命中**。
* **DS4 测试全绿**：`vitest run tests/l3/ga-collaboration.test.ts tests/routes/overflow.test.ts` 全 pass（red 先行已证）。
* **DS5 零回归**：interactive-card 相关既有测试绿 + `tsc --noEmit` 零新增（28=28）。
* **DS6 范围一致**：`git diff --name-only HEAD^` 与 §3.1 写集一致，无越界（不碰 D477/DSH 写集）。
* **DS7 无绕过**：`grep -n "no-verify" .claude/bypass.log` 零命中。
* **DS8 推送 + CI**：`git push` 后 `git log origin/main..HEAD --oneline` 空 + CI 任务相关 job 绿（job 级）。

## 7. 自检清单

* [ ] 每个代码审计 claim 有 file:line 证据（§2 全部 grep 实测，不是凭记忆）
* [ ] 写集表标题后紧跟表格（无空行，devdoc_writeset.py 契约）
* [ ] 测试 red→green 覆盖失败模式（'default' 硬编码 → config.orgId/action 上下文）
* [x] 接线要求核验（§3.2.5 实测）：GAFeedbackHandler 零生产实例化 / overflow 未挂载——预防性硬化已记录，挂载缺口建议另立任务
* [ ] DS verify 命令真实可执行、映射到实际用例
* [ ] 版本编排：隔离强化，非门禁/工具行为变化，不 bump VERSION.md
* [ ] 不用 --no-verify

## 8. 交付声明（声称↔证据对照表，U4 D423）

| 声称 | 证据命令 | 预期 |
|------|---------|------|
| DS1 源头 enterpriseId 真实 | grep -n "enterpriseId: 'default'" src/agent/interactive-card.ts | 零命中 |
| DS2 写入链带上下文 | grep -n "enterpriseId" src/l3/ga-collaboration.ts | 命中参数与透传 |
| DS3 overflow auth + org 回退 | grep -n "auth\|SYNOVA_ORG_ID" src/routes/overflow.ts + grep -n "|| 'default'" src/routes/overflow.ts | 命中 + 零命中 |
| DS4 测试全绿 | vitest run tests/l3/ga-collaboration.test.ts tests/routes/overflow.test.ts | 全 pass |
| DS5 零回归 | vitest run 相关 + tsc --noEmit | 全绿 + 零新增 |
| DS6 范围一致 | git diff --name-only HEAD^ | 与写集一致，无越界 |
| DS7 无绕过 | grep -n "no-verify" .claude/bypass.log | 零命中 |
| DS8 推送 + CI | git log origin/main..HEAD --oneline | 空（推送后） |

---

> 交付声明 DS 须与本文档 DS1-DS8 一一对应（S-10）；派发说明：与 D477 **可并行**（写集零交集），必须 worktree 隔离（D307）；overflow 挂 auth 前先核对既有调用方（overflow-dashboard/cross-scale-validator）是否带凭据，401 则 §3.2 回填；暂存前查 session-registry（S-9）。
