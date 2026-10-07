# ownership 登记制 → 发现制（目录内嵌标记 + 生成产物 + 漂移门禁）

- 状态: proposed（执行中，卡 #1233 / 父卡 #1221 门禁减法 v2.0 批次3）
- 决策人: 创始人（原则裁定「登记点 = 汇聚点 = 冲突点」，2026-10-07）；Lead 三条裁决落卡面
- 依据: DSH 上游形态（门禁与被检对象同目录、自动发现、无中央登记）+ 本仓 4 次同型事故实证

## 问题（第一性原理）

归属信息此前写在**一份中央文件** `docs/synova/coordination/ownership.yaml` 里
（2026-10-07 前为 mac/win/k3 三域 42 条 glob）。后果：
**每新建一个目录都要改同一份文件** ⇒ 登记点 = 汇聚点 = 冲突点。

实证（同型事故 ≥4 次，均为「新目录未登记 ⇒ 落 `**` 兜底 ⇒ 跨域硬阻断 ⇒ 补一行中央表」）:
| 事故 | 漏登记路径 | 后果 |
|---|---|---|
| D806 | `scripts/project/**`、`tests/project/**`、`docs/synova/project/**` | 同单内被 D734 判跨域硬阻断 |
| D914 | `docs/synova/dispatch/**`、`docs/authority/**`、`docs/synova/research/**` | 卡住 #703/#705/#706 三件 |
| D935 | `docs/synova/presets/**` | 补一行 |
| D911 | 记为「缺陷② 同族**第 5 次**」 | 机制未治 |

⇒ 创始人裁定原则：**登记点 = 汇聚点 = 冲突点**。治法是让登记点**就近入目录**。

## 决策

1. **真源 = 目录内嵌标记 `.synova-owner`**（发现制）：
   - 无标记的目录 → 继承**最近祖先**目录的标记；根标记 = 全仓默认
   - 需不同归属 → 只在该目录放一个标记，**零中央登记**
   - 新增/移动/删除目录 ⇒ 标记随目录走，不动任何中央文件
2. **中央产物降级**：`docs/synova/coordination/ownership.yaml` 与 `.github/CODEOWNERS`
   均为 `check-ownership.py` 的**生成产物**，非登记入口。
3. **漂移门禁逐字节**：`--check-drift` 断言「已提交产物 == 现树重生成结果」，**逐字节**
   （不是"内容等价即过"——否则产物会被手工改回去，真源再次分裂）。违规则 exit 1。
4. **三态边界**（D328）：
   - exit 1 = **违规**：标记被改/删致产物过期、根标记缺失、越域
   - exit 2 = **检查自身失败**：非 git 仓、标记语法错（未知键/重复键/空值/缺 owner）、
     owner 键缺 handle、handle 二义、无输入、解析器不可用
5. **标记格式严格 fail-closed**（白名单键 `owner`/`handle`/`note`；未知键即 exit 2，
   不静默忽略——静默忽略正是"改了没生效"的来源）。

## 关键取舍（写清理由，非默认）

- **发现用 `git ls-files` 而非 walk 文件系统**：免疫 worktree / `node_modules` / `.pnpm-store`
  里同名标记的**假发现**（本仓工作目录内挂有大量 worktree）；且新标记 `git add` 后即被看见
  （提交端门禁的准确语义）；同时免 BSD/GNU `find` 差异（PLATFORM-CHECKLIST）。
  ⇒ **重要边界：只认 git index 中的标记，untracked 标记一律不生效**（verifier 实测钉死；
  夹具 §12b 正反双证：untracked ⇒ 不生效且 rc=0；`git add` 后 ⇒ 即生效且未重生成产物则 rc=1）。
- **标记缺失不是错误，产物不一致才是**：继承是正常语义 ⇒ 「删标记」的红来自**漂移**，
  而非「无归属」。这把"忘了登记"从静默变成必红。
- **根标记缺失：校验面 exit 1 / 生成面 exit 2**（R1 整改，取舍显式化）：
  · **校验面**（默认 / `--owner` / `--check-drift`）⇒ **1**：树与产物不一致是**仓库状态的错**，
    不是校验器自己坏了 —— 且本卡判据②明定「删/改标记 ⇒ exit 1」。
  · **生成面**（`--emit-ownership` / `--emit-codeowners`）⇒ **2**：生成器**产不出有效产物**
    （无 `**` 兜底），按 D328「绝不与通过混同」拒绝产出。
  · 整改前实测不一致：`--emit-codeowners` 已是 2，而 `--emit-ownership` **rc=0 且吐出无兜底的
    ownership.yaml**（静默劣化）⇒ 现两入口统一走 `has_catchall()` 守卫，**半成品不再泄漏**。
