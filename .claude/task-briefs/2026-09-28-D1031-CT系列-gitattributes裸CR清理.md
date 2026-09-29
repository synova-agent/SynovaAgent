# Task Brief: D1031 CT系列-gitattributes裸CR清理

> 生成: 2026-09-28 | 任务: D1031 | 认领: gate-fix（SynovaAgent 专职小队编码成员）
> 参考: D333 决策四步（第一性原理→Anthropic→开源实证→收敛）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
控制塔**跨平台域（win）**，不涉五层产品架构（L1-L5）。两件互不相关的清理型交付：
- **L-CR**：`.gitattributes` 第 23 行**行中**有一个裸 CR 字节（注释里描述 CRLF 时误敲进去），
  会让"读该行的工具"看到伪换行（`^M`），属跨平台硬要求的破口。
- **L-M2**：清理 `/private/tmp/wt-ci` 工作树登记（已兵底；挂 4 个 staged 未提交文件）。

### b) 文件审计（file:line 实证）
- `.gitattributes`：全文件 32 行；`file` 输出 `with CR, LF line terminators`；
  字节级统计 = CR 总 1 / LF 总 32 / CRLF 0 / 裸 CR 1；位置 = **第 23 行第 28 列**（行中，非行尾）；
  该行语义 = `# CRLF 导致 bash 全线 "<CR>: command not found"（双平台 CI 必备）`。
  `.claude/bypass.log merge=union` 在 :14（D457/CT-47 在用，**禁动**）。
- `/private/tmp/wt-ci`：`git worktree list` 含该条 @ `ee721b0a`；`git status --short` 4 行
  （`A .claude/task-briefs/2026-09-26-D981-ci-concurrency.md` / `M .github/workflows/ci.yml` /
  `A memory/notes/implemented/2026-09-26-ci-concurrency.md` / `A task-state/D981.json`）。
- 域归属：`.gitattributes` = **win**（`check-ownership.py` 实测：与 mac 文件混放 ⇒ `❌ FAIL 跨域: ['mac','win']`）
  ⇒ 本卡独立成 win 域 PR，与 mac 域 PR 分开。

### c) 决策
- L-CR：**零逻辑变更卡** —— 只删那 1 个字节，不顺手重排/转换任何行尾（避免把"修 1 字节"变成"整文件 diff"）。
- L-M2：**删除型卡** —— 用"清前存在 / 清后不存在"的原始输出对照代替"改坏即红"。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- **第一性原理**：`.gitattributes` 本身是"行尾策略"的声明文件；它的**注释里**混入裸 CR =
  自我指涉的破口（声明 CRLF 规则的那行自己带 CR）。修正必须**只动那 1 字节**，否则 diff 会掩盖真实变更。
- **Anthropic 工程基线**：零逻辑变更要可证伪 —— 判据不止 `--stat`，还要 **字节级证明**（"唯一差异 = 删除 1 个 \r"）。
- **仓内教训**：铁律 0-3（禁 `git stash`）；D313-D316（Windows 跨平台：CRLF/UTF-8 静默失败）；
  D457/CT-47（`.claude/bypass.log merge=union` 在用，禁动）；D312（stash 事故）。
- **决策参考**：第一性原理（最小变更面）+ Anthropic（可证伪 + 字节级证明）+ 开源实证
  （`perl -ne if /\r/` 是仓内既有的裸 CR 探针；`git worktree remove --force` 是 git 官方对"有未提交变更的工作树"的
  唯一路径）+ 仓内先例（D328 三态退出码）→ 结论：**只删 1 字节** + **先验兵底充分性再执行破坏性操作**。

## Q2: 范围 — 正确的最简方案
做什么：
- .gitattributes — 删除第 23 行行中的那 1 个裸 CR 字节（零逻辑变更）
- docs/synova/product-lines/evidence/CT3-l-cr-gitattributes-20260927.md — L-CR 证据（判据①~⑤ + 字节级证明）
- docs/synova/product-lines/evidence/CT3-LM2-wt-ci-cleanup-20260928.md — L-M2 证据（清前存在/清后不存在 + 兵底核验）
- .claude/task-briefs/2026-09-28-D1031-CT系列-gitattributes裸CR清理.md — 本 brief（自身）
- task-state/D1031.json — 本任务登记（自身）
- .claude/bypass.log — post-commit hook 运行期追加（如实列出）

不做什么：
- 不改 scripts/audit/audit-rules.sh（K3 审计域红线）
- 不改 .github/workflows/ci.yml（只读调用方，非本卡写集）
- 不改 scripts/doc-system/doc-registry-gate.sh（属 mac 域 D1030，win 域 PR 不碰）
- 不改 scripts/control-tower/check-pr-budget.sh（属 mac 域 D1030，win 域 PR 不碰）

## Q3: 验收 — 入口 → 交互 → 结果
入口：L-CR = 任何读取 `.gitattributes` 的工具（Git for Windows autocrlf 策略解析 / CI shell）；L-M2 = `git worktree list` 的登记表。
处理：L-CR = 删 1 字节；L-M2 = `git worktree remove --force` + `git worktree prune`。
结果：L-CR = `.gitattributes` 不再含裸 CR（`perl -ne 'print "$.:$_\n" if /\r/'` 零输出），diff 恰 1 增 1 删、无 mode change；
L-M2 = `git worktree list | grep -c wt-ci` = 0 且目录不存在，兵底与远端保底分支完好。

## 架构层:
scripts（控制塔 / win 域）

## Done 标准
- [x] verify: `perl -ne 'print "$.:$_\n" if /\r/' .gitattributes` → 零输出（改前有第 23 行输出）
- [x] verify: `git diff --stat` → `1 file changed, 1 insertion(+), 1 deletion(-)`
- [x] verify: 字节级对照 `git show HEAD:.gitattributes` vs 工作树 → 唯一差异 = 删除 1 个 \r（其余 1934 字节逐字节相同）
- [x] verify: `git worktree list | grep -c wt-ci` → 0，且 `ls -la /private/tmp/wt-ci` → No such file or directory
- [x] verify: `md5 -q /tmp/L-M2-preserve/L-M2-staged.patch` → 8782eb941b020e1e046a170a86cbe79c（兵底未被破坏）
- [x] verify: `git ls-remote --heads origin | grep ci-concurrency-trigger-narrowing` → 保底分支仍在
