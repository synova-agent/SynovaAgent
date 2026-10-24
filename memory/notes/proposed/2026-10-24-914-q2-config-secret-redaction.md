---
状态: proposed
日期: 2026-10-24
决策: "GET /api/config/dump 的响应体改结构性脱敏：config 与 provenance[].doc 双面的秘密槽只跨 wire 传 {configured}，新增 secrets[] 侧车只给 {path,configured,source}；脱敏器新建 src/config/redact.ts（段名启发式 SECRET_SEGMENTS 首版 18 项，整段匹配）；脱敏失败落既有 catch 做 fail-closed（log.warn＋degraded＋secrets:[]），路由的 orgId 校验与 resolveCustomerConfig 调用零改动。"
理由: "dump 读面原样回 wire，把客户配置里的秘密值（含末 4 位）送进 HTTP body（含日志/前端/抓包面）；只靠「按值掩码」会回显末 4 位、只靠「泄漏键剔除」不识别秘密段名 —— 两件都不覆盖本面。结构移除（值槽→{configured}）＋来源侧车是唯一既能渲染「有没有配」又不让值出模块边界的形状（DSH settings/redact 同型）；脱敏失败必须可见且宁可不给（铁律 24/31），不许静默回明文。"
---

# 2026-10-24 · #914 Q-2 · 配置面秘密结构性脱敏（跨 wire 无值）

## 现状（改之前，实测锚 `gitea/local-main@4aa1130e9`）

1. **dump 读面原样回 wire，两个面**：`git show gitea/local-main:src/routes/config.ts | grep -n "config: mounted.config\|provenance: mounted.provenance"` ⇒
   `53:      config: mounted.config,` ／ `54:      provenance: mounted.provenance,`。`config` 是四层叠加后的**真实值**。
2. **provenance 的 doc 是层文档原貌（第二泄漏面）**：`grep -n "层文档原貌\|provenance: LayerDump\[\]" src/config/customer-config-package.ts` ⇒
   `345:  /** 逐层来源 provenance（层文档原貌，剥离前）。 */`／`346:  provenance: LayerDump[];`；快照由
   `grep -n "doc: detachJson(doc)" src/config/config-layers.ts` ⇒ `204` 生成 ⇒ 即使 `config` 脱敏，层文档原件仍会随 provenance 出去。
3. **全仓无结构性秘密脱敏**：`git grep -n "redactSecrets" gitea/local-main -- src packages | wc -l` ⇒ `0`。
4. **既有三件都不同面**（dev doc E3–E5 已核）：`stripLeaks` 只剔保留全局键/原型键、不识别秘密段名、不产侧车；
   `maskLlmKey` 仍回显末 4 位（本批要求「任何片段都不回显」）；`pii-scrubber` 是**值模式**正则，非配置结构面。
5. **基线测试**：`git show gitea/local-main:tests/routes/config.test.ts | grep -cE "^\s+it\("` ⇒ `8`（本批必须一条不改、全绿）。

## 决定

1. **新建 `src/config/redact.ts`**（契约源 dev doc §4.1 C1；实测导出：
   `SECRET_SEGMENTS:45`／`SecretSlot:57`／`RedactedValue:65`／`ConfigRedactError:77`／`resolveSecretSource:167`／`redactSecrets:186`）。
   有效逻辑行（`check-test-obligations.py:logic_lines` 同口径实测）＝`94`，满足 R6 `<100`。
2. **秘密判定＝段名整段匹配，首版 18 项**（实测 `SECRET_SEGMENTS.length` ⇒ `18`）：
   `apiKey/api_key/accessKey/access_key/secretKey/secret_key/clientSecret/client_secret/privateKey/private_key/password/passwd/token/accessToken/refreshToken/credential/credentials/secret`；
   `token` 命中而 `tokenBudget`／`apiKeyHint`／`mytoken` 不命中（整段相等，不是包含）。
3. **秘密槽只留有无**：值槽替换为 `{configured}`（configured＝非 `null/undefined/''`；`0`／`false`／`{}`／`[]` 算有值）；
   仍列入侧车（`configured:false` 也要可渲染）。返回 detached 副本，**不改入参**（诊断链仍用真值）。
4. **两个面同口径**：`config` 用脱敏副本；`provenance[].doc` 逐层换成脱敏副本（`layer`/`present`/`contributedKeys` 不变，`doc:null` 原样）。
5. **侧车 `secrets: [{path, configured, source}]`**：`path` 用 `$.a.b[0].token` 记法（键含 `.`／`[`／`]` 或空键时该段写 `["<JSON 字符串>"]`，如 `$["a.b"].apiKey`）；`source` = `resolveSecretSource(path, mounted.provenance)`
   —— 从数组末尾（workspace）向 default 扫，第一个「完整路径存在」的层名，都不存在 ⇒ `null`。侧车**不含任何值片段**。
