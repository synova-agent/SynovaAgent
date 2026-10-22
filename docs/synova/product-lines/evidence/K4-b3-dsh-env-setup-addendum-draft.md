# 草案 · `dsh-env-setup` 技能补条（CTO 令第 4 条：**出草案，不直接落**）

> **状态**：**草案，待 CTO 复核**。**未落任何文件。**
> **来源**：K4 批 3 独立复核（verifier 第十三/十四轮实测）
> **为何须 CTO 复核**：技能属**治理产物** ⇒ **改纪律/技能者不得自判通过**（红线）

---

## 一、补条正文（拟）

```markdown
### 故障七：`bash` = WSL 存根 ⇒ **不只影响命令复现，直接造成 11 例测试红**

| 项 | 内容 |
|---|---|
| **现象** | PATH 上的 `bash` 命中 WSL 存根且无发行版 ⇒ 调用它的脚本/测试拿到 **UTF-16 乱码**而不是预期输出 |
| **影响面（实测）** | 🔴 **`tests/architecture/check-architecture-gate.test.ts` 在本机 BASE 与 HEAD 同红 11 例**（`11 failed`），失败文本 = `'\u0002\ufffd(u\ufffdN \u0000L\u0000i\…'` ⇒ 该测试经 `bash` 调门禁脚本 ⇒ 断言全崩 |
| **修法** | 用 **Git Bash 全路径**：`& 'C:\Program Files\Git\bin\bash.exe' -lc "cd /d/<repo> && <cmd>"` |
| **单源** | 本条即该事实的**唯一真源**；其他文档/须知**只引用本条，禁另抄**（同一事实两处维护 = 漂移源） |
```

---

## 二、四要素（CTO 要求的格式）

| 要素 | 内容 |
|---|---|
| **① 现象（可复现）** | PATH 上的 `bash` 是 WSL 存根（无发行版）⇒ 经它调脚本者拿到 UTF-16 乱码 |
| **② 影响面（量化）** | **11 例既存红**（`check-architecture-gate.test.ts`），**BASE 与 HEAD 同红** ⇒ 非本批引入，属**环境** |
| **③ 修法（单源）** | `& 'C:\Program Files\Git\bin\bash.exe' -lc "cd /d/<repo> && …"`；**本条为唯一真源，禁另抄** |
| **④ 边界（它测不出什么）** | 该修法**不解决** WSL 存根本身（不改 PATH）；只**绕开**它。⇒ **Windows 门禁 fail-open 应显式 degraded**（同族纪律） |

---

## 三、11 例红清单（verifier 实测，供 CTO 核）

| # | 测试文件 | 例数 | BASE | HEAD | 归因 |
|---|---|---|---|---|---|
| 1 | `tests/architecture/check-architecture-gate.test.ts` | **11** | 红 | 红 | 🔴 **本机 `bash` = WSL 存根 ⇒ UTF-16 乱码**（**本条要补的那个**） |
| 2 | `golden-scenarios/gss-common` | 9 | 红 | 红 | 既存（非本批） |
| 3 | `sentinel/d752-type-net-gate` | 4 | 红 | 红 | 既存 |
| 4 | `acceptance/zero-code-industry` | 2 | 红 | 红 | 既存 |
| 5 | `agent/context-compaction` | 2 | 红 | 红 | 既存 |
| 6 | `loops/ga-calibration-evolution` | 2 | 红 | 红 | 既存 |
| 7 | `electron/backend-spawn` | 1 | 红 | 红 | 既存 |
| 8 | `electron/mac-install-verify` | 1 | 红 | 红 | 既存 |
| 9 | `mcp/server-smoke` | 1 | 红 | 红 | 既存 |
| 10 | `adapters/standard-key-guard` | 1 | 红 | 红 | 既存 |
| 11 | `sentinel/field-name-alignment` | 1 | 红 | 红 | 既存 |
| 12 | `l3/graphbridge-wiring` | 1 | 红 | 红 | 既存 |
| 13 | `e2e/p0-wane-baby` | 1 | 红 | 红 | 既存 |
| 14 | `circular-dependency` | 1 | 红 | 红 | 既存 |
| 15 | `routes/workspace-goal-creation.integration` | 1 | 红 | 红 | 既存 |
| 16 | `security/file-guard-wiring` | 1 | 红 | 红 | 既存 |

> **汇总（verifier 实测四元组）**：HEAD `19 files failed | 678 passed | 3 skipped (700)`｜`47 failed | 5453 passed | 26 skipped (5526)`｜exit 1｜口径 `vitest run` 全仓｜时点 2026-10-12｜版本 `a7437498c`。
> **BASE 归属**：同 19 件复跑 ⇒ `16 failed | 38 failed tests` ⇒ **本批（L3 +2）引入 3 件 / 9 例**（全因"硬编码 56"）。

---

## 四、同源的第二条（`python3` 假别名 —— 已在技能内，**verifier 当场自证**）

技能原文已载明：`python3` 若命中 `WindowsApps` 别名 ⇒ **所有门禁静默空转、断言全看到"通过"**。
⇒ **verifier 实测本机** = `Python\Python313\python3.exe`（**Python 3.13.13，真解释器**；技能的持久修法已在位）
⇒ **其 N4 门禁 ✅（`check-ontology-fields.sh` = 58 件齐全 / exit 0）不是假绿** ✅
⇒ 该脚本另有 `python3→python→py` 三级探测 + **fail-closed**（探不到就报错、不与通过混同）。
**⇒ 本条无需补，只需在技能里保持**（且可作为"该技能已生效"的**正向案例**）。

---

## 五、CTO 待裁

| # | 事项 |
|---|---|
| ① | 是否采纳补条（含"**单源**"措辞：其他文档只引用、禁另抄） |
| ② | 是否把「**Windows 门禁 fail-open 要显式 degraded**」一并写入（该 11 例红属 fail-open 的**下游表现**） |
| ③ | 落点：`dsh-env-setup` **双轨**（`.synova/skills/` ↔ `.dsh/skills/`，组 13 逐字节一致） |
