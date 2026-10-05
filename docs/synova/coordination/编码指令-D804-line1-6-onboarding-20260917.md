# 编码指令 — D804 M1「能装能用」线1 桌面端 + 线6 首诊端到端（按 S5 切片推进）

> 生成: 2026-09-17 | 执行方: **Mac 侧编码 session（预设 `synova-dsh`）** | 域: **win**（D773 代行期 Mac 执行，域声明不变）
> 前置: **spec 须先经 CTO 复核冻结**（派单 §四 规格冻结门）；冻结前不得动 `src/`，本卡按 spec 分析**零 `src/` 需求**
> 审计: Kimi K3 会盯着你的任务，线1/线6 收口后做最终审计（覆盖 1-1/1-2/1-3/1-4 + 6-1/6-2/6-3；1-8/6-7 为 k3_only 复核点）
> **认真阅读任务文档，然后执行任务。**

---

## 一、任务文档（必读，先读后动，读不完不动手）

| 文档 | 路径 | 作用 |
|---|---|---|
| D804 spec | `docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D804-line1-6-onboarding-20260917.md` | 线1+线6 断言化/取证——**编码唯一契约**（八节 S1-S8 + §12.1 写集 + §S5 切片 + §S6 断言表 + DS1-DS15） |
| 派单 | `docs/synova/coordination/派单-D804-D803-DSH标准-20260917.md` §一/§二（PR #618） | 切片定义 / 写集约束 / 验收口径（GS-01 24h 内可复跑 exit 0；线1 ≥3 条断言转 pending_k3） |
| V1 分母 | `docs/synova/project/26线-V1验收标准-草案v0.1-20260917.md`（线1 5 条 / 线6 4 条） | 断言判定式 / verify / 证据类型 / fail_when 的**唯一来源**（与 yaml 冲突时以本文件为准，U2 待 CTO 裁） |
| 北星 | `.claude/PRODUCT-BRIEF.md` §二（谁在用）+ §三（GA 按需诊断）+ §六 P0 | 产品方向锚点 |
| 前车之鉴 | `docs/synova/audit-reports/2026-09-13-D715.md`（§四 1-4 判 failed 的理由 + §五 P1-1/P1-3/P1-4） | 教训清单：证据不在 git = 温床 / 双机同名撞车 / 状态机字典序决胜 |

## 二、执行要求（做到你的最高代码水平）

1. **认真阅读** spec 的 §0（Authority）/ §现状审计（C1-C11 实测）/ §S2（契约）/ §S5（切片）/ §S6（断言表）/ §写集 —— spec 是唯一契约，**声称即引用**（每个"现状是 X"都要当场 grep/read，禁凭记忆）。
2. **任务复杂 → 先 plan mode 再做**：读 §S5 六片 + §12.1 写集（13 条）→ 列出**文件级**改动清单 → 确认依赖前置（§三-1）→ 想清楚再动手。**禁止没想清楚就改代码。**
3. **最高代码水平**：类型安全（`as any`=0，铁律 38）、契约优先（新函数/新参数先 JSDoc `@input/@output/@degraded/@error/@idempotent`，铁律 47）、降级诚实（每个 catch 有 `log` + `degraded`，铁律 24/31）、测试非空壳（`expect()` + 正常/降级/边界三路径，铁律 48，**red→green 必须留原始输出**）。
4. **切片节奏（派单 §三）**：改代码 → 跑该片断言 → **贴原始输出** → 提交 → 下一片。**禁止一个提交混多片；禁止跳过断言进入下一片。**

## 三、本任务专属硬约束（比通用铁律更具体，违反 = 审计 FAIL）

