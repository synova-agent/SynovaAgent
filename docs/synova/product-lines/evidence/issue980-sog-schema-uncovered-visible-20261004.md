# 证据 · #980 无 schema 覆盖的节点类型必须显形（静默放行 → degraded + log.warn）

> 卡：#980（0-6，第 0 批-止血）｜写者：exec-batch0b｜日期：2026-10-04
> 分支：`fix/batch0b-980-schema-visible`（基线 `origin/main` = `16a4bdaba`）｜写集：`src/l4/sog-schema-validator.ts`
> 裁决：synova-product-lead 2026-10-04（数字口径订正：卡面「1/40」错，实测 8 / 29）

---

## 0. 口径：L1 / L2 分开报

| 级别 | 本卡对应 |
|---|---|
| **L1-静态可达** | `:141` 静默放行点已改为「登记 + 告警 + degraded 返回」 |
| **L2-真跑通** | **直接 import 生产模块**跑断言集（`validateNodeProps` / `validateAndLog` 真实执行）+ **捕获 stderr 真实日志** |

⚠️ **不宣称"跑了一次完整诊断"**：本题的 Done 判据原文是「跑一次诊断，日志出现告警」。
本次**未跑完整诊断管道**（需 DB + LLM + 六阶段），改为**直接调用生产校验函数**证明告警在真实代码路径上发出。
诊断全链路是否触发该分支，取决于诊断写入的 nodeType 是否落在 `NODE_SCHEMAS` 之外 —— **该条件未实测，如实登记**。

---

## 1. 前提核验（逐条复跑）

| # | 前提 | 命令 | 输出 | 判 |
|---|---|---|---|---|
| 1 | `:141` 静默放行 | `grep -n "return \[\]" src/l4/sog-schema-validator.ts` | `141:  if (!schema) return []; // 未知类型 — 不校验（允许扩展）` | ✅ 成立 |
| 2 | 唯一调用者 | `grep -rn "validateAndLog" --include="*.ts" src/` | `:168` 定义 ／ `src/l4/graph-bridge.ts:20` import ／ `:82` 调用（**返回值被丢弃**） | ✅ 成立 |
| 3 | `validateNodeProps` **零外部调用者** | 同上 + 全仓（含 `packages/`）grep | 仅定义处 ⇒ 改其返回类型**无外部破坏面** | ✅ 成立 |
| 4 | 覆盖数 | `NODE_SCHEMAS`（`:36`）键 | **8**（FINANCIAL/PERSON/CLIENT/RISK/GOAL/AGENT/TEAM/DOCUMENT） | ✅ **订正卡面「1/40」** |
| 5 | 分母口径（产品线要求钉死） | `ls extensions/ontology/resource/*.json extensions/ontology/activity/*.json extensions/ontology/outcome/*.json \| wc -l` | **29**（resource 13 + activity 8 + outcome 8） | ✅ |
| 6 | `node-types/` 目录 | `ls -d extensions/ontology/node-types` | **不存在** ⇒ 29 的来源就是 §1-5 的三目录（`loadOntology()` 同源扫描面） | ✅ 钉死 |

⇒ **实测口径：8 覆盖 / 29 节点类型**（**不是** 1/40）。

---

## 2. 改法与契约（铁律 47）

**契约（JSDoc 已写入源码）**：

| 对象 | 输入 | 输出 | 降级 |
|---|---|---|---|
| `SchemaValidationResult` | 由 `validateNodeProps` 产出 | `errors` 空**不等于**通过（`degraded=true` 时是"未校验"）；`uncoveredType` 只在降级时给出 | `degraded=true` = 降级标记（铁律 11/31） |
| `uncoveredNodeTypes`（模块内 Set） | 命中未知 nodeType 时写入 | 未覆盖类型名集合，`size` 即「未覆盖类型 N 个」 | 不适用（纯内存，无 IO） |
| `validateNodeProps` | `nodeType` + `props` | `SchemaValidationResult` | 无 schema ⇒ `degraded=true`，`errors=[]`，**不阻断**，并 `log.warn` 显形 |
| `validateAndLog` | `nodeType` + `props` | `boolean`（**签名不变** ⇒ `graph-bridge` 零涟漪） | 无 schema 返回 `true`（不阻断，与改造前语义一致）；告警不重复打（防噪音） |

**关键设计取舍**：**不新增导出函数**。本卡若为"覆盖率报告"新增一个无人调用的 export，
就会复刻 #985「两符号零调用 = 双重死门」的同款病；故降级信号挂在**已被生产调用的那条路径**上
（`graph-bridge.ts:82 → validateAndLog → validateNodeProps`），不制造新的假门。

---

## 3. 判据与「改坏即红」四步（**原始输出，未截断**）

