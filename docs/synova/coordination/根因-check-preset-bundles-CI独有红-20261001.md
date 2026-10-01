# 根因定位 · `Control Tower Gate Tests` 里 `check-preset-bundles.test.sh` 的 CI 独有红

> **性质**：CTO 侧取证记录（D 层过程件，同件随 PR 入仓作证据）。
> **断语**：本条**不是**某个 PR 的内容问题，是**测试的环境依赖**——**本机绿、CI 红，同一测试、同一断言**。

---

## 一、现象（两侧证据并列）

| 侧 | 命令 | 结果 |
|---|---|---|
| **本机**（macOS，worktree 内） | `bash tests/control-tower/check-preset-bundles.test.sh` | **`PASS=39 FAIL=0`** ✅ |
| **本机**（含它的外层模拟器） | `bash tests/control-tower/simulate-ci.test.sh` | **`7 通过, 0 失败`，exit 0** ✅ |
| **CI**（ubuntu-latest） | `Control Tower Gate Tests (ubuntu-latest)` | **`PASS=37 FAIL=3`** ❌ |

CI 侧三条失败的**逐字原文**（取自 PR #927 与 #929 两次 run，**两次完全一致**）：
```
❌ T1: 汇总行正确 (缺少串: --repo 汇总: 发现 1 个预设, 违规 0 个)
❌ T2: --consistency exit 0 (got rc=1, want rc=0)
❌ M3b: legacy 退役后 exit 0 (got rc=1, want rc=0)
PASS=37  FAIL=3
```

外层模拟器在 CI 里也据此判红：
```
❌ 应 exit 0, 实际 1 :: 内层失败: ❌ tests/control-tower/check-preset-bundles.test.sh — 模拟红（与 CI 一致）
结果: 6 通过, 1 失败
```

---

## 二、定性（三条独立判据）

1. **同一测试、同一断言、两侧相反结果** ⇒ 差异只能来自**环境**，不能来自"代码不对"。
2. **触发这些红的 PR 零改动该域**：`git diff --name-only origin/main...HEAD` 对 `presets|check-preset-bundles` **零命中**
   （PR #929 只碰 `docs/` `decisions/` `memory/` `task-state/`）⇒ **不是回归**。
3. **该测试自带隔离声明**（`tests/.../check-preset-bundles.test.sh:20`）：`mktemp 沙箱 + SYNO_* 注入缝 → 不碰真实 ~/.dsh* 与真实 profiles/desktop`，
   并在 CI 日志里**自证通过**：`✅ 沙箱隔离: 注入缝全部指向 mktemp 副本`、`✅ 真实仓库源未被夹具破坏`。
   ⇒ **沙箱隔离本身是好的**，红的**不是隔离失效**，是**被判对象在两个环境里取值不同**。

## 三、指向（待治理线复核，非本件结论）

被测脚本 `scripts/control-tower/check-preset-bundles.sh` 的两个取值面：
- 仓源：`BUNDLE_SRC="${SYNO_PRESET_REPO_DIR:-$REPO_DIR/docs/synova/presets}"`
- profile 解析序（`check-preset-bundles.sh:105-113`）：
  `env 注入 → $DSH_HOME/profiles/desktop → ~/.dsh-trial-017/... → ~/.dsh/profiles/desktop`

**T2 `--consistency`** 比的是「运行时 vs 仓库源」。本机该面**有值**（活载体 bundles=14、node_modules 有 `@local/`），
CI runner 的 `$HOME` 下**无任何 `.dsh*`** ⇒ **解析到的 profile 与本机不同**，
"发现 1 个预设" 这个数落不下来，T1/T2/M3b 一并红。

> ⚠️ 这仍是**推断**，标注在此待复核。**判据**：在 `env -i`（清空 DSH_HOME/HOME）下跑同一测试，若复现 3 红即坐实。

---

## 四、影响面（为什么必须治）

- **卡所有含 `presets/` 的 PR**：`Gate Integrity` 与 `Control Tower Gate Tests` 都在**必需集**里 ⇒ 红即阻断。
- 今天已有实证：**#915 / #922 / #924 / #927 / #929 五件重开的红里，有一件就是它**（#929 唯一那条）。
- **不属"内容问题"** ⇒ 按裁定「存量红不该由本次改动承担阻断」（决策镜头原则 4），**不应由碰它的 PR 修**。

## 五、建议修法（交治理线，本件不代裁）

| 方案 | 内容 | 代价 |
|---|---|---|
| **A（推荐）** | 给该测试**补一个"无 profile"分支**：解析不到 profile 时，T2/M3b 断言改为**显式跳过 + 留痕**（不是假绿，是标"本环境无该面"） | 改测试，须 K3 核（测试是判据） |
| **B** | CI 里为该 job **显式注入 `SYNO_PROFILE_DIR` 夹具**（该测试已有注入缝，只是没给全） | 改 CI 配置，最小 |
| **C** | 把它从 `Control Tower Gate Tests` 里**拆出成独立 job**并**不进必需集** | 降低覆盖面，最后手段 |

**不建议**：直接删该测试（它是"绑定契约"的判据，删＝丢覆盖面）。

---

## 六、附：两侧可复跑命令

```bash
# 本机（应 PASS=39 FAIL=0）
bash tests/control-tower/check-preset-bundles.test.sh

# 本机（含它的外层，应 7 通过 0 失败）
bash tests/control-tower/simulate-ci.test.sh

# CI 侧证据（需 actions:read）
gh api "repos/synova-agent/SynovaAgent/commits/<sha>/check-runs" --jq '.check_runs[]|select(.name|startswith("Control Tower"))|.id'
```
