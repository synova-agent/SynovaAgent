---
状态: proposed
日期: 2026-10-24
决策: "工具 execute 入口统一入参校验：zod 从 tool.parameters 派生（WeakMap 缓存含负缓存）＋ 不依赖 zod 的对象性兜底（null／数组／标量）＋ schema 不可编译 fail-closed（ARGS_SCHEMA_UNCOMPILABLE），违规以结构化 ToolArgsError{code,violations} 返回并阻断 dispatch；配套只判变更集的增量闸 check-tool-args-delta（R1／R2／R3；三态 0/1/2；--selfcheck 判别力自检），两开关 SYNO_TOOL_ARGS_VALIDATION／SYNO_TOOL_ARGS_DELTA 可回滚。"
理由: "execute 入口零入参校验，模型给错类型或漏必填时 handler 静默收到 undefined，错误在远离入口的深处爆且难以归因；仓内既有 safeParse 全在 LLM 输出/事件面，工具面 0 处（见现状节的枚举命令）。校验器必须只读工具自己声明的唯一 schema 源（tool.parameters），不得另造第二本账；「看不见」（schema 编译失败／信号量 0）必须与「没问题」分开 ⇒ fail-closed。增量闸只判变更集而非全树阻断，并给存量空 schema 登记棘轮（多即新增盲区、少即修好未删登记）。"
---

# #915 Q-1 · 工具入参统一校验（四态 Note）

## 现状（改之前；数量一律给枚举命令，不手写）

- **execute 入口零校验**：`src/agent/tools.ts` 的 `execute(name, params)` 把 `params` 直传 handler（锚 `43f24f5c9` 上 `:209`／`:246`）；模型侧错类型/漏必填 ⇒ handler 静默收 `undefined`，错在远处爆。
- **校验面只在 LLM 输出侧，工具面 0 处**：
  ```bash
  grep -rnE "safeParse|ToolArgsError|INVALID_ARGS" src packages --include=*.ts | grep -v '\.test\.' | wc -l
  # 锚上实测 7；本批落地后同命令实测 19（差额 ＝ 本批新增的 ToolArgsError／INVALID_ARGS 行）
  grep -rn "from 'zod'" src --include=*.ts
  # 锚上实测仅 src/l3/expert-output-schema.ts:9；本批新增 src/agent/tools.ts 的工具面 import
  ```
- **工具面真注册 36（不是定义数 44）**：
  ```bash
  grep -c "registry.register({" src/agent/builtin-tools.ts        # 锚上 8
  grep -cE "^\s+name: '[a-z_0-9]+'," src/tools/*-tools.ts         # 锚上 34（9 文件定义数合计）
  ```
  ⇒ 8 内置＋26 已接线专家＋2 pandoc ＝ **36**；`business_model` 4 ＋ `knowledge` 4 共 8 个定义从未注册（登记为已知缺陷）。
- **空 schema 仅 2 且 handler 均零形参**：`grep -rn "properties: {}" src/agent/builtin-tools.ts` ⇒ 锚上 `:66`（`show_diagnosis_progress`）／`:233`（`list_scheduled_tasks`）。

## 决定

