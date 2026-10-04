<!--
  SYNOVA-IMPL-D471: packages/ as any 清理 + 铁律 38 审计测试扩围（K3 P1-C1）
  状态: dev doc | 2026-08-22 | 优先级 P1
  权威文档: docs/synova/research/AUTHORITY-DEVIATION-REGISTRY-v2.md（P1-C1：组 1 只扫 src/，packages/ 81 处 as any 无门禁）; AGENTS.md 铁律 38（as any 零容忍，替代：内联类型 as { field?: string } / Record<string, unknown> / unknown + 类型守卫）; packages/test-kit/tests/architecture/05-as-any-audit.test.ts（既有审计测试）
  依赖: 无
  并行: 写集=packages/（sog-core + connector-registry + test-kit），与 D470（src/agent + extensions/ontology）**零文件交集**，可 worktree 隔离并行；⚠️ 与 DSH 线（scripts/ 门禁）零重叠——**不改 pre-commit 组 1**，审计扩围只改 test-kit 测试；若必须并行先 worktree 隔离
-->

# SYNOVA-IMPL-D471 packages/ as any 清理 + 铁律 38 审计测试扩围

## 1. 权威文档引用

* **AUTHORITY-DEVIATION-REGISTRY-v2.md**（docs/synova/research/AUTHORITY-DEVIATION-REGISTRY-v2.md）：P1-C1「铁律 38 改判退回——组 1 只扫 src/，packages/ 实测 81 处 as any 无门禁，'零存在'声称不成立」。归属核对（TASK-ROUTING v4）：`packages/` = **Win Claude 线** ✓。
* **AGENTS.md 铁律 38**：「`as any` 零容忍……替代：内联类型 `as { field?: string }` / `Record<string, unknown>` / `unknown` + 类型守卫」。
* **既有审计测试**（packages/test-kit/tests/architecture/05-as-any-audit.test.ts）：当前只扫 src/，本任务扩到 packages/（测试侧闭环 P1-C1，不动 scripts/ 门禁）。

## 2. 代码审计——现状（全部实测 file:line）

### 缺陷 A：sog-core-schema.ts 类型守卫大量 `(p as any)?.[k]`
* `packages/sog-core/src/sog-core-schema.ts`：L332 `(p as any)?.amount`；L346 `(p as any)?.[k]`（hasString，该行 2 处）；L350-434 枚举校验 `['permanent','temporary'].includes((p as any)?.teamType)` 同型。**实测 24 处**（`rg -n "as any" packages --glob "*.ts"` 逐行核对，非注释）。全部是 **类型守卫函数**（纯类型收窄，无行为逻辑）——可安全替换为 `(p as Record<string, unknown>)?.[k]` / `(p as { teamType?: string })?.teamType`，零行为变化。

### 缺陷 B：sog-schema-registry.ts 枚举/校验器映射 as any
* `packages/sog-core/src/sog-schema-registry.ts`：L57 `Object.values(SOGNodeType).includes(name as any)`；L61-62 `!NODE_VALIDATORS[name as any]` + `(NODE_VALIDATORS as any)[name] = () => null`；L69/73/74 同型 EDGE；L105-106 `!enumNodes.has(t as any)`。**实测 8 处**。修复：`NODE_VALIDATORS` 声明为 `Record<string, NodeValidator>`（或 `Record<SOGNodeType, ...>` + 索引签名），`name as SOGNodeType` 语义化转换 + includes 用枚举值数组。

### 缺陷 C：connector-registry.ts 1 处
* `packages/connector-registry/src/registry.ts:121`：`} as any);` —— 需看上下文改为内联类型（Record 或具体接口）。

### 缺陷 D：test-kit e2e 测试 2 处
* `packages/test-kit/tests/e2e/02-expert-contribution-journey.test.ts:25/34`：`await res.json() as any` —— 改为 `as { ... }` 内联类型（响应体最小字段）。

