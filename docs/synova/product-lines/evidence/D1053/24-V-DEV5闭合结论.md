# D1053 · 成员 V **DEV-5 闭合**独立复核结论（基线 `85b42949`）

> 任务: D1053（第三棒）｜ 自验人: `d1053-verify`（独立于编码 C）
> **代码基线 `head_sha` = `85b429499a6ec940e9cc02da1f7efecec9223f34`**（= `git ls-remote` 远端 tip）
> base_ref = `origin/main @ 20b55eba` ｜ 环境 = 默认 `node v24.19.0`（ABI 137）/ `vitest 4.1.8 darwin-arm64`
> 机器可读版: `25-V-DEV5闭合.json`

## ⚠️ 取代关系声明

本件**取代** `22-V-增量复验结论.md` / `23-V-增量复验.json`（基线 `33e63fd5`）中关于 **DEV-5「未闭合」**的结论 —— DEV-5 **现已闭合**；同时取代其对三套件的结论。
`20*` / `21-*` / `22*` / `23-V` 原件**一律保持原样不动**（历史留痕）。

---

## 结论

**`自验结论：可提请独立审计`**

**DEV-5 的核心判据（`M3 注入 + 只跑 C1 ⇒ 必红`）已命中，且失败点正是第二消费者滞留旧值 —— DEV-5 真闭合。**

---

## 一、⭐ DEV-5 闭合判据（唯一判据：`M3 + 只跑 C1` ⇒ 必红）

注入：`src/routes/config.ts` 的 `settingsBlock()` 加模块级缓存（首读后直接返回缓存块，标记 `INJECTED-RED-D1053`）。
同一注入下**三跑法**（`24b`，完整未截断）：

| 跑法 | 命令 | 原始摘要 | 判定 |
|---|---|---|---|
| **① 只跑 C1**（闭合判据） | `… -t "C1 ·"` | `Test Files 1 failed (1)` / `Tests 1 failed \| 8 skipped (9)` | **RED ✓** |
| ② 只跑 C4（对照） | `… -t "C4 ·"` | `Test Files 1 passed (1)` / `Tests 1 passed \| 8 skipped (9)` | PASS ✓（22g 时它的红确系污染） |
| ③ 全量 E2E（对照） | `…`（无过滤） | `Test Files 1 failed (1)` / `Tests 2 failed \| 7 passed (9)` | C1（自身）+ C4（次生） |

### ① 是「因正确理由失败」——失败点原文

```
 FAIL  tests/routes/settings.test.ts > 入口 GET /api/settings/effective + 第二消费者 …
       > C1 · 两消费者同一新值（M3 判别性形状）：先预热读两端点 → 改盘 → 再读，双端同新值且均异于改前
AssertionError: expected 0.3 to be 0.55 // Object.is equality
 ❯ tests/routes/settings.test.ts:151:30
    149|     expect(b1.status).toBe(200);
    150|     const rowB1 = b1.body.settings?.keys?.find((k) => k.path === 'diag…
    151|     expect(rowB1?.effective).toBe(0.55);
```

`rowB1` = **第二消费者**（`/api/config/dump`）→ 返回**陈旧缓存值 `0.3`**，而磁盘已是 `0.55`。
⇒ 命中「部分消费者滞留旧值」这一**25-8 失效模式本身**，非旁证、非跨用例污染。

### 与修前（22g）的对照

| 跑法 | 22g（`33e63fd5`，修前） | 24b（`85b42949`，修后） |
|---|---|---|
| 只跑 C1 | **PASS（假绿）** | **RED（判据命中）** |
| 只跑 C4 | PASS | PASS |
| 全量 E2E | `1 failed`（红的是 **C4**） | `2 failed`（**C1 自身** + C4 次生） |

### C1 修后形状（`tests/routes/settings.test.ts:119-165`，V 已核读）

① 起手写 `0.30` → ② **预热**：两端点各读一次（断言均 `0.3` 且深比相等）→ ③ 改盘 `0.55` → ④ 再读两端点 → **硬判据 1**：双端 `deepEqual`（同时为新值）∧ **硬判据 2**：双端均 `!==` 改前值 → DEV-1 `defaultValue===0.3` → `scope==='process'`。

