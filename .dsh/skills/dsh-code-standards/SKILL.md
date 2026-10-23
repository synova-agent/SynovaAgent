---
name: dsh-code-standards
description: DSH 代码标准（写代码／脚本／测试前必读）——8 项代码标准 ＋ 4 条必复用约定，每项带 DSH 源码 file:line 证据：typed error 带 code／config schema／invariant companion／README 骨架（Design philosophy＋Source map＋Known Limitations）／JSDoc／fail loud／explicit authority／测试配对；并列出本仓四个必须复用的既有约定（三态退出码、@降级＋degraded log、D732 UTF-8、判别力自检）——重复实现即不合格。触发词：写代码/新建脚本/代码质量/代码风格/DSH 标准/实现/coding/自足性审查。
---

# dsh-code-standards — DSH 代码标准（8 项代码标准 ＋ 4 条必复用约定）

## 使用时机

**任何写代码／脚本／测试之前**：L1 写 dev doc 时、L2 实施时、独立复核时，都要对照本件。
本件是**判据**（缺项即不合格），不是建议。

## 为什么存在（2026-10-18 实测）

- 创始人令：「**一定要学习 dsh 的代码质量，学习人家的代码风格和标准**」
- 实测差距：我们新写的 `check-package-selfsufficiency.py`（1,205 行）**没有 Known Limitations 节**、**无 Source map**、
  **错误类型不带 code**；且**复用现成件 0 处**（三态／degraded／判别力／UTF-8 四个既有约定一样没引）

---

## A. 结构标准（DSH 每包同形 —— 证据：`@deepseek-ai/dsh-tool-bash/` 目录）

```
 LICENSE  README.md  README.zh.md  README.i18n.yaml  lib/  package.json
```

**README frontmatter**：`description:` ＋ `kind: package-reference`

**README 章节骨架**（证据：`dsh-tool-bash/README.md:10,14,26,72,108,123,201,213`）
```
 ## Summary
 ## Table of Contents
 ## Use this package
    ### When to choose it / ### Minimal configuration / ### …（按能力分节）
    ### What can go wrong            ← 先讲失败，不只讲成功
 ## Understand the implementation
    ### Design philosophy            ← 「一个分离 ＋ N 条承诺」
    ### Source map                   ← 表：File → Role
    ### …（各实现节：状态机、持久化、回收…）
 ## Further Exploration
 ## Model Experience                ← 系统提示 / 工具 schema / 前台结果 / 后台上下文 / 工具错误
 ## Known Limitations and Deferred Work   ← 🔴 必须写：做不到什么
 ### Dev Note
```

---

## B. 代码标准（8 项，逐项附 DSH 证据）

| # | 强制项 | DSH 证据（file:line） |
|---|---|---|
| **B1** | **Typed error 带 `code`**，禁裸 `throw new Error` / `raise Exception` | `dsh-experimental-agent-team/lib/index.js:13-18`<br>`var TeamError = class extends HarnessError { constructor(message, code, options){ super(message, code, options); this.name = "TeamError"; } }` |
| **B2** | **Config 用 schema 校验**（schemastery / zod），不是我行我素的 JSON | 同文件 `:1` `import z from "@deepseek-ai/schemastery"`；`:9` `import { z as z$1 } from "zod"` |
| **B3** | **Invariant companion**（`invariant.ts`）：把"不变式"独立成件，可被重复校验 | `dsh-experimental-agent-team/lib/invariant.js`、`dsh-tool-subagent/lib/invariant.js` 均存在 |
| **B4** | **Bounds that fail loud**：越限报**typed error**，绝不静默复用/降级 | README:108「Every limit is a validated deployment value, and **exhaustion reports a typed error** instead of reusing an id or name」 |
| **B5** | **Explicit authority**：每个入口写明"**谁能调**" | README:107「Every service method takes the **exact live calling `Agent`**; only the Lead spawns, reassigns, or interrupts」 |
| **B6** | **JSDoc 全公开方法**（`@param x - 说明` ＋ `@returns …`） | `lib/index.js:19-23`（`errorMessage` 的 JSDoc）；每个 service 方法同形 |
| **B7** | **Design philosophy 一句可诵**：一个分离 ＋ N 条承诺 | README:103「built on **one separation and three commitments**」→ 105-108 四条 |
| **B8** | **测试与实现配对**（含**三态**与**改坏必红**用例） | 本仓 CT-40：`<name>.<sh\|py>` ↔ `<name>.test.sh`（`scripts/control-tower/*.test.sh`） |

---

## C. 文档标准（写长期件时）

| 项 | 要求 |
|---|---|
| **Source map 表** | 每份复杂件的 README 必须有一节 `File → Role` 表（证据：README:112-118） |
| **Known Limitations** | 🔴 **必须显式写"做不到什么"**（证据：README:201「Known Limitations and Deferred Work」）；不写＝不合格 |
| **What success and failure look like** | Use 章节里要有"成功长什么样、失败长什么样"（agent-team README:87） |
| **双语/多语** | `README.md` ＋ `README.zh.md` ＋ `README.i18n.yaml`（DSH 每包都有；本仓按需） |

---

## D. 🔴 本仓**必须复用**的四个既有约定（重复实现即不合格）

| # | 约定 | 出处（本仓） |
|---|---|---|
| **D1** | **三态退出码**：`0` 通过／`1` 真红／**`2` 检查自身失败**（信号量==0 ⇒ 2） | `scripts/control-tower/pre-dispatch-check.sh` 头部 |
| **D2** | **`@降级` 契约**：stderr 一行 `degraded: <原因>` ＋ **`SYNO_GATE_DEGRADED_LOG`**（字段 `time/component/code/phase/retryable`）＋ exit 2 | `scripts/control-tower/check-gate-integrity.sh` 头部 |
| **D3** | **UTF-8 强制**（D732） | `pre-dispatch-check.sh` 头部「D732 UTF-8 强制」 |
| **D4** | **判别力自检**：必须能证明"改坏确实红"（否则是假绿） | `check-gate-integrity.sh`／`check-verifiable-done.sh` |

---

## E. 验证清单（交付前逐条跑，缺一即不合格）

```bash
# 1 头部契约（@input/@output/@exit/@degraded）
head -40 <file> | grep -E "@input|@output|@exit|@degraded"

# 2 typed error（带 code）
grep -nE "class .*Error|raise .*Error\(" <file> | head

# 3 Known Limitations 节
grep -c "Known Limitations\|已知限制" <file>

# 4 Source map / 结构表（长件）
grep -c "Source map\|File | Role\|文件.*职责" <file>

# 5 三态退出码（0/1/2）
grep -nE "exit 2|exit\(2\)" <file>

# 6 判别力自检（改坏必红能真变红）
grep -nE "selfcheck|自检|改坏" <file>

# 7 复用既有约定（不该从零重写）
grep -cE "degraded|SYNO_GATE_DEGRADED_LOG|D732" <file>

# 8 测试配对（CT-40）
ls <name>.test.sh 2>/dev/null || echo "🔴 缺配对测试"
```

---

## F. 已知差距（2026-10-18 实测，供后续件对照）

| 件 | 缺什么 |
|---|---|
| `scripts/control-tower/check-package-selfsufficiency.py`（1,205 行） | 🔴 **无 Known Limitations 节** ｜ ⚠️ 无 Source map 式结构表 ｜ ⚠️ 错误类型未带 `code` ｜ 🔴 **复用现成件 0 处** |

> 这些不是"风格偏好"，是**让代码可被陌生人维护的强制项**。
> 抄标准抄"**强制项**"，不抄"排版喜好"。