### 缺陷 E（门禁缺口本体）：审计测试只扫 src/ **且无断言（空测试）**
* `packages/test-kit/tests/architecture/05-as-any-audit.test.ts`：L13-14 扫描根固定 `path.join(REPO_ROOT, 'src')`，packages/ 不在覆盖；**更严重——L31-32 只有 `console.warn`，没有任何 `expect`/`throw`：violations>0 时测试照样通过**（空壳测试，违反铁律 48）。本任务必须：①扫描根扩到 src/ + packages/（排除 .d.ts/.test.ts/注释——findTsFiles 已有排除）；②**补 `expect(violations.length).toBe(0)` 断言**，否则扩围是假门禁。

### 计数汇总（实测 2026-08-22）
生产代码（非注释/非测试）**33 处**：sog-core-schema 24 + sog-schema-registry 8 + connector-registry/registry.ts:121 1。测试文件 **2 处**（e2e L25/34，本任务一并清理）。审计测试自身 3 处 "as any" 为字符串字面量（describe 标题/console.warn 文案），**不清理**。src/ 非注释 as any = 0（§3.3 声称成立）。

## 3. 实现方案

### 3.1 写集 (3 修改 + 0 新建) — 交付后二轮自审修复 commit（G12c 按 commit 核验写集表）
| 文件 | 操作 | 说明 |
|------|------|------|
| packages/test-kit/tests/architecture/05-as-any-audit.test.ts | 修改 | 状态机修复行注释陷阱：行注释内含 `/*`（真实案例 src/agent/skill-lazy-loader.ts:107 `// skills/*.md`）误开块注释状态、后续无 `*/` 闭合 → 其后整段文件吞出扫描区（漏报洞）。修复：开块注释前判 `open < lineComment`；新增非空转断言（主扫描实际读入文件数 >100，防 REPO_ROOT 漂移/目录缺失假绿）；排除规则 fixture 增 .test.tsx 用例；real.ts 增 2 行陷阱（行注释内含 /* + 后续违规行），命中数 5→6；已知残余限制注释同步（字符串内 /* 与 // 对称） |
| docs/plans/codex/implementation/SYNOVA-IMPL-D471-packages-as-any-cleanup-20260822.md | 修改 | §3.1 改述当前 commit 写集；§3.2 回填点 10（二轮自审修复详情）；全量写集历史存档 §3.1b/§3.1c |
| memory/notes/implemented/2026-08-22-d471-packages-as-any-cleanup.md | 修改 | 交付笔记补二轮自审修复行 + 教训 8（行注释内含 /* 陷阱）；DS3 证据同步 4/4 |

### 3.1b 一轮自审修复 commit 写集（3 文件 — b4ba61ad，历史存档）
| 文件 | 操作 | 说明 |
|------|------|------|
| packages/test-kit/tests/architecture/05-as-any-audit.test.ts | 修改 | 注释过滤重写为跨行块注释状态机——修复初版 `!line.includes('*')` 漏报洞（乘法运算符代码行整行被跳）与同行剥离误报（多行块注释 JSDoc 续行）；排除规则测试扩至 5 命中 + 7 不误报用例；findTsFiles 纳入 .tsx（排除 .test.tsx，src/ 实测 0 处 .tsx as any 后扩） |
| docs/plans/codex/implementation/SYNOVA-IMPL-D471-packages-as-any-cleanup-20260822.md | 修改 | §3.1 改述当时 commit 写集；§3.2 回填点 9（自审修复详情）；全量写集历史存档 |
| memory/notes/implemented/2026-08-22-d471-packages-as-any-cleanup.md | 修改 | 交付笔记补自审修复行 + 教训 7（审计工具注释过滤不能靠"行内含 \* 即跳过"） |

### 3.1c 任务全量写集（7 文件 — 已随 3c9e88e0 交付，历史存档）
| 文件 | 操作 | 说明 |
|------|------|------|
| packages/sog-core/src/sog-core-schema.ts | 修改 | 24 行 as any → 类型安全替换：动态 key `(p as Record<string, unknown>)?.[k]`（局部变量收窄）；枚举 includes `(p as { teamType: TeamProps['teamType'] })?.teamType`（必选字段接口字面量类型）；typeof 检查 `{ amount?: number }` 等；NODE_VALIDATORS/EDGE_VALIDATORS 声明改交叉类型（枚举穷尽 + 字符串索引） |
| packages/sog-core/src/sog-schema-registry.ts | 修改 | 8 处 as any → `name as SOGNodeType`/`SOGEdgeType`（语义化收窄）；`NODE_VALIDATORS[name]`/`EDGE_VALIDATORS[name]` 类型化索引读写；no-op validator `() => false`；getRuntimeTypes `t as SOGNodeType`/`SOGEdgeType` |
| packages/connector-registry/src/registry.ts | 修改 | L121 去掉对象级 `} as any)`，handler 内对 await 结果断言：`return result as Record<string, unknown>`（executeTool 返回 Promise<unknown> 是 as any 根因） |
| packages/test-kit/tests/e2e/02-expert-contribution-journey.test.ts | 修改 | L25/34 `res.json() as any` → 内联响应类型 `{ ok: boolean; id?: string; status?: string }` / `{ ok: boolean }` |
| packages/test-kit/tests/architecture/05-as-any-audit.test.ts | 修改 | 扫描根 src/ 扩为 src/ + packages/（排除 .d.ts/.test.ts/注释/node_modules）+ **补 `expect(violations).toEqual([])` 断言**（原测试只有 console.warn 不失败——空壳测试违反铁律 48）+ 2 个排除规则 fixture 测试（注释过滤已随自审 commit 重写，见 §3.2 点 9） |
| packages/sog-core/tests/sog-core-schema.test.ts | 修改 | 前置修复坏 import `../sog-core-schema` → `../src/sog-core-schema`（自 e9100e96 套件从未运行）；连带同步 2 处陈腐计数断言（14/10 → 18/14，枚举 append-only 合法扩展） |
| packages/connector-registry/tests/connector-registry.test.ts | 修改 | 前置修复坏 import `../src/connectors/registry` → `../src/registry`（×2，src/ 无 connectors/ 目录） |

> 共享资源标注（S-8）：本写集不含 VERSION.md（纯类型修复，非门禁/工具行为变化，不 bump；审计测试扩围是测试文件，非门禁脚本——`scripts/` 归 DSH，不碰）；current-brief / 暂存区共享，串行触碰。

### 3.2 最终实现同 commit 回填
实现偏离 §3.1 原方案处，最终形态如下（S-6，同 commit 回填）：

1. **写集 5 → 7 文件（前置修复）**：基线实测发现 sog-core 测试 import `'../sog-core-schema'`（应为 `'../src/sog-core-schema'`）与 connector-registry 测试 import `'../src/connectors/registry'`（应为 `'../src/registry'`，src/ 实测无 connectors/ 目录）自 e9100e96 起即坏——两包测试套件从未运行，DS4 回归无从谈起。决策参考：第一性原理——回归套件必须能跑起来才谈零回归，改 import 是最少机制。前置修复 2 文件并列入写集。
2. **枚举 includes 内联类型采用必选字段形式**：原方案 `(p as { teamType?: string })?.teamType` 在 sog-core tsconfig `strict: true` 下编译失败（`string | undefined` 不可赋给 `Array.includes(searchElement: string)` 参数）。实际形态 `(p as { teamType: TeamProps['teamType'] })?.teamType`——必选字段 + 非空接收方使 `?.` 结果类型不含 undefined；`as` 断言编译期擦除，运行时与 `(p as any)?.teamType` 逐字节相同（均编译为 `p?.teamType`）。字段类型取接口字面量类型 lookup（`TeamProps['teamType']`），守卫与冻结 schema 建立编译期链接。决策参考：Anthropic——类型守卫签名与行为不改；第一性原理——最小编译面。
3. **hasString 改局部变量形式**：typeof 收窄不跨两个独立表达式传播（`typeof (p as R)?.[k] === 'string' && (p as R)[k].length > 0` 第二处仍为 unknown，strict 下编译失败）。实际形态 `const v = (p as Record<string, unknown>)?.[k]; return typeof v === 'string' && v.length > 0;`——const 局部收窄合法，行为不变。
4. **NODE_VALIDATORS/EDGE_VALIDATORS 声明改交叉类型**（原方案 `Record<string, ...>` 会丢失枚举键穷尽性）：`Record<SOGNodeType, (props: unknown) => boolean> & Record<string, ((props: unknown) => boolean) | undefined>`——sog-sdk.ts 枚举键访问类型不变；字符串索引供运行时注册读写（读 `fn | undefined`、赋 fn）。grep 实测全仓库无 Object.values/entries 消费方，声明变更无波及。
5. **no-op validator `() => null` → `() => false`**：交叉类型要求返回 boolean，null 不合法。false 与 null 同为 falsy，消费方 sog-sdk.ts 以 truthiness 判定（`if (!validator(props))`），语义等价；registerNodeType/registerEdgeType 全仓库零调用方（grep 实测），无运行时影响面。
6. **connector-registry 对值断言而非对象断言**：去掉 `} as any)` 对象级断言，handler 内 `const result = await connector.executeTool(tool.name, params); return result as Record<string, unknown>;`——executeTool 返回 Promise<unknown>，await 后对 unknown 值断言只覆盖真正需要收窄的最小面，对象其余字段（name/description/parameters/executionMode）全部通过真实类型检查。
7. **陈腐计数断言同步**（import 修复连带暴露）：sog-core 测试 2 处硬编码计数（14 节点/10 边）与当前枚举不符——枚举 append-only 合法扩展后为 18 节点/14 边（USER/RESOURCE_USER/KNOWLEDGE_CHUNK/BUSINESS_MODEL + HAS_ACCESS_TO/REVENUE_FROM/COST_DRIVEN_BY/VALUE_PROPOSITION）。同步断言与 3 处注释（"14 节点 + 10 边" → "18 节点 + 14 边" ×2、"all 10" → "all 14"）。不触碰校验语义（§3.3）。
8. **DS4 "全绿"按零新增判定**：test-kit 全量套件有 16 个基线既有失败（e2e ×12 需 localhost:3099 活服务器、architecture ×4 为 src/ 既有问题，均非本任务写集）。修复后仍 16=16 零新增；sog-core 67/67、connector-registry 7/7 全绿；根 tsc 28=28 零新增。本任务写集内零失败。
9. **审计测试注释过滤重写为跨行块注释状态机（交付后自审修复）**：初版过滤 `!line.includes('//') && !line.includes('*')` 有漏报洞——代码行含 `*` 运算符（乘法）或字符串内含 `//`（URL）时整行被跳过，`(p as any).z * 2` 这类违规审计抓不到（审计工具自身的盲区，与 P1-C1 同性质）。自审时先改成同行剥离，暴露反向缺陷：多行块注释（JSDoc）续行 ` * 零 as any` 被误报，主扫描 src/ 实测误报 2 处。最终形态：逐行状态机追踪块注释开合（跨行），剥闭合块注释（等长空格保列位）、未闭合 `/*` 尾部视为注释并置跨行状态、`//` 截断后再匹配 `/\bas\s+any\b/`。排除规则测试扩到 5 个命中用例（乘法运算符 / 字符串内 URL / 块注释后代码 / 跨行块注释内 / 闭合符后代码）+ 7 个注释不误报用例（含块注释续行）。已知残余限制（注释中已记录）：字符串/正则字面量内含 `//` 且位于 as any 之前的同行仍漏报。findTsFiles 同步纳入 `.tsx`（排除 `.test.tsx`）——src/ 实测 0 处 .tsx as any 后才扩，扫描声明"src/ + packages/ 生产代码零 as any"覆盖完整。
10. **行注释内含 `/*` 陷阱修复 + 非空转断言（交付后二轮自审）**：状态机 `rest.indexOf('/*')` 未考虑 `/*` 位于 `//` 之后的场景——真实代码 src/agent/skill-lazy-loader.ts:107 `// skills/*.md — 知识文件 (旧格式兼容)` 会误开块注释状态，该文件后续无 `*/` 闭合 → L108-258 整段吞出扫描区（漏报洞，与点 9 同类盲区）。修复：开块注释前判 `open < lineComment`（`/*` 在 `//` 之后则不开）。实证三连：①fixture RED——real.ts 增陷阱行（行注释内含 `/*` + 后续违规行）修复前 5≠6 失败、修复后 6/6 通过；②真实暴露面——skill-lazy-loader.ts 文件尾种探针 `(p as any).probe`，修复后精确报 L259（旧版吞掉 L107 后全部行、漏报），实测后 git checkout 还原；③非空转断言——findTsFiles 实际读入 >100 文件，防 REPO_ROOT 漂移/目录缺失致假绿（种探针在临时目录验证该断言能拦下空转）。已知残余限制注释同步更新（字符串内 `/*` 与 `//` 对称，代价均远低于旧版整行跳过）。

### 3.3 不做的事
* 不改 `scripts/pre-commit-check.sh` 组 1（DSH 地盘——本任务用 test-kit 审计测试在测试侧闭环 P1-C1，门禁扩围交 DSH 排期）。
* 不改 src/ 下任何文件（src/ 已零 as any，D470 是另一任务）。
* 不改 extensions/（D470 写集）。
* 不重写 sog-core 校验语义（纯类型替换，行为逐字节不变——vitest 回归保证）。
* 不碰 客户A客户数据。

## 4. 测试要求（测试优先：先写 red → 再实现 green）

| 层 | 类型 | 数量 | 覆盖 |
|----|------|------|------|
| L1 | 单元/审计 packages/test-kit/tests/architecture/05-as-any-audit.test.ts | 4 | 扩围 + 加断言：**red=扩围且未清理（生产 33 处）→ green=清理后 0**；排除规则正确（.d.ts/.test.ts/.test.tsx/注释/审计测试自身字符串不误报）；主扫描非空转（实际读入 >100 文件） |
| L1 | 回归 cd packages/sog-core && vitest run + cd packages/connector-registry && vitest run + cd packages/test-kit && vitest run | 全量 | sog-core 类型守卫行为不变（schema 校验结果与修复前一致）；e2e 响应 cast 替换后请求/断言不变 |

**RED 必须覆盖失败模式（S-5）**：用例 1 先扩围 + 加 expect（不加清理）→ `cd packages/test-kit && vitest run tests/architecture/05-as-any-audit.test.ts` → **修复前失败（生产 33 处）** → 清理后通过；用例 2 断言排除规则（审计测试自身 "as any" 字符串、.d.ts、注释不误报）。

## 4.5 决策参考（S-12）
* 决策点 1：`(p as any)?.[k]` 用什么替代？
  * 参考系：第一性原理——铁律 38 官方替代「Record<string, unknown> / 内联类型」；Anthropic——类型守卫函数签名不改、行为不改。
  * 结论：`(p as Record<string, unknown>)?.[k]`（动态 key）+ `(p as { teamType?: string })?.teamType`（枚举字段），零行为变化。
* 决策点 2：审计扩围放测试还是门禁？
  * 参考系：边界（S-13）——scripts/ 门禁=DSH；DeepSeek——最小改动。
  * 结论：放 test-kit 审计测试（packages/ 内闭环），门禁扩围另行知会 DSH。

## 5. 接线要求

| 新 export/函数 | 调用方 | 确认方式 |
|---------------|--------|---------|
| 无新增 export（纯类型替换） | — | `grep -rn "as any" packages --glob "*.ts"` 零命中（除 .d.ts/测试字符串） |
| 审计测试扩围 | vitest 自动收集 | `grep -n "packages" packages/test-kit/tests/architecture/05-as-any-audit.test.ts` 命中扫描根 |

> 本任务无新生产接口（S-3 不适用：接线=审计覆盖，测试即接线验证）。

## 6. 完成标准

* **DS1 清理完成**：`rg -n "as any" packages --glob "*.ts"` 生产代码（非 .d.ts/非 .test.ts/非注释）命中 = 0；e2e 2 处 cast 一并清理。
* **DS2 审计扩围**：`grep -n "packages" packages/test-kit/tests/architecture/05-as-any-audit.test.ts` 命中扫描根。
* **DS3 审计测试全绿**：`cd packages/test-kit && vitest run tests/architecture/05-as-any-audit.test.ts` 全 pass（red 先行已证：扩围 + 加断言未清理时失败 33 处；修复后 0）。
* **DS4 零回归**：`cd packages/sog-core && vitest run` + `cd packages/connector-registry && vitest run` + `cd packages/test-kit && vitest run` 全绿 + 根目录 `tsc --noEmit` 零新增（28=28）。
* **DS5 范围一致**：`git diff --name-only HEAD^` 与 §3.1 写集一致，无越界（不碰 scripts/、src/、extensions/）。
* **DS6 无绕过**：`grep -n "no-verify" .claude/bypass.log` 零命中。
* **DS7 推送 + CI**：`git push` 后 `git log origin/main..HEAD --oneline` 空 + CI 任务相关 job 绿（job 级）。

## 7. 自检清单

* [ ] 每个代码审计 claim 有 file:line 证据（§2 全部 grep 实测，不是凭记忆）
* [ ] 写集表标题后紧跟表格（无空行，devdoc_writeset.py 契约）
* [ ] 测试 red→green 覆盖失败模式（审计扩围即红 → 清理后绿）
* [ ] 零行为变化：sog-core 校验语义不变（vitest 回归）
* [ ] DS verify 命令真实可执行、映射到实际用例
* [ ] 版本编排：纯类型修复 + 测试扩围，非门禁/工具行为变化，不 bump VERSION.md
* [ ] 不用 --no-verify

## 8. 交付声明（声称↔证据对照表，U4 D423）

| 声称 | 证据命令 | 预期 |
|------|---------|------|
| DS1 packages/ 生产代码 as any 清零 | rg -n "as any" packages --glob "*.ts" | 生产代码命中 0（仅 .d.ts/.test.ts 字符串/注释） |
| DS2 审计测试扩到 packages/ | grep -n "packages" packages/test-kit/tests/architecture/05-as-any-audit.test.ts | 命中扫描根 |
| DS3 审计测试全绿（含 expect 断言） | cd packages/test-kit && vitest run tests/architecture/05-as-any-audit.test.ts | 全 pass |
| DS4 零回归 | cd packages/sog-core && vitest run + cd packages/connector-registry && vitest run + cd packages/test-kit && vitest run + tsc --noEmit | 全绿 + 零新增 |
| DS5 范围一致 | git diff --name-only HEAD^ | 与写集一致，无越界 |
| DS6 无绕过 | grep -n "no-verify" .claude/bypass.log | 零命中 |
| DS7 推送 + CI | git log origin/main..HEAD --oneline | 空（推送后） |

---

> 交付声明 DS 须与本文档 DS1-DS7 一一对应（S-10）；派发说明：与 D470 **可并行**（packages/ vs src/agent+extensions/ontology 零交集），但**必须 worktree 隔离**（D307），且不得与 DSH 的 scripts/ 门禁改动并行（审计扩围只在 test-kit，不改门禁）；暂存前先查 session-registry（S-9）。