> **诚实附注（③）**：全量跑中 C4 仍会次生变红 —— 因为**注入的模块级缓存本身**在同文件内跨用例持久（C1 已把缓存填为 0.30/0.55，随后 C4 读到陈旧块）。这只是"注入物持久"的副作用，**不构成假绿**，也不影响 DEV-5 判据（C1 已自身变红）。22g 的病因（C1 假绿）已消除。

---

## 二、三套件全量重跑（基线 `85b42949`）

```bash
npx vitest run tests/config/settings-applies.test.ts tests/config/settings-source.test.ts \
               tests/routes/settings.test.ts --no-file-parallelism --maxWorkers=1 --reporter=verbose
```
```
 Test Files  3 passed (3)
      Tests  22 passed (22)
   Duration  3.44s
```
json reporter：`settings-applies.test.ts`=**6**（LIVE）｜`settings-source.test.ts`=**7**（RESTART）｜`routes/settings.test.ts`=**9**（E2E）。

---

## 三、sha256 三态 + 红证

| 文件 | pre | restored | 一致 |
|---|---|---|---|
| `src/routes/config.ts`（唯一被注入） | `f256ace0…` | `f256ace0…` | ✅ |
| `tests/routes/settings.test.ts`（未被注入） | `b0cb02b8…` | `b0cb02b8…` | ✅ |

复原方式 `git checkout -- src/routes/config.ts`；复原后 `git status -- <file>` = 空。
**红证**：`grep -rc 'INJECTED-RED-D1053' src/ tests/ | grep -v ':0'` → **空（0 残留）**。

---

## 四、沿用项（本批未动产品代码，故 22c 结论对本基线仍有效）

`git diff --stat 33e63fd5..85b42949 -- src/ tests/` 仅 **`tests/routes/settings.test.ts`**（+35/−18）⇒ **`src/**` 零改动**，故 22c 的**三路径 + C-neg（43 项 PASS / 0 FAIL）**与 22d 的**分层负控（10/10）**对本基线仍然有效（同一产品代码面）。

本批另复核：A2 定位器（两串各 1 文件、互不共现、旧名残留 0）｜接线实质判据（`mount 18791 < 404 20314`，`src/server.ts` numstat `4 0` 纯新增，公开面 3 入口，`plan.json` 0 改动 ⇒ **（b）零豁免**）｜§十二 R3 职责：4 落点 / 2 默认值**未消除**（`orchestrator:65=0.4`、`conversations:143`）。

## 五、limitations / not_run

**limitations**：不引用 `evidence/test-*.json`（A2 verdict 无法区分「跑了且绿」与「压根没跑」；实物 sha256 `2d01c9f6…`）｜③ 中 C4 次生红为注入物持久性所致、非假绿｜V 只读产品代码，注入仅落一个文件且双验复原｜本批未跑三路径与 M1/M2/M4（产品 src 面未变，沿用 22c/22e）。
**not_run**：A2 实跑 ｜ 全量 vitest ｜ pre-commit/pre-push/`SYNO_CI=1` ｜ CI（含 Windows 腿）。

## 六、K3 复跑命令

```bash
WT=/Users/wane/SynovaAgent/.synova-wt-squad-d1053 && cd "$WT"
git rev-parse HEAD            # 代码基线 85b42949（产品 src 面与 33e63fd5 相同）
node -v                       # v24.19.0（ABI 137）
npx vitest run tests/config/settings-applies.test.ts tests/config/settings-source.test.ts \
               tests/routes/settings.test.ts --no-file-parallelism --maxWorkers=1 --reporter=verbose
# DEV-5 判据（注入 M3 后）：只跑 C1 必须红
#   注入脚本见本目录 24b 顶部「注入 M3」段（python 片段），复现后：
#   npx vitest run tests/routes/settings.test.ts --no-file-parallelism --maxWorkers=1 --reporter=verbose -t "C1 ·"
#   ⇒ 期望 Test Files 1 failed (1) / Tests 1 failed | 8 skipped (9)，失败点 tests/routes/settings.test.ts:151
#   复原：git checkout -- src/routes/config.ts
grep -rc 'INJECTED-RED-D1053' src/ tests/ | grep -v ':0'   # 期望空
```

**结论：`自验结论：可提请独立审计`** —— DEV-5 闭合判据命中；通过与否归 CTO 收件闸 + K3 终审，V 不判。
