# D1001 派单件 — 表缺口收口：渲染层测试归属改判 mac（**建议件 + 证据**，Mac-CTO 执行改表）

> 出件：Win-Codex-CTO ｜ 2026-09-25
> 号段：**Win 段 `D1000–D1099`**（Mac-CTO 2026-09-25 授予）。本卡 = **D1001**
> **改号留痕**：本卡原号 **D949**，与 Mac 侧 D949（N8 卡）撞号 → Mac-CTO 2026-09-25 裁定 D949 → **D1001**。旧号不得再用于本卡。
> **Mac-CTO 2026-09-25 §四 硬约束**：`docs/synova/coordination/ownership.yaml` 为 **Mac-CTO 单写者**，**Win 方不得直接改**。本卡产出 = **改判建议 + 证据**，由 Mac-CTO 执行改表（并同批 `--emit-codeowners` 更新 `.github/CODEOWNERS` + 通过对应测试）。
> 字段规范（同 §四）：`domain` 单值枚举（`mac`/`win`/`k3`）+ `owner_side` + `cross_domain_reason`。

---

## 一、为什么必须改（实测，不是推断）

```
$ python scripts/control-tower/check-ownership.py tests/electron/dual-guide-packaging-guard.test.ts tests/ga-collab-logic.test.ts tests/ga-collab-ui.test.ts electron-renderer/src/lib/api.ts
win  tests/electron/dual-guide-packaging-guard.test.ts
win  tests/ga-collab-logic.test.ts
win  tests/ga-collab-ui.test.ts
mac  electron-renderer/src/lib/api.ts
❌ FAIL 跨域: 变更落在 2 个域 ['mac', 'win'] —— 单个 PR 只许一个域
```

根因两件叠加：① `ownership.yaml` 无 `tests/electron/**` 规则 → 落 `**` 兜底判 win；② 根 `vitest.config.ts:28` `include: ['./tests/**/*.test.ts', ...]` ⇒ **渲染层测试只能住在 `tests/` 下**。

**不是个案**：实测 ≥3 件测试的 import 主体是 `../electron-renderer/src/**` 却判 win：

```
tests/ga-collab-logic.test.ts     → ../electron-renderer/src/stores/ga-collab
tests/ga-collab-ui.test.ts        → ../electron-renderer/src/components/ga-detail-sections
tests/llm-config-frontend.test.ts → ../electron-renderer/src/stores/llm-config + components/{LlmSetupCard,WelcomeScreen}
```

按 CTO 三原则第②条「**测试跟随被测模块**」，被测主体 `electron/**`、`electron-renderer/**` 均 mac ⇒ 其测试归 mac。

---

## 二、本卡交付物（**不是代码改动**）

| 产物 | 位置 | 写者 |
|---|---|---|
| **改判建议件**（含规则原文、插入位置、证据、期望输出） | `docs/synova/product-lines/evidence/D1001-20260925/建议-ownership-渲染层测试改判.md` | code-a |
| **证据集**（改造前/后对照所需的全部原始输出） | 同目录 | code-a |
| `task-state/D1001.json` | 卡片 | 队长 |

**明确不做（Mac-CTO §四 硬约束）**：不改 `docs/synova/coordination/ownership.yaml`、不改 `.github/CODEOWNERS`、不改 `tests/control-tower/check-ownership.test.sh`、不改 `scripts/control-tower/check-ownership.py`（D733 交付物）；不碰 `scripts/**`、`src/**`、`electron-renderer/**`。

---

## 三、建议件必须包含的内容（这就是本卡的"规格"）

### 3.1 建议新增的两条规则（逐字，供 Mac-CTO 直接落表）

```yaml
  - glob: "tests/electron/**"
    owner: "mac"
    source: "D1001：测试跟随被测模块（electron/** 与 electron-renderer/** 均 mac）"
  - glob: "tests/ga-collab-*.test.ts"
    owner: "mac"
    source: "D1001：同上（ga-collab-logic/ui 两件被测主体均为 electron-renderer/src/stores|components）"
```

- **插入位置**：必须落在 `**` 兜底行**之后**（表语义「最后匹配者胜出」）。
- **为什么是 glob 不是列单文件**：只列 `ga-collab-logic` 那一件，下一张桌面卡撞 `ga-collab-ui` 时同一堵墙会再出现一次。

### 3.2 建议件必须自带的证据（每条给原始输出，不许写"应该"）