判据脚本（**不入仓**）：`/tmp/b0b/schema_fixture.ts`（TS 断言集）+ `/tmp/b0b/fixtures_980.sh`（驱动 + 自证）。
断言集覆盖四态：**降级路径** / **正常路径** / **错误路径** / **边界（必填缺失）**。

```
══════ 基线（应绿） ══════
$ TS 断言集
{"level":40,"time":1791049317536,"pid":56696,"hostname":"MacBook-Pro-2.local","name":"synova-agent","service":"l4/sog-schema-validator","code":"SOG_SCHEMA_UNCOVERED","nodeType":"UNCOVERED_TYPE_PROBE","uncoveredCount":1,"uncoveredTypes":["UNCOVERED_TYPE_PROBE"],"coveredCount":8,"msg":"[SOG-schema] 未覆盖类型 1 个（本次新增 UNCOVERED_TYPE_PROBE）— 该类型数据已放行但未校验（degraded，不阻断）"}
PASS | 降级:degraded | degraded=true
PASS | 降级:errors空 | errors=0
PASS | 降级:uncoveredType | uncoveredType=UNCOVERED_TYPE_PROBE
PASS | 降级:不阻断 | validateAndLog=true
PASS | 正常:非降级 | degraded=false
PASS | 正常:无错误 | errors=0
PASS | 错误:仍报错 | errors=1
PASS | 错误:非降级 | degraded=false
PASS | 边界:必填缺失 | [{"nodeType":"PERSON","field":"name","expected":"required, non-empty"}]
重复命中已执行（日志去重由 shell 驱动核对）
SUMMARY_FAIL=0
VERDICT=PASS
== TS 断言集 基线: 退出码 0 ✓
$ 日志断言
stderr 中「未覆盖类型」命中次数 = 1
== 日志断言 基线: 退出码 0 ✓

══════ 夹具 A：删掉告警文案（静默化 ⇒ 可见性信号消失） ══════
── ① 改坏：把「未覆盖类型 N 个」文案替换为无信息串 ──
  已静默化告警文案
── ② 必红 · 日志断言（应为 0 命中） ──
stderr 中「未覆盖类型」命中次数 = 0
== 日志断言 夹具A 必红: 退出码 1 ✓
── ③ 恢复 ──
BYTE_IDENTICAL=yes
── ④ 回绿 · 日志断言 ──
stderr 中「未覆盖类型」命中次数 = 1
== 日志断言 夹具A 回绿: 退出码 0 ✓

══════ 夹具 B：把 degraded 标记抹掉（降级不可见 ⇒ 铁律 11 违例） ══════
── ① 改坏：degraded: true → false ──
  已抹掉降级标记
── ② 必红 · TS 断言集 ──
{"level":40,"time":1791049318361,"pid":56722,"hostname":"MacBook-Pro-2.local","name":"synova-agent","service":"l4/sog-schema-validator","code":"SOG_SCHEMA_UNCOVERED","nodeType":"UNCOVERED_TYPE_PROBE","uncoveredCount":1,"uncoveredTypes":["UNCOVERED_TYPE_PROBE"],"coveredCount":8,"msg":"[SOG-schema] 未覆盖类型 1 个（本次新增 UNCOVERED_TYPE_PROBE）— 该类型数据已放行但未校验（degraded，不阻断）"}
FAIL | 降级:degraded | degraded=false
PASS | 降级:errors空 | errors=0
PASS | 降级:uncoveredType | uncoveredType=UNCOVERED_TYPE_PROBE
PASS | 降级:不阻断 | validateAndLog=true
PASS | 正常:非降级 | degraded=false
PASS | 正常:无错误 | errors=0
PASS | 错误:仍报错 | errors=1
PASS | 错误:非降级 | degraded=false
PASS | 边界:必填缺失 | [{"nodeType":"PERSON","field":"name","expected":"required, non-empty"}]
重复命中已执行（日志去重由 shell 驱动核对）
SUMMARY_FAIL=1
VERDICT=FAIL
== TS 断言集 夹具B 必红: 退出码 1 ✓
── ③ 恢复 ──
BYTE_IDENTICAL=yes
── ④ 回绿 · TS 断言集 ──
{"level":40,"time":1791049318558,"pid":56728,"hostname":"MacBook-Pro-2.local","name":"synova-agent","service":"l4/sog-schema-validator","code":"SOG_SCHEMA_UNCOVERED","nodeType":"UNCOVERED_TYPE_PROBE","uncoveredCount":1,"uncoveredTypes":["UNCOVERED_TYPE_PROBE"],"coveredCount":8,"msg":"[SOG-schema] 未覆盖类型 1 个（本次新增 UNCOVERED_TYPE_PROBE）— 该类型数据已放行但未校验（degraded，不阻断）"}
PASS | 降级:degraded | degraded=true
PASS | 降级:errors空 | errors=0
PASS | 降级:uncoveredType | uncoveredType=UNCOVERED_TYPE_PROBE
PASS | 降级:不阻断 | validateAndLog=true
PASS | 正常:非降级 | degraded=false
PASS | 正常:无错误 | errors=0
PASS | 错误:仍报错 | errors=1
PASS | 错误:非降级 | degraded=false
PASS | 边界:必填缺失 | [{"nodeType":"PERSON","field":"name","expected":"required, non-empty"}]
重复命中已执行（日志去重由 shell 驱动核对）
SUMMARY_FAIL=0
VERDICT=PASS
== TS 断言集 夹具B 回绿: 退出码 0 ✓
```

