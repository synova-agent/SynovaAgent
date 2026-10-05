# 编码指令：D540 独立 clone 试点 + 影子提交 clone 验证（clone-pilot-shadow-commit）

> 生成: DeepSeek Harness dev-doc | 2026-08-27 | 给编码 session（Mac DSH 线）启动指令
> 适用范围: 实现 `SYNOVA-IMPL-DSH-D540-clone-pilot-shadow-commit-20260827.md`

---

## 1. 任务文档表（编码 session 先读后动）

| 文档 | 路径 | 作用 |
|---|---|---|
| **spec（编码唯一契约）** | `docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D540-clone-pilot-shadow-commit-20260827.md` | 本任务唯一事实源：§5 写集 / §7 测试 / §8 接线 / §10 验收逐条对照 |
| 派单 | `docs/synova/coordination/派单-D540-clone-pilot-20260827.md` | CTO 派单（spec 必答题 1-5 + 写集约束 + 验收 + 交付要求） |
| 北星锚定 | `.claude/PRODUCT-BRIEF.md` §七/§八 | 防方向跑偏（数据污染是产品偏离根因，隔离是前置） |
| 前车之鉴 | `docs/synova/coordination/派单-D540-clone-pilot-20260827.md` §「给 dev-doc 交付要求」+ 台账「CTO 派单核实不实（第二次）」 | M2 教训：**现状一律 `git show origin/main:` 读权威版，禁凭记忆/转述判断「已失效/已实现」** |
| 上游已合引用 | `docs/synova/coordination/派单-D539-session-worktree-isolation-20260827.md` | 同类控制塔隔离任务（结构/分节/写集/接线/验收对齐） |

## 2. 执行要求

- **认真阅读 spec 关键节**：§1 Authority / §4 Current State / §5 写集 / §6 不做 / §7 测试 / §8 接线 / §10 DS——逐条对照，**禁跳节只看某个 §**。
- **先 plan mode 列改动清单再动手**（任务含 4 修改 + 1 删除 + 3 新建，跨 install-hooks / pre-push / ci / verify-parallel / 删 post-merge-cleanup / 3 测试）。
- **最高代码水平**：as any=0（铁律 38，本任务无 src/ 改动天然 0）；契约优先 JSDoc（铁律 47）；降级诚实 log+degraded（铁律 24+31）；测试非空壳三路径（铁律 48）；bash 三态退出码 0/1/2（ctrl-tower-change 模式 1）；`2>/dev/null` 加 `swallow-ok` 注释或降级链路（不静默吞）。

## 3. 任务专属硬约束（违反 = 审计 FAIL）

- **依赖前置 + 基线核验**：上游 D539/D515/D537 已合 origin/main。**编码前首步**：`git fetch --all && git checkout origin/main`（或基于 origin/main 建**独立 clone**）。
  - ⚠️ **本任务本身就是「独立 clone」！** 你（编码 session）**应在独立 clone 中实现**（`git clone <remote> ../synova-clone-D540 && cd` + `bash scripts/install-hooks.sh`——顺带验证影子提交 clone 环境）。**禁止在本地 stale 的 `feat/d505-impl` 主树实现**（它的 post-commit.sh 是 V4.5.1 旧版无影子提交段，基线错会全盘错，M7 漂移）。
  - 开工前用 `git show origin/main:scripts/hooks/post-commit.sh | sed -n '69,87p'` 重核 L69-84 影子提交段 + L87 降级（防 M7 漂移——D524 教训）。
- **写集精确性**：只改 spec §5.1 写集表 8 项（4 修改 + 1 删除 + 3 新建）；`git diff --name-only` 与实际改动完全一致；禁"树终验声称不符"。
  - ⚠️ **不改** `scripts/hooks/post-commit.sh` / `scripts/control-tower/synova-commit`（机制已恢复 D537 #4，改动有 D530 二次覆盖风险——只验证不动机制）。**若以「验证需要」为由改这两文件 = 违规，停手问 CTO**。