- **保留 `--yaml PATH` 作为显式覆盖缝**：既有测试与夹具靠它注入多 owner 副本，
  用以证明判定**真读数据**（反 grep 型静态恒绿）；默认路径则走发现制（真接线）。
- **不新增阻断点**（Lead 裁决）：v2.0 方向是减法。漂移门禁落在校验器自身默认路径
  （已被 2 个既有调用方消费，非假接线），**不**由本卡接入 pre-commit / ci.yml 阻断面。

## 已知未接线面（诚实留痕，不虚称已接线）→ R2 已裁「接」

- `check-ownership.py` 今日**无阻断型消费者**：
  `check-pr-budget.sh` ② 段自 2026-09-29 起为「信息性，不阻断」；
  `scan-fullwidth-vars.sh` 显式把 exit 1 当正常。⇒ 漂移虽判 exit 1，**本卡落地时点尚不阻断合并**。
- **Lead 2026-10-07 裁决（R2）= 接**，接入点定为 **`.github/workflows/ci.yml` 的 Gate Integrity job
  加一步**（blocking —— 它守的是生成物真源）；该文件属**线 B 写集**，由 Lead 在**统一注册 PR** 里
  一并落，本卡不越界。**这是判据变更，由 Lead 出 K3 送审件。**
- 本卡为此提供的保证（CI 环境可复跑，实测）：
  ```
  # 干净 clone（CI 等价：无 untracked、无 worktree 状态）+ 最小 env + /usr/bin/python3
  $ for i in 1..5; do env -i PATH=/usr/bin:/bin python3 .../check-ownership.py --check-drift; done
  rc=0 ×5  （确定性，无环境依赖；退出码契约 = 0 新鲜 / 1 漂移 / 2 自身失败）
  ```
- `tests/control-tower/check-ownership.test.sh` **未登记 CI 密封清单**
  （`grep -c check-ownership .github/workflows/ci.yml` = 0，走 ci-registry 基线豁免）
  ⇒ 本卡夹具目前**不在 CI 执行**；是否登记由 Lead 在注册批决定。

## 判据（可复跑）

```bash
bash tests/control-tower/check-ownership.test.sh              # 83 项全绿（原 34 项）
python3 scripts/control-tower/check-ownership.py --check-drift   # exit 0 逐字节新鲜
git ls-files .synova-owner                                    # 恰 1 行（根标记）
```

## 标识沿革与 D# 撞号（本日第 3 次，附门禁连带缺陷）

本任务编号被 `alloc-task-id.sh` 连撞三次，均按 `check-name-allocation.sh` 复核后仍撞：

| 取值 | 撞上谁 | 发现时点 |
|---|---|---|
| D1201 | `DG-预算制报告`（已在 main） | 取号即复核发现 |
| D1204 | 线 B《D-F/① CI 判据单源化》（PR #1262 合入） | **merge main 时 add/add 冲突**才发现 |
| D1207 | main 上《project-coordinates-auth-hotfix》 | merge 后 `git diff` 才发现 |
| **D1208** | —（定稿） | — |

根因：`alloc-task-id.sh:88-89` 自述「读 max→写 max+1 无原子性」（D454/D455 同型），
且**看不见尚未落在 main 的他线在飞编号**。

**门禁连带缺陷（本次新发现，值得进判据库）**：commit 主体含 D1204（历史不可改、禁 force push）
⇒ D708 `merge_writeset_gate.infer_did` 的 ② 提交主体回退**取到 D1204** ⇒ 载入 **main 上线 B 的 D1204 brief**
的声明写集 ⇒ 本 PR 的 8 个文件被全部判为「写集外夹带」而 **block**（CI 实测 + 本地复现同结论）。
即：**一次撞号会同时污染「写集对账」这道合并级门禁**，且报错指向上游任务的声明写集，排障成本高。
闭环修法（本 PR 采用）：`git log` 新→旧、② 取**最新**含 D# 的提交主体 ⇒ 顶端补一条主体含 D1208 的
提交即正确锚回本任务 brief（已本地验证由 block 转 pass）。

**收敛决定**：既然 D# 正在退役（#1222 D-C「D# 退役换 GitHub issue 号」），
**代码/产物/标记已改为只引「卡 #1233」**（撞号免疫）；D# 仅留在过渡期机械件（brief 文件名 + 台账）。
Note 文件名亦去掉 D# 后缀（与既有约定一致，如 `2026-10-07-gate-reduction-v2.md`）。

## 相关

- 卡 #1233（D-I）· 父卡 #1221（门禁减法 v2.0）· plan `.claude/plan-v2-remaining.md` 线 D
- 前次尝试 PR #1238（已关闭）：目标是**清分域**（另一件事，其数据面已由他批落地）
- 相邻面 PR #1247（check-ownership.py 去 stale 三域名）已合入 main `9ff47a725`