1. **依赖前置 + 基线核验（防 M7 漂移）**：
   - 编码前：`git fetch --all && git pull --ff-only`；确认 **PR #618（派单）+ 本 spec PR** 已合 main 再开工。
   - 合入后**重新核验 spec 引用行号**：`src/middleware/auth.ts`（白名单 L121）、`src/routes/diagnosis.ts`（L183/L189/L620）、`electron/main.cjs`（L119/L156/L252）、`electron/backend-spawn.cjs`（L148）、`scripts/product-lines/calc-progress.py`（L67/L177）——上游任何改动都会让行号漂移，**照旧行号写测试会红**（D524 教训）。
   - **切片 0 是本卡唯一全局前置**（断言契约校准）——不为它单独开分支，按 §S5 顺序推进。
   - **D747 承接关系待 CTO 裁决**（spec 附录 A）：`task-state/D747.json`（claimed，Mac，1-4 重打包取证）与本卡切片 3 目标重叠。裁决前：**只做切片 0-2**；切片 3 若与 D747 撞车 → 先问 CTO，不抢同一写集。
2. **写集精确性**：只改 spec §12.1 写集表列出的文件（11 修改 + 2 新建）；`git diff --name-only` 与实际改动**完全一致**；禁改写集外文件、禁"树终验声称不符"（D708/D715 教训）。写集生成走 `bash scripts/control-tower/declare-write-set.sh`（禁手写）。
3. **诚实 RED（本卡核心纪律）**：
   - 无 LLM key → GS-01 的 LLM 组必须写 `CONSULT_LLM_RED (LLM key 未提供 …)`，**禁伪造全链路绿**（D527 契约）。
   - 无 `release/` 产物 → 产物断言判 **fail**（`ARTIFACT_MISSING`），`GS01_SKIP_ARTIFACT=1` 只降"检查动作"、**不放绿**。
   - 无 Win 机 → `win-install-verify.ps1` 保持 `exit 2 waiting` + 挂账登记；**禁用 Mac 结果声称 Win 实机通过**（D773 红线）。
   - 1-4 的 `[preload-check] OK` 与渲染层 API 请求必须**原始日志落 git**（K3 D715 P1-4 = 只在 note 里自述 → 判不可转绿）。
4. **evidence 落盘规范**：证据一律入 git（禁 `.log`——被 .gitignore 吞；用 `.txt`/`.json`）。路径与命名见 spec §7.3：`scripts/golden-scenarios/evidence/GS-01-<date>.json`、`docs/synova/product-lines/evidence/D804-mac-<date>/`（`1-1-artifacts.txt` / `1-3-install-assertions.txt` / `1-4-preload-check.txt` / `1-4-renderer-api.txt`）；Mac 侧兑换证据统一 `--tag mac-d804`（防 D715 P1-1 双机 add/add 撞名）。
5. **红线（违反 = 事故）**：
   - **不碰 `src/`**（派单 §四 规格冻结门；本卡分析结论 = 零 src 需求——**若你判断必须改 `src/`，先停手问 CTO**，不许自行扩面）。
   - **不碰 `scripts/audit/`**（K3 专属）；**不碰 `scripts/product-lines/calc-progress.py`**（判分器，派单 §一 红线）。
   - 不改 `src/middleware/auth.ts` 的 consult 白名单口径（D590 裁决① 属创始人裁决面——本卡只把**断言**对齐裁决）。
   - 不复活 `/api/diagnosis/interview`（D590 裁决② 已 410）。
   - Stage 3 前零 DSH 运行时依赖（不 `npm install @deepseek-ai/dsh`）。
6. **环境坑（本次 dev-doc session 实测，你必然会遇到）**：
   - **worktree 无 `node_modules`**：新 worktree checkout 后 `npx tsx …` 会去 registry 拉包 → 本机 `/Users/wane/.npm/_cacache` 含 root 属主文件 → `npm error code EPERM` → **pre-push 的 golden-case F1 门禁会因此判红**（不是你的代码问题）。
     解法（二选一）：① `ln -s <主仓>/node_modules <worktree>/node_modules`（推荐，离线可用）；② `export npm_config_cache=<可写临时目录>`。**注意**：`git add -A` 会把该 symlink 当文件加进来（`.gitignore` 只忽略 `node_modules/` 带斜杠）→ 只 `git add <显式路径>`。
   - **`ELECTRON_RUN_AS_NODE=1`**：宿主若设了该变量，Electron 会以纯 node 启动（窗口不出现）——`scripts/desktop/mac-install-verify.sh` 已全程 `unset`，你自写实测命令时也要 `env -u ELECTRON_RUN_AS_NODE`。
   - **macOS 无 `timeout` 命令**、`date +%3N` 不可用（BSD date 输出字面 `N`）——计时一律走 `python3 -c 'import time;print(int(time.time()*1000))'`（GS-01 既有先例）。
   - **端口**：Electron 探 `http://localhost:18790`；本机若已有 18790 服务在跑，`probeOnce` 会判 `reused` → **会掩盖"包内后端未自启"**（spec 未定论项 U1）。做 1-4 取证前先 `lsof -nP -iTCP:18790 -sTCP:LISTEN` 确认端口干净。

