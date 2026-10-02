# 派单件 · 治理卡 G-1 修 `check-preset-bundles.test.sh` 的 CI 独有红

> **性质**：治理卡（CTO → 治理线）。按 `CTO-派单模板-v3.md` 的**治理卡专用简版七问**承载。
> **签发**：Mac-CTO（D1105）｜**执行**：治理线｜**复核**：K3（测试是判据 ⇒ 改动须独立核）
> **根因取证**：同批 `docs/synova/coordination/根因-check-preset-bundles-CI独有红-20261001.md`

---

## §〇 归属与依据（治理卡简版七问）

```
① 归属：治理域 = **CI 处置 / 门禁治理**
   🔴 目的声明：本卡解除 **所有含 `docs/synova/presets/**` 改动的 PR 的准入阻塞**
   （`Control Tower Gate Tests` 与 `Gate Integrity` 均在必需集 ⇒ 红即阻断）
② 阻塞现状（实测，两侧并列）：
   · 本机 `bash tests/control-tower/check-preset-bundles.test.sh` → **PASS=39 FAIL=0**
   · 本机 `bash tests/control-tower/simulate-ci.test.sh`      → **7 通过 0 失败，exit 0**
   · CI  `Control Tower Gate Tests (ubuntu-latest)`           → **PASS=37 FAIL=3**
     逐字：❌ T1 汇总行正确（缺少串: --repo 汇总: 发现 1 个预设, 违规 0 个）
           ❌ T2 --consistency exit 0 (got rc=1, want rc=0)
           ❌ M3b legacy 退役后 exit 0 (got rc=1, want rc=0)
   · PR #927 与 #929 **两次 run 完全一致** ⇒ 稳定复现，非 flaky
③ 依据：该域权威源 = 本仓既有测试纪律 + 裁定「存量红不该由本次改动承担阻断」（决策镜头原则 4）
   · **定性三判据**（本卡不重开讨论，见根因件 §二）：
     ① 同一测试同断言两侧相反 ② 触发 PR **零改动该域**（`git diff --name-only origin/main...HEAD` 对
     `presets|check-preset-bundles` 零命中）③ 该测试自带 mktemp 沙箱且 CI 日志自证隔离有效
④ DSH 边界：**不适用**
⑤ 架构合规：涉及 `tests/**` 与（可选）`.github/workflows/ci.yml`
   模式库：`ctrl-tower-change`（改控制塔/门禁类）＋ `windows-compat`（跨平台）
   **改坏即红**：本卡必须给出"构造违例 ⇒ 必红"的夹具
⑥ 红线（全域强制）：
   三红线 ✅不涉及｜8 禁做 ✅不涉及｜G1 ✅不涉及
   不碰 `scripts/audit/**`｜不用 `--no-verify`｜**改门禁者不自判通过 ⇒ 必过 K3**
⑦ 判据：该域判据 = **改坏即红 + 两侧一致**
```

---

## 一、任务（**任选其一，但必须在交付物里写明选了哪个及理由**）

| 方案 | 内容 | 代价 |
|---|---|---|
| **A（推荐）** | 给测试补「**无 profile 环境**」分支：解析不到 profile 时，T2/M3b **显式跳过并留痕**（不是假绿，是标"本环境无该面"） | 改测试 ⇒ 必过 K3 |
| **B** | CI 侧为该 job **显式注入 `SYNO_PROFILE_DIR` / `SYNO_PRESET_REPO_DIR` 夹具**（该测试**已有注入缝**，只是没给全） | 改 CI 配置，改动最小 |
| **C** | 把该测试**拆出成独立 job** 且**不进必需集** | 降覆盖面，最后手段 |

**禁止**：删该测试（它是"预设绑定契约"的判据，删＝丢覆盖面，且会被下一次审计当成"假绿来源"）。

## 二、复现（**先复现再改，禁凭报告直接改**）

```bash
# ① 本机基线（应全绿）
bash tests/control-tower/check-preset-bundles.test.sh        # PASS=39 FAIL=0

# ② 复现 CI 环境（判据：若出 3 红 ⇒ 坐实"环境依赖"这条定性）
env -i PATH=/usr/bin:/bin HOME=/tmp/nohome bash tests/control-tower/check-preset-bundles.test.sh

# ③ CI 侧原始证据
gh api "repos/synova-agent/SynovaAgent/commits/<sha>/check-runs" \
  --jq '.check_runs[]|select(.name|startswith("Control Tower"))|.id'
```

## 三、验收链（**改坏即红**为硬判据）

| 环节 | 判据 |
|---|---|
| ① 复现 | `env -i`（清 DSH_HOME/HOME）下能复现 **3 红** ⇒ 定性成立；若复现不出 ⇒ **停手上报**（说明我的定性错了） |
| ② 修复 | 选定方案后，本地「有 profile」与「无 profile」**两侧都过** |
| ③ **改坏即红** | 造一个"无 profile 但断言仍要求 rc=0"的违例 ⇒ **必须红**；复原后 sha 一致 |
| ④ 不降覆盖面 | 修复后该测试**仍能在有 profile 环境下检出错配**（构造一次错配 ⇒ 必红） |
| ⑤ CI 验证 | 同一 PR 复跑 ⇒ `Control Tower Gate Tests` **全绿**，且 `PASS` 数不低于 37 |

## 四、门禁合规 / 推送纪律 / 红线

标准六条 + 四条（同模板 §六/§七）；**另加**：本卡**不得顺手改必需集**（那是另一张卡）。

## 五、写集 / 依赖 / 冲突

- **写集（预计）**：`tests/control-tower/check-preset-bundles.test.sh`
  ＋ 二选一时：`scripts/control-tower/check-preset-bundles.sh` 或 `.github/workflows/ci.yml`
- **依赖**：无前置（本机已可复现）
- **冲突**：与「必需集重设计」卡**同域但不同文件** ⇒ 串行，避免撞 `ci.yml`

## 六、交付

① 复现输出（`env -i` 那一跑）② 选定方案 + 理由 ③ 改坏即红夹具输出 ④ 修复后双侧输出 ⑤ CI run 链接

---

## 签发说明

- **为什么由我签发**：本条已实测"不是内容问题"，且**今天已挡了 5 个 PR 的重开**（#915/#922/#924/#927/#929 各一次）。
- **为什么不自己改**：它是**测试＝判据**，改判据者不自判（红线 R-6）⇒ 出单 + K3 核。
- **未取到的一项**：`env -i` 复现我**没在本机跑**（本机 HOME 下确有 `.dsh*`，需清环境跑才对等）⇒
  这一跑**留给执行方**，并作为"我的定性对不对"的**第一道判据**（复现不出 ⇒ 允许退回本卡）。
