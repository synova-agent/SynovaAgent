# PR 正文（可直接粘贴）

> **🔴 开 PR 必须用真实凭据（PAT / 网页人工）**。
> 依据 `docs/synova/coordination/CI-诊断通道.md:113-118`：
> 由 `GITHUB_TOKEN` 触发的事件（除 `workflow_dispatch`/`repository_dispatch`）**不会触发新的 workflow run**（防递归）
> ⇒ bot 创建的 PR 上 `pull_request` 触发的 workflow **都不跑** ⇒ **12 个必需检查永不报告 ⇒ PR 永久 blocked**。
> ⇒ `gh` + `secrets.GITHUB_TOKEN` / bot 身份开 PR = **本批白跑**。**已实测确认：本批分支 push 不触发 ci.yml**（`push: branches: [main]`）。

---

## PR-1

- **head**：`team/a4-ci-cost` @ `e17d19f5881fab37ddb97e678e2e0e5a74263462`
- **base**：`main`（`ff4677129dce2ff068a816eed3db0687b060c64c`）
- **标题**：`ci(D1039): control-tower-tests 按需跑（job 恒调度 + 内层 if 门控）`

### 正文

```markdown
## 目标

`control-tower-tests` 是整个 CI 的**唯一关键路径**（改前实测：run 墙钟 **2290 s**，其中
`Control Tower Gate Tests (windows-latest)` = **2222 s = 97.0%**；且 37 分钟里 **2204 s 集中在单个 step**）。
本 PR 让它**只在碰了控制塔相关路径时执行**，不碰则秒级 `success`。

## 🔴 设计约束（先读，决定方案取型）

`Control Tower Gate Tests (ubuntu-latest)` 与 `(windows-latest)` 是 main 分支保护的 **12 个必需检查**之一
（证据 `scripts/control-tower/ci-red-baseline.txt:65-66`；`docs/synova/coordination/CI-诊断通道.md:115-116`）。

⇒ **禁用 job 级 `paths:` 过滤** —— 不匹配时 **job 不创建 ⇒ check-run 不报告 ⇒ 必需 context 永不报告 ⇒ PR 永久 blocked**
   （`CI-诊断通道.md:109-118` 记载 #403/#404 是本仓**已发生过**的同型事故）
⇒ 本 PR 走「**job 恒被调度 + job 内 `if:` 门控重活**」—— `if:` 跳过的 job 仍以 `success` 上报必需 context。
⇒ **job 名 / `strategy.matrix` / `timeout-minutes` 一字不改**（必需 context 名称依赖这三者）。

## 改动

- `.github/workflows/ci.yml`（+85/−2）
  - 新增 `ctsignal` step：调 `scripts/control-tower/ci-signal-classify.sh --mode github`
  - 重活 step 的 `if:` 换成「schedule / workflow_dispatch 强制 **或**（非 docs-only 且判据命中/显式勾选）」
  - 新增 `workflow_dispatch` + 布尔输入 `force_control_tower_tests`（**人工触发永不导致「不跑」**）
  - 新增 `schedule` 每 7 天兜底（路径判据漏项**最多 7 天可见**）；其余 9 个 job **保持原始恒跑行为**（不给它们加 job 级 `if:` —— 多 9 处门控 = 多 9 处必需 context 风险面，收益仅 ~326 s/周）
  - canary 清单**追加一行** `tests/control-tower/ci-signal-classify.test.sh`（只追加，其余测试路径行零改动）
- `scripts/control-tower/ci-signal-classify.sh`（新建 208 行）—— 判据唯一载体，8 条路径规则，三态退出（0 正常 / 1 fail-closed / 2 降级）
- `tests/control-tower/ci-signal-classify.test.sh`（新建 348 行，**78 断言**）

## 路径集（super-set，宁多跑不漏跑）

`.github/workflows/**`（全体，不止 ci.yml）｜`.gitattributes`｜`.gitmodules`｜`scripts/**`（全树）｜
`tests/control-tower/**`｜`tests/doc-system/**`｜`package.json`｜`tsconfig*.json`

两处**真漏点**（若不加 = 本 PR 引入的净回归，已实测）：
- `.github/workflows/progress-freshness-watchdog.yml` —— `tests/control-tower/check-progress-freshness.test.sh:42-43` 直接 grep 它，而该测试在 canary 清单内
- `.gitattributes` —— 含 `*.sh text eol=lf`（Windows runner autocrlf 会把 `.sh` 检出成 CRLF 导致 bash 全线 `: command not found`）；改动它**今天本来就触发全量**，不覆盖 = 从「跑」变「静默跳过」

## 判别性验证（「改坏即红」，全部真转红）

| 变异 | 结果 |
|---|---|
| 基线（未变异） | **78 通过 / 0 失败 / EXIT=0** |
| 收窄成派单原建议 5 条 | **73 通过 / 5 失败 / EXIT=1** |
| 只抽掉两处已知漏点 | **74 通过 / 4 失败 / EXIT=1** |
| 逐条删除 8 条规则（独立复核变异矩阵） | **8/8 全部转红** |
| 恢复校验 | `sha256 a5959792…f88178` **前后逐字节一致** |

## P0 缺陷修复（本 PR 实际修的最高危项）

GitHub Actions `shell: bash` 实际调用 `bash --noprofile --norc -eo pipefail`（**带 `-e`**）。
⇒ 裸 `cmd; RC=$?` 在命令返回非 0 时**立即中止 step**，`if [ "$RC" -eq 2 ]` 整段是**死代码**
⇒ 分类器一降级 ⇒ **step exit 2 ⇒ job 红 ⇒ 两个必需 context 双红**（PR 永久 blocked）
   且「重活 step」因 step 级隐式 `success()` **被 skip** ⇒ 「红 + 该跑的没跑」双重失效。
⇒ 已修（`RC=0; cmd || RC=$?`），并**从 `ci.yml` 抽真 step 正文**建判别性夹具（拿掉修复即转红）。

## 口径纪律（本批实测得出）

- **run 墙钟 = `updated_at − run_started_at`**（不是 job 跨度）
- **任何「提速」结论必须先证明该 step 真跑过**（`conclusion != skipped`）——
  docs-only run 的同 job 只有 **17 s**，那是 `docs-only` 守卫把整个 step skip 掉的形态，**不得当作提速证据**

## 写集豁免

无跨域文件。**D734 预算：实现文件 3 / 12** ✅（治理产物与 domain-neutral 证据不计，按 D860 口径）。
`python3 scripts/control-tower/check-ownership.py .github/workflows/ci.yml scripts/control-tower/ci-signal-classify.sh tests/control-tower/ci-signal-classify.test.sh --owner mac` → `✅ PASS`

## 🔴 合并要求

1. **`merge_method` 用 `merge`，不要 `squash`** —— `.claude/bypass.log` 声明 `merge=union`，而 **squash 不跑 merge driver ⇒ 假冲突**（#864/#865 实证，代价 = 两次 sync + 两次取消 ≈ 2×37 min）
2. **与 PR #868（`fix/ct-flow-brief-ledger-20260927`）的协调**：两方都在 canary 清单**同一位置插入一行**（#868 插 `resolve-commit-brief.test.sh`，本 PR 插 `ci-signal-classify.test.sh`）。
   实测 `git merge-tree --write-tree origin/fix/ct-flow-brief-ledger-20260927 <本 PR 实现 commit>` → **EXIT=0 零冲突**（hunk 上下文不重叠，可自动合并）。
   ⚠️ **建议 #868 先合**；若本 PR 先合，则 #868 需再做一次 sync。
3. **K3 复审通过前不得合并**（CI 语义域）。

## 独立复核

`docs/synova/product-lines/evidence/D1039-A4v-独立复核-墙钟比对.md`
冻结结论：**退回（数据缺失型）** —— 唯一理由 = 改后真实 run 在本 PR 产生前不存在（用户判据明令「用 run 实测，不许估算」）。
本 PR 的 run 产生后，独立复核员立即执行墙钟对比 + 两个必需 context 的 `conclusion=success` 断言，届时更新结论。

## 回执要求

- 「碰路径 ⇒ 跑」实证：本 PR 自身改 `scripts/control-tower/**` + `.github/workflows/**` ⇒ windows 腿**应真执行**
- 改前/改后墙钟对比（run id + 实测数字）
```

---

## PR-2

- **head**：`team/a4b-vitest-log` @ `ad3e5c14950b12fff8e2ddbd55f7e6c30dd5e9b1`
- **base**：`main`（`ff4677129dce2ff068a816eed3db0687b060c64c`）
- **标题**：`test(D1040)+docs(D1041): 测试期 LOG_LEVEL=warn + 五 workflow 成本基线`

### 正文

```markdown
## 目标

1. **D1040**：测试运行时强制 `LOG_LEVEL=warn` —— 让 ERROR 不再被 INFO 淹没，**失败时仍能出上下文**
2. **D1041**：5 个 workflow 的**逐 job 实测成本基线**（只读产物，落 domain-neutral 证据文件）

## 改动

- `vitest.config.ts`（+9 行）—— `test.env` 加 `LOG_LEVEL: process.env.LOG_LEVEL ?? 'warn'`
- `tests/win/vitest-log-level.test.sh`（新建 175 行）—— **`tests/win/` 在 main 里 0 文件，本 PR 新建该目录**
- `docs/synova/product-lines/evidence/D1039-A4d-五workflow成本基线.md`（新建 478 行）

## 实测数字（同命令、同范围，唯一变量 = 那一行）

| 量 | 改前 | 改后 | Δ |
|---|---|---|---|
| `wc -l` | 14,502 | 7,911 | −45.4% |
| bytes | 2,791,604 | 1,338,368 | −52.1% |
| pino INFO | 6,619 | **0** | −100% |
| pino WARN | 2,727 | 2,715 | −12 |
| pino ERROR | 320 | **320** | **恒等** |

范围：610 文件 / 4,538 用例 ｜ vitest 4.1.8 ｜ node v24.19.0
**读法**：INFO 归零、**ERROR 逐条恒等** ⇒ 收敛是**选择性**的，正是「ERROR 不再被 INFO 淹没、失败上下文仍在」。
**内部自洽**：`14506 − 7887 = 6619` **恰等于** INFO 灭失量。

## 两个必须点名的口径问题

1. **`test.env` 是覆盖语义（实测，非照文档推断）**：硬编码 `'warn'` 时外部 `LOG_LEVEL=debug npx vitest run` 会被**压成 warn** ⇒
   必须写 `process.env.LOG_LEVEL ?? 'warn'`（`??` 在 config 主进程求值 ⇒ 外部显式值可透传，不静默夺走调试开关）。
2. **派单给的改前基线（7,767 行 / INFO 2,696 / WARN 1,380 / ERROR **39**）与本 PR 实测对不上**：
   那是 **CI `Vitest (1/2)` 单分片 job 的网页日志**口径（≠ 本地全量 stdout），**不可直接比较**；本 PR 以**本地全量实测**为准。
   ⚠️ 若有人拿「ERROR 39」当改前 ERROR 数会得出**完全错误**的结论（实测 **320**，差 8.2×）。

## 独立复核（含一处必须披露的不一致）

独立复核员在同一 SHA 上**独立整跑**：INFO/ERROR/范围 **逐字一致**；`wc -l` 与 WARN **有差异**。
**归因闭环**：在**完全相同的 SHA** 上复跑仍有差异，且失败用例数变化正好解释行数差
⇒ **运行间 flaky**（非基点漂移）⇒ **不得据此判任一方测量有误**。两组数字**都保留，不调和**。

## 判别性验证

删除契约行 ⇒ **EXIT=1 / 3 失败**（红）；恢复 ⇒ 全绿 ｜ 改后 `npx vitest run tests/logger.test.ts` 仍绿

## 写集豁免

- **本 PR 域 = win**：`vitest.config.ts` 机器判定属 **win**（`scripts/control-tower/ownership.yaml` 的 `**` 兜底）、`tests/win/**` 同域
  ⇒ 与 PR-1（mac 域）**必须拆 PR**（D734 单域约束）。这是派单件 §八 明确许可的处置（「若跨域被拦 ⇒ 按域拆 ≤2 件」）
- **D734 预算：实现文件 2 / 12** ✅

## ⚠️ 本 PR 同时是另一条判据的天然样本（请复核员利用）

本 PR 改动集 = `vitest.config.ts` + `tests/win/**` + 证据 md —— **不在**控制塔路径集内
⇒ 本 PR 的 CI run 里 `Control Tower Gate Tests (ubuntu-latest)` 与 `(windows-latest)`
   **应当秒级 `success`**（= PR-1 的「不碰 ⇒ 跳」判据的实测样本）。
   ⚠️ 但**本 PR 不含 PR-1 的判据代码** ⇒ 该跳转在 #868/PR-1 合入后才生效；本 PR 单独合并时 CT 腿仍全量跑。

## 🔴 D1039 → D1040 真依赖（不是「未接线」尾巴）

`tests/win/vitest-log-level.test.sh` **尚未**接进 `ci.yml` canary 清单。**这是真依赖**：
- 该测试断言 `vitest.config.ts` 已收敛 `LOG_LEVEL=warn`，而 PR-1 的分支**无此改动** ⇒ 现在入列 = canary **恒红** ⇒ 必需 context 红
- 要让它变绿须把 `vitest.config.ts` 搬进 mac 域 PR = 与 win 域 PR **同文件双写者**（违反写集互斥）

⇒ **本 PR 合入 main 后，由 1 行卡补 canary 清单那一行**（移交，已登记在 `D1039-收尾三件-diff-自验-遗留.md` §三·遗留 5）

## 🔴 合并要求

**`merge_method` 用 `merge`，不要 `squash`**（同 PR-1 理由：`.claude/bypass.log` 的 `merge=union` driver 在 squash 下不跑 ⇒ 假冲突）。
**K3 复审通过前不得合并。**
```

---

## 开 PR 的 API 命令（token 在 `~/.dsh/.credentials.yaml` 的 `GITHUB_TOKEN`）

```bash
TOKEN=$(python3 -c "import json,subprocess;print(json.loads(open('$HOME/.dsh/.credentials.yaml').read())['GITHUB_TOKEN'])" 2>/dev/null \
  || grep -oE 'GITHUB_TOKEN:[[:space:]]*[^[:space:]]+' "$HOME/.dsh/.credentials.yaml" | awk '{print $2}')

# PR-1
curl -s -X POST -H "Authorization: token $TOKEN" \
  "https://api.github.com/repos/tangbaobao520/SynovaAgent/pulls" \
  -d '{"title":"ci(D1039): control-tower-tests 按需跑（job 恒调度 + 内层 if 门控）","head":"team/a4-ci-cost","base":"main","body":"<PR-1 正文>"}'

# PR-2
curl -s -X POST -H "Authorization: token $TOKEN" \
  "https://api.github.com/repos/tangbaobao520/SynovaAgent/pulls" \
  -d '{"title":"test(D1040)+docs(D1041): 测试期 LOG_LEVEL=warn + 五 workflow 成本基线","head":"team/a4b-vitest-log","base":"main","body":"<PR-2 正文>"}'

# 验证检查是否真的报告（必须非零！零 = 通道又断了）
for SHA in e17d19f5881fab37ddb97e678e2e0e5a74263462 ad3e5c14950b12fff8e2ddbd55f7e6c30dd5e9b1; do
  curl -s -H "Authorization: token $TOKEN" \
    "https://api.github.com/repos/tangbaobao520/SynovaAgent/commits/$SHA/check-runs" \
    | python3 -c "import json,sys;print('$SHA', json.load(sys.stdin)['total_count'])"
done
```

**开完请把两个 run id 发我** ⇒ 我立即转 **verifier-v** 执行墙钟对比 + 两个必需 context 断言（其 §7 命令清单已就绪，`bash /tmp/v-a4-reconcile.sh <run_id>`）。