## 四、做完之后的复核清单（逐项自查，K3 会盯着你，也会做最后的审计）

1. **与 dev doc 一致**：spec §DS1-DS15 逐项对照（**禁重编号/跳号/静默缺项**，S-10）；声称 = 实现 + 验收（S-2），禁 overclaim。写集/口径若在实现中必须变更 → **同 commit 回填 spec §S2/§12.1**（S-6）。
2. **不违反铁律**：接线完整（新 export/新参数有**生产**调用点，测试调用不计 S-3——spec §Wiring Verification 逐条 `grep` 实测）、降级诚实（24/31）、类型安全（38）、契约优先（47）、测试非空壳（48）、架构边界（39/46）。
3. **无 bug**：spec §S6 的 verify 命令逐条跑通 + `npx vitest run tests/electron/ tests/golden-scenarios/` 全绿（既有用例零回归）+ pre-commit 全过（**禁 `--no-verify`**）+ 提交走 `synova-commit`（**禁 `git stash`**，铁律 0-3）。
4. **接线完整**：spec §Wiring Verification 每条 `grep` 出真实生产调用点（`scripts/product-lines/rerun-evidence.sh` → GS-01；`electron/main.cjs` L252 → `ensureBackend` → `probeOnce`；GS-01 → `first-diagnosis-timing.sh --status-out`）。
5. **测试到位**：red→green 已证（改造前先红，贴原始输出）、覆盖正常/降级/边界三路径、`expect()` 非空壳；**反向验证**：移走 `release/*.dmg` → 1-1 必红；停掉后端 → healthz 断言必红；造一个非 JSON 的 200 假服务 → 不得判 `reused`。
6. **证据机器可查**：`python3 scripts/product-lines/calc-progress.py` 重算后 1-1/1-4/6-1/6-2 至少 ≥3 条转 `pending_k3`（贴刷新前后对照）；`bash scripts/product-lines/refresh-all.sh` 全绿。
7. **其他你认为需要复核的点**：残留清理（死代码/旧引用 grep 零）、幂等（同日重跑零新增文件、`--dry-run` 零副作用）、产物证据可复现性（脚本幂等 + 无本机假设）。

## 五、K3 审计提示（收尾要求）

- 线1/线6 收口后**一次提审**（K3 报告覆盖 1-1/1-2/1-3/1-4 + 6-1/6-2/6-3，外加 1-8/6-7 两个 k3_only 复核点）。
- 审计验收 = 断言从 `pending_k3` → `verified`（`product-progress.json` 重算后线1 ≥3 条、线6 ≥1 条；贴两次数值）。**K3 复核点（1-8/6-7）由 K3 独立重跑，禁自我指认**。
- 每个切片完成后回填 `task-state/D804.json` 的 **impl 段**（commit + by + files[] + 实测与偏差登记）。
- 审计员会**独立重跑你的断言**——脚本必须幂等、可复现、无本机假设（端口 18790、`release/` 产物、LLM key、Win 环境缺失等边界都在 spec §S4/未定论项标注过，跑前先读）。
- 未定论项（spec 文末 U1-U5）**不许自行拍板**：U1（打包态端口自启）用实测定论并贴 `lsof`/`healthz`/`backend.log` 三件套；U2（6-3 证据类型）与附录 A（D747 承接）先问 CTO。

**开始吧。**