6. **脱敏失败 fail-closed**：抛 `ConfigRedactError`（未知容器：Map/Date/function…；message 只含容器类型与路径、绝不含值）⇒ 落既有 catch
   ⇒ `log.warn`（带 `error.code`）＋ `degraded:true` ＋ 空 `config` ＋ `secrets: []`（宁可不给，不泄漏；铁律 24/31）。
   路由的 orgId 校验与 `resolveCustomerConfig` 调用**零改动**：`git show gitea/local-main:src/routes/config.ts` ⇒ `26`/`49`，现树 ⇒ `31`/`54`（偏移只因上方 JSDoc 增 5 行）。
7. **接线点（实测行号）**：`grep -n "redactSecrets(\|resolveSecretSource(\|ConfigRedactError\|secrets: \[\]" src/routes/config.ts` ⇒
   `25`（import）／`57`／`61`（provenance 逐层）／`70`（source）／`81`（catch 取 code）／`87`（catch 补 `secrets: []`）。
8. **测试**：`tests/config/redact.test.ts` 16 条（单元＋C2 边界＋fail-closed＋N3 回归 3 条）＋`tests/routes/config.test.ts` 14 条
   （既有 8 条一字未改 ＋ 新增 6 条：A-1 跨 wire 全文/末 4 位无值、A-2 秘密槽仅 `{configured:true}`、A-3 非秘密原样、
   A-4 侧车三键、A-5 provenance 第二面、B-1 明文对照 app 必红）；指定命令合计 `Tests 30 passed (30)`。
9. **判别力（裁 366 硬要求）**：同文件内联「故意原样回明文」的对照 app（不进产品代码）＋ 共用 `assertNoSecret`；
   接线回退时 A-1/A-2/A-4/A-5 必红（实测 `Tests 4 failed | 10 passed (14)`）⇒ 判据不是假绿。
10. **N3 修复（裁 371）**：旧 `PATH_SHAPE` 只认 ASCII ⇒ 中文/空格父键的路径在 `resolveSecretSource` 抛错、经路由 catch 把整条 dump 退化成 `config:{}`。
   修＝路径文法放宽为「任意非 `.`/`[` 字符」＋含 `.`／`[`／`]`／空键的段写 `["<JSON 字符串>"]`（含点键不被拆段）；`resolveSecretSource` 仍 fail-loud（非法路径照抛）。
   回归 3 例（中文父键／含点键／含空格键）＋ 改坏必红：回退 `redact.ts` 到修复前 ⇒ **3 failed**；恢复 ⇒ 30 passed。

## 依据

- 台账/开工令：#914／#918 A 节 **Q-2**；**裁定 366**（写集照批／canary 判据＝跨 wire 断言无值／Q-3 改假绿为真类）。
- 规格（唯一判据准绳）：`.handbook/派单件/2026-10-24-规格-914-Q2-秘密结构脱敏.md` §4.1（C1 契约）／§4.2（判据 A）／§4.3（判据 B）／§4.4（判据 C）／§7（R1–R7）。
- DSH 锚（读源码自研，零 DSH 代码依赖）：`~/src/dsh-src-0.2.1-rc.2/packages/settings/settings/src/redact.ts:1-4` 模块 docstring
  「`role('secret')` fields are **removed** from a value before it **crosses a wire boundary**; a **sidecar** records …
  whether it currently holds a value」；同文件 `:106` `export function redactSecrets(...)` ⇒ 本批 shape 同型（区别：DSH 由 schema 驱动，本批首版用段名启发式）。
- 可复跑入口：`npx vitest run tests/config/redact.test.ts tests/routes/config.test.ts`。
- 同批 G1 登记：`docs/authority/WIRING-REGISTRY.yaml` 追加 `capability: config.redactSecrets`（R1.1 强制，本批 T3 落）。

## 生效时点

本批合入 `local-main` 起生效。回滚＝revert 本批（纯读面改造，无开关、无进程级状态、诊断内部真值链路未动）。

**失效条件（dev doc C3 原文口径）**：`src/config/settings-seam.ts` 落地后 —— 实测当前未建
（`git ls-files src/config/settings-seam.ts` ⇒ 空）—— 本件 `SECRET_SEGMENTS` 段名启发式**必须撤**，改由 schema 的 secret 声明驱动；
撤法＝删 `SECRET_SEGMENTS` 并把 `redactSecrets` 判定改为 schema 入参；届时判据 A/B/C **保留**（判据不随机制撤）。

## 已知限制

1. **值型秘密不在覆盖面**：非秘密名下藏的值（如 `foo: sk-...`）本机制抓不到 —— 归 Q-13／Q-14 面。
2. **段名匹配是名字启发式**：可能过度脱敏（如业务字段叫 `token` 但非凭据），也可能漏掉自定义秘密名。
3. **source 是「完整路径最高持有层」**：与「逐层嵌套覆盖」的最细来源可能有差（数组整值替换后不会出现）；
   另：`redactSecrets` 只做结构判定，不判值真假（占位串也会算 `configured:true`）。