**四步摘要**：

| 夹具 | ① 改坏动作 | ② 判据必红 | ③ 恢复 | ④ 判据回绿 |
|---|---|---|---|---|
| A | 把告警文案 `未覆盖类型 N 个…` 换成无信息串（**静默化**） | 日志断言：stderr 命中 **0** ⇒ exit 1 | 字节还原 `BYTE_IDENTICAL=yes` | 命中 **1** ⇒ exit 0 |
| B | 把 `degraded: true` 抹成 `degraded: false`（**降级不可见**） | TS 断言集 `VERDICT=FAIL` exit 1 | 字节还原 `BYTE_IDENTICAL=yes` | `VERDICT=PASS` exit 0 |

**告警原文（stderr，pino JSON，`level:40`=warn）**：

```json
{"level":40,"time":1791049318139,"pid":56715,"hostname":"MacBook-Pro-2.local","name":"synova-agent","service":"l4/sog-schema-validator","code":"SOG_SCHEMA_UNCOVERED","nodeType":"UNCOVERED_TYPE_PROBE","uncoveredCount":1,"uncoveredTypes":["UNCOVERED_TYPE_PROBE"],"coveredCount":8,"msg":"[SOG-schema] 未覆盖类型 1 个（本次新增 UNCOVERED_TYPE_PROBE）— 该类型数据已放行但未校验（degraded，不阻断）"}
```

---

## 4. 类型安全：`tsc --noEmit` A/B（证明零新增错误）

改了导出的返回类型 ⇒ 必须证明不牵连任何消费者。做**基线 A/B**（`git worktree add --detach /tmp/b0b-base origin/main`）：

```
$ tsc --noEmit   # origin/main（纯净基线）
BASE_TSC_EXIT=2   基线错误行数=31

$ tsc --noEmit   # 本分支（含改动）
TSC_EXIT=2        我的分支错误行数=31

$ diff <(sort tsc_base.txt) <(sort tsc_t6.txt)
（无输出）IDENTICAL ⇒ 31 条错误全部是存量，与本次改动无关
```

⚠️ **顺带登记的存量事实（不在本卡写集，仅报）**：`origin/main` 自身 `tsc --noEmit` **红 31 条**，
分布在 `extensions/sentinels/_extinct/**`（约 28 条）、`src/server.ts`（2 条）、`src/connectors/ima.ts`（1 条）。
本卡**未触碰**这些文件；`grep -E "sog-schema-validator|graph-bridge" tsc 输出` ⇒ **零命中**。
⇒ 请产品线判断：CI 的 TypeScript job 是否容忍存量红（若是，则"tsc 全绿"这一判断在本仓当前**不成立**）。

---

## 5. #980 未完成 / 不宣称

- ⚠️ **未跑完整诊断**：Done 判据原文是"跑一次诊断"；本卡以"直接调用生产校验函数 + 真实 stderr"替代，
  并**未证明**完整诊断链路必定写入一个未覆盖类型（该分支是否触发取决于诊断实际写入的 nodeType）。**如实登记，未美化。**
- ⚠️ **未新增落仓测试**：本卡写集仅 `src/l4/sog-schema-validator.ts`；判据脚本按产品线对 #987 的裁决口径
  放 `/tmp`（不入仓）。**代价**：仓库内不留下可重跑的断言，独立审计需按 §3 重建。
- ⚠️ 存量 31 条 `tsc` 错误**未修**（不在写集）。

---

## 6. 交付指针

| 项 | 值 |
|---|---|
| 分支 | `fix/batch0b-980-schema-visible` |
| 写集 | `src/l4/sog-schema-validator.ts` ｜ `docs/synova/product-lines/evidence/issue980-sog-schema-uncovered-visible-20261004.md` |
| 判据脚本（不入仓） | `/tmp/b0b/schema_fixture.ts` · `/tmp/b0b/fixtures_980.sh` · `/tmp/b0b/schema_logcheck.sh` |
| 定位 | **自验结论 / 可提请独立审计**；**【通过】归 K3 终审** |