- **诚实 RED**：LLM/外部依赖/上游产物不可用时如实标注 ⏸/❌ + 理由（README + evidence 双处），禁伪造绿、禁契约断言冒充全链路。影子提交验证是**物理断言**（真实沙箱 git + 真实 hook 链），禁静态 grep 冒充（M2 红线）。
- **evidence 落盘规范**：计时/断言/指纹（sha256）/时间戳落盘（evidence 目录），K3 独立重跑可复现；禁仅 task-state 单副本。**clone 磁盘/时间成本用实测值**（`du -sh` + `time git clone`），禁拍脑袋（派单交付要求 §④）。
- **红线**：不碰 `src/`（产品红线）、不碰 `scripts/audit/`（K3 专属）、零 DSH 依赖（Stage 3 前）、**不改** `scripts/pre-commit-check.sh`（13 组门禁本体）、**不改** `scripts/control-tower/worktree-manager.py`（试点期保留）、**不改** `scripts/workflow/task-start.sh`（D539 阻断已在——若 K3 判定需改引导文本 worktree→clone，单列 CTO 审，不并入本写集）。
- **环境坑**：本机 **无 global git identity**（`git config --global` 空）→ 独立 clone 后 `user.name/user.email` 缺失 → **影子提交必走 L87 降级**。这正是本任务「身份配置为前置」的物理依据——`install-hooks.sh` 的 `_ensure_clone_git_config` 必须配好（幂等只在缺失时写）。

## 4. 复核清单（做完逐项自查，K3 会盯着 + 最后审计）

- **与 dev doc 一致**：spec §10 DS1-11 逐项对照（S-2 声称=实现+验收，禁 overclaim）。**尤其 §10 边界 3 点如实标注**（非全量硬门禁 / task-start 引导文本单列 / loop-score 计 0），不把「试点」说成「全量落地」。
- **铁律**：接线完整（新 export 有**生产**调用点——`_ensure_clone_git_config` 在 install-hooks.sh、`verify-parallel --ci-pr` 在 ci.yml；测试调用不计 S-3，§8 逐条 grep）；降级诚实（24+31）；类型安全（38，本任务无 src/）；契约优先（47）；测试非空壳（48）；架构边界（39/46）。
- **无 bug**：spec §7 verify 命令逐条跑通 + 沙箱测试全绿 + pre-commit 全过（禁 --no-verify + synova-commit / 禁 git stash 铁律 0-3）。
- **接线完整**：spec §8 每条 grep 出真实生产调用点（install-hooks 配置函数 + ci.yml verify-parallel + 删 post-merge-cleanup grep 零引用）。
- **测试到位**：red→green 已证、三路径覆盖（正常/降级/边界）、expect 非空壳。**影子提交 harness**（clone-shadow-commit.test.sh）必须物理覆盖：identity 配置 → 真实 commit → **COMMITTED 追加 + 影子提交生成 + 树干净**；**identity 缺失 → L87 降级消息**（`git config --global` 真空、沙箱无 local identity 时 —「Author identity unknown」→ 断言 L87 触发）。
- **其他**：残留清理（死代码 grep 零——`post-merge-cleanup.sh` 删除后 `grep -rn "post-merge-cleanup" scripts/` 只剩 loop-score 检查存在项，非调用）；产物可复现性（幂等 + dry-run，`_ensure_clone_git_config` 幂等）。
- **自问**：影子提交在**独立 clone** 真实生成了吗？verify-parallel 真的移到 CI（本地不再 exit 1 拦）了吗？13 组门禁在 clone 内全绿了吗？（§10 DS1-7）

## 5. 审计提示

- **提审口径**：一次提审 = D540（本任务 1 个 D）。
- **验证点收口**：台账「影子提交恢复 + 并发冲突 0 + 拉平 1 + 门禁全绿」from claimed → verified（task-state/D540.json 的 impl 段须回填 `impl.commit` + `files[]`）。
- **task-state 回填要求**：实现提交后 `task-state/D540.json` 更新 impl 段 + status→impl_done（编码角色填）。**注意**：D540 json 已被我（dev-doc）更新为 spec_done + spec 段 + slice=clone-pilot——你只填 impl 段，**不覆盖 spec 段**。
- **脚本可复现**：审计员独立重跑 §7.1 三个测试 + §8 接线 grep——脚本必须幂等、零真实目录零网络、`mktemp` 沙箱 + `SYNO_*` 注入可复现。

## 6. 收尾

开始吧。