| # | 证据 | 命令 |
|---|---|---|
| E1 | 改造前：3 件测试判 win + 目标源文件判 mac ⇒ FAIL 跨域 | `python scripts/control-tower/check-ownership.py tests/electron/dual-guide-packaging-guard.test.ts tests/ga-collab-logic.test.ts tests/ga-collab-ui.test.ts electron-renderer/src/lib/api.ts` |
| E2 | `tests/electron/**` 既有文件清单（**13 件**，含 D716 Win 建的 `dual-guide-packaging-guard.test.ts`） | `git ls-tree --name-only <ref> tests/electron/` |
| E3 | 三件测试的 import 主体逐行（证明被测主体在 `electron-renderer/src/**`） | `git grep -n "from '\.\./electron-renderer/src" <ref> -- tests/` |
| E4 | 兜底行与现有 mac 例外段的表内位置（决定新规则插在哪） | `git grep -n "^  - glob:` <ref> -- docs/synova/coordination/ownership.yaml` |
| E5 | `D1000` 切片 B 候选 **8 文件**清单（改表后的期望结果锚点） | 逐文件 `check-ownership.py` 实测 |

### 3.3 建议件必须写清「改表后应当达到什么」（供 Mac-CTO 自验）

```
期望①  tests/electron/** 13 件逐条判 mac
期望②  tests/ga-collab-logic.test.ts 与 tests/ga-collab-ui.test.ts 判 mac
期望③  D1000 切片 B 候选 8 文件 → ✅ PASS 8 个文件同域: mac
期望④  python scripts/control-tower/check-ownership.py --emit-codeowners | diff - .github/CODEOWNERS  → 零输出（逐字节）
期望⑤  bash tests/control-tower/check-ownership.test.sh  → 项数 ≥58、EXIT=0（本机跑 bash 须自带 PATH：$env:PATH='C:\Program Files\Git\usr\bin;C:\Program Files\Git\bin;'+$env:PATH）
期望⑥  除新增两条规则外，ownership.yaml 其余行逐字节不动
```

### 3.4 边界值必须枚举（研究院《双 DSH 执行提升清单》P1 第 1 项）

`tests/ga-collab.test.ts`（无中段）**是否命中** `tests/ga-collab-*.test.ts`？`tests/ga-collab-ui.test.ts` 呢？两个都要贴原始输出。若 `fnmatch` 语义与直觉不同，必须在建议件里写明并给替代写法。

---

## 四、完成标准（本卡是建议件，判据随之改变）

| # | 判据 |
|---|---|
| W1 | 建议件含 §三 3.1–3.4 全部四项，缺一项视为未完成 |
| W2 | 建议件的规则原文**可直接复制进 yaml**（缩进/引号/键名与现有表一致） |
| W3 | E1–E5 五条证据各带原始输出（**实跑**，非转述） |
| W4 | §3.3 的六条期望输出逐条写明，且**每条都能被 Mac-CTO 一条命令复现** |
| W5 | §3.4 边界枚举两条都给原始输出 |
| W6 | 反向验证做法也写明：Mac-CTO 删掉两条规则后 E1 应重新变红（供其确认规则真的生效） |

---

## 五、执行形态（硬字段）

- Agent Teams 组队；队长**不下场写码**；1 独立自验 + 1 独立复核（自验不得由编码兼任）
- 单域 mac（本卡只写 `docs/synova/product-lines/evidence/**` + `task-state/**`，均豁免/单域）
- 工作目录钉死本卡 worktree；禁 `rm -rf`；临时产物只落 `/tmp`
- 回执含**团队成员运行记录**（成员名 · 运行状态 · token · 共享任务 id 与状态）

---

## 六、回执格式

1. W1–W6 逐条自验结论 + 证据索引（原始输出贴在证据集里）
2. 团队成员运行记录
3. `git diff --stat` + `ls-remote`（**基准写 `origin/main` 合后值，禁用本地 main**）
4. 未清项（诚实登记）
5. 派单件指纹对账（三条坐标 × 三方值）

---

## 七、红线与退回

- **不得直接改 `ownership.yaml` / `.github/CODEOWNERS` / `tests/control-tower/check-ownership.test.sh`**（Mac-CTO 单写者）。越线即退回，不算"顺手帮忙"。
- 禁 `--no-verify` / `git stash` / force push；不碰 `scripts/audit/**`
- 执行方**不判通过**；终审归 K3
- **Mac-CTO 改表落地前，D1000 切片 B 不得开工**（硬依赖）

---

## 八、未清项预登记

| # | 项 | 归属 | 处置 |
|---|---|---|---|
| 1 | 渲染层测试**通则**（被测主体在 `electron/**`/`electron-renderer/**` 的测试归 mac）尚未成文 | Mac-CTO | 本卡只建议 `tests/electron/**` + `tests/ga-collab-*.test.ts` 两条；`tests/llm-config-frontend.test.ts` 等同类仍判 win → 建议成一通则 |
| 2 | `dual-guide-packaging-guard.test.ts`（D716 Win 建）连带改判 mac | 已核 | 其头注自陈「对 `electron/`、`electron-renderer/`、`build-synova.cjs` 只读断言（Mac DSH 域，零写入）」⇒ 改判是**纠正旧误标** |
| 3 | `tests/control-tower/ownership.test.sh` 被引用但文件不存在 | Mac 侧 | 非本卡引入，登记备查 |
| 4 | 长期结构方向：DSH 的测试是**包内 `tests/`**（1769 件中 1648 件在包内），归属天然成立；我们的仓根单一 `tests/` 树切断了"测试跟随模块" | 待立项 | 本卡只是补丁，长期应让归属规则与目录结构对齐 |
