# src/l3/ · 施工守则

> L3 洞察层：专家链 + 4 个文件驱动加载器 + 诊断报告。**32 `.ts` | 5900 行 | 扁平单层**。

## 一、这块是什么
- 三块面：①**专家链** `expert-dispatcher.ts`(661 行)→`expert-autonomy.ts`/`quality-firewall.ts`/`expert-output-schema.ts`；②**文件驱动加载器** `report-template-loader.ts`/`framework-loader.ts`/`rule-loader.ts`/`business-model-loader.ts`（读 `extensions/{reports,frameworks,rules,business-models}/`）；③**引擎/报告** `synova-diagnosis-engine[-impl].ts`/`report-templates.ts`/`tone-enforcer.ts`/`briefing-generator.ts`；余：`knowledge-agent.ts`/`pkb-*.ts`/`gear6-scheduler.ts`/`evidence-retention.ts` 等。

## 二、谁可以改
- **归属**：产品线（排他）：`src/l3/**`|`src/l4/**`|`expert/**`|`extensions/sentinels/**`|`knowledge/**`|`theory/**`（`decisions/implemented/process/2026-10-02-role-division-final.md:47`）。
- ⚠ **机器源未回写**：`python3 scripts/control-tower/check-ownership.py src/l3/expert-dispatcher.ts` 实测输出 `win`（`ownership.yaml:35-39` 兜底 `src/**`=win）⇒ 冲突按本节归属，上报 CTO。
- **联动（实测）**：专家链 → `src/orchestrator/subagent-coordinator.ts:10-11`、`src/sentinel/runner.ts:688,696`、`src/l2/expert-router.ts:53`、`packages/test-kit/src/wiring-registry.ts:48-73`；3 个加载器 → `src/init/file-driven-loaders.ts:35,46,84`（启动链 `bootstrap.ts:843`）；引擎/报告 → `src/routes/diagnosis.ts:278`、`src/routes/conversations.ts:120`、`src/agent/report-assembler.ts`；导出面 `src/l3/index.ts`、测试 `tests/l3/<同名>.test.ts`。
- **越界判定**：`check-ownership.py <file> --owner win`（实测 exit 1）；**越界找**：门禁/CI/`ownership.yaml`→治理线，跨线写集→CTO，`scripts/audit/**` 只归 K3（碰＝事故）。

## 三、改完怎么算完成
- **生产入口（真调用链）**：`expert-dispatcher.ts`→`src/orchestrator/subagent-coordinator.ts:10`＋`src/sentinel/runner.ts:688`；`knowledge-agent.ts`→`bootstrap.ts:1258`、`src/tui-v2/chat.tsx:187`；`pkb-seed`/`gear6-scheduler`/`evidence-retention`/`briefing-generator`→`bootstrap.ts:1247/1237/1197/1148`。
- **本域红线**：
  1. 零直接数据库操作：`grep -rn "better-sqlite3\|\.prepare(\|db\.run\|\.exec(" src/l3/ --include="*.ts"` 零命中（实测 0）；执法 `bash scripts/check-architecture.sh` 的 L3→L5 组。
  2. 禁 import `tui/`|`routes/`|`mcp/`|`l1*`（实测 0）。
  3. ⚠ 灰区（别照抄）：`data-lifecycle-service.ts:12`、`knowledge-agent.ts:18` 引 `../store/session-store`，跨 L5 但门禁不拦；新增同类先问 CTO。
  4. **能注册 ≠ 生效**：本域两处零生产调用——`business-model-loader.ts` 的 `loadBusinessModels`（仅测试）、`pkb-lifecycle.ts:44` 的 `runPKBLifecycle`（`wiring-registry.ts:315` 标 `known-broken`）；新模块须答"谁在启动链上调它"。
- **改坏即红（2026-10-02 实跑）**：
  1. `src/l3/` 放含 `db.prepare('SELECT 1')` 的文件 ⇒ `❌ L3→L5 跨层引用: 1 处`，exit 1；删 ⇒ 全绿。
  2. `wiring-registry.ts` 加一条 `required: true` 的无调用模块 ⇒ `cd packages/test-kit && npx vitest run tests/architecture/02-wiring-audit.test.ts` ⇒ 该条 `×`；复原 ⇒ 回存量 2 红。
  3. `node_modules/.bin/vitest run tests/l3/` 实测 **239/240 通过**，存量红 `tests/l3/graphbridge-wiring.test.ts:79`（测 L4）。⚠ 需 node v24.19.0；v18/v22 与 better-sqlite3 绑定不兼容。

## 四、不在这里的事
- 哨兵定义/适配器 → `extensions/sentinels/**`＋`src/sentinel/**`
- 本体/图遍历 → `src/l4/**`；存储/SQLite → `src/store/**`
- 专家提示词 → `expert/**`
- 门禁/CI/控制塔 → `scripts/control-tower/**`、`.github/**`

## 五、不确定找谁
| 问题类型 | 找谁 |
|---|---|
| 归属冲突、跨线写集 | CTO |
| 门禁误拦、CI 红、`ownership.yaml` | 治理线 |
| 审计标准、`scripts/audit/**` | K3 |
| DSH 契约/范式 | 基座线 |
| 本域改动本身 | 产品线 |