1. **校验器从唯一 schema 源派生**：具名导出 `validateToolArgs(tool, params)`，用 `z.fromJSONSchema(tool.parameters)`（唯一合法转写 `as Parameters<typeof z.fromJSONSchema>[0]`）；WeakMap 按 tool 对象缓存，**失败也缓存**（负缓存 ⇒ 编译失败只 `log.warn({degraded:true})` 一次）。
2. **对象性兜底不依赖 zod**：`null`／数组／标量先于 schema 编译判 `['$: 入参必须是 JSON 对象']`（防与 zod 自带 object 报错混淆；`$ref` schema 也先命中这条）。
3. **fail-closed**：schema 不可编译（如含 `$ref`）⇒ `ARGS_SCHEMA_UNCOMPILABLE` 且 handler 不执行；**有意严于提案**（放行会让坏 schema 静默失效）。
4. **结构化回错**：`execute` 在 dispatch 前抛 `ToolArgsError`，同函数 catch 首行收口为 `{ error: { name:'ToolArgsError', code, message, violations } }`；`execute` 对外仍永不抛（契约不变）。
5. **只判变更集的增量闸**：`scripts/control-tower/check-tool-args-delta.py` —— R1（新增/改动工具必须有可校验 schema）／R2（不得绕过 execute 调工具 handler，只判工具面）／R3（空 schema 存量棘轮，基线 `scripts/control-tower/tool-args-baseline.txt` 单一登记方向）；三态 0/1/2、空集 SKIP、`--selfcheck` 四夹具判别力自检、`--files` 为测试注入缝。
6. **回滚**：`SYNO_TOOL_ARGS_VALIDATION=0`（运行时；逐调用读，首命中 `log.warn({degraded:true})` 一次）／`SYNO_TOOL_ARGS_DELTA=0`（pre-commit 附加块与 CI 具名步 ①i 两处逃生舱）。

## 依据

- **裁定**：**裁 365**（#915 Q-1 批 3-B 批准 ＋ 三条红线：CI 步号只能 ①i／闸与 #912 同口径／Step 0 先验 zod）｜**裁 369**（写集补批 6 件全批、§8-0 跨线 A′、fail-closed 方向确认）。
- **卡与判据源**：Issue #915（CTO 2026-10-24 开工令）｜#918 台账 Q-1（机制判据＝工具 execute 入参；行为证据＝code ＋ violations 路径）。
- **参照系**：DSH `defineTool` 的 `ToolArgsError{code:'INVALID_ARGS', violations[]}` —— 借「typed error ＋ 路径化 violations ＋ dispatch 前校验」三点，**不借**其进程内派发模型与插件运行时装卸（DSH 是开发时工具，非产品运行时依赖）。
- **契约/判据**：规格 `派单件/2026-10-24-规格-915-Q1-工具入参校验.md` §4.1（@input/@output/@degraded/@error）／§5.1（S1–S7＋S5b）／§5.1bis（库存断言①–⑤）／§5.3（M1–M4 改坏⇒红）／§8（已知限制）。

## 生效时点

本 PR 合入 `local-main` 起生效：运行时校验默认开（`SYNO_TOOL_ARGS_VALIDATION` 未设＝on；`=0` 回滚旧行为）；增量闸默认开（`SYNO_TOOL_ARGS_DELTA` 未设＝on），落 `scripts/pre-commit-check.sh` 附加块（不计组号）与 `.gitea/workflows/local-gates.yml` 具名步 ①i。**首个含本 Note 的 commit message 必须引用本文件路径**（D534／铁律 49）。回滚＝两开关置 `0`，或单 commit revert。

## 已知限制（禁读成「已防护」）

- **不是安全边界**：不 sanitize、不剥多余键、不替代 handler 自校；定位 defense-in-depth（服务端 `strict:true` 已先验）。
- **两份 schema 不同源**：校验面用 raw `parameters`，模型面用 `_injectStrictMode` 注入 `additionalProperties:false` 的版本。
- **zod 4.6.2 的 `fromJSONSchema` 不 strip 多余键**；本仓 36 个 schema 里 pattern／minLength／format／oneOf／anyOf 等关键字 0 命中（当下无影响）。
- **动态注册面不在增量闸视野**（connector manifest／MCP 装载／`mcpToolRegistry`）；运行时校验对任一 `ToolRegistry` 实例生效，但库存断言只覆盖静态 36。
- **$ref 等不可编译 ⇒ fail-closed**：某工具 schema 写坏即不可用（loud；测试与闸都会红）。
- **R1/R2 是正则非 AST**：字符串/注释里同名文本可能误判；handler 形参只认 `(params`／`(p`／`({` 形态。
