# Task Brief: P10 · 两仓对账探针（check-dual-repo-sync.sh ＋ 每日 cron）（Issue #609）

> 分支: `ct/p10-609-dual-repo` ｜ 起点: `gitea/local-main` @ `695ada515`（实测 `git rev-parse --short HEAD`）
> 卡: #609（数据面对账）｜ 上游: K3 审计 #594（commit `14e7177`）P1-2 ＋ K3 P11（假绿陷阱已证）
> 域守则（均显式 read）: `scripts/control-tower/AGENTS.md` ｜ `tests/control-tower/AGENTS.md` ｜ `.gitea/AGENTS.md` ｜ `memory/notes/AGENTS.md`
> 本件是 pre-commit 组 6 要求的声明载体（gate-mandated companion），**不是交付件**（交付件 = 下列 3 件）

## Q0: 定位（项目拼图 + 文件审计）

**a) 项目拼图**：P10 双仓与生态面 · 数据面对账。现状：两仓 sha 差**无人自动算、无人报警**（K3 P1-2 点名"没卡、没 owner"）；且判据 3 的常用写法 `git rev-list --count mirror/main..local-main` 会因**本地指针落后**得出 **0（假绿）**（K3 P11 实证）。
**b) 文件审计**：`grep -rln "dual-repo\|two-repo sync" scripts/control-tower/ tests/control-tower/` ⇒ **0 命中** ⇒ 确需新建；三态退出码/降级范式见 `check-merge-conditions.sh`、`check-gate-integrity.sh`；CT-40 配对规则见 `scripts/control-tower/ct-test-gate.sh`；`.codex/control-tower/tmp/` 已在 `.gitignore:62`（结果 JSON 落此处不污染仓）。
**c) 决策**：新建 1 个探针 ＋ 1 个配对测试 ＋ 1 条独立 workflow；**不新建机制族**，复用三态退出码／「看不见≠没问题」／「只读」三约定。

## Q1: 调研（业界最佳实践 / 决策链 / memory 历史教训）

**a) 业界最佳实践**：三态退出码（0/1/2）＋ fail-closed ＋ 判别力自检（改坏必红）；「钉 SHA 不钉分支」（根件 §12）。
**b) 决策链**：CTO 2026-10-19 令 —— ① 每日算差并落固定路径 ② 差≠0/停摆 ⇒ 可见告警 ③ 读不到 ⇒ exit 2 ④ 改坏必红：假绿必须被自己拦掉；**runner 单点不属本包**（归 P4 门禁域）。
**c) 历史教训**：K3 P11（`mirror/main..local-main`=0 假绿）⇒ 本探针**绝不读本地同名分支**，只从 `ls-remote`/GitHub API 取远端真值；D316/D317 环境误判 ⇒ 取数三路（注入缝 → gh → 匿名 API）＋ 失败一律 degraded。

## Q2: 范围 — 正确的最简方案是什么？

做什么（写集，逐文件；裸路径独立成行）：
- scripts/control-tower/check-dual-repo-sync.sh
- tests/control-tower/check-dual-repo-sync.test.sh
- .gitea/workflows/dual-repo-sync.yml
- .claude/task-briefs/2026-10-19-609-dual-repo-sync.md
- memory/notes/proposed/2026-10-19-dual-repo-sync-probe.md

不做什么（禁碰，含路径）：
- scripts/audit/（K3 专属）
- scripts/pre-commit-check.sh ／ .gitea/workflows/local-gates.yml（阻断腿语义不改；本探针与它分离）
- .github/workflows/（深度腿）
- src/ ／ extensions/（任何业务代码）
- required check 语义 ／ 分支保护（S2 的事）
- 系统级设置（pmset/launchctl）——不执行，只给可复制命令（本条不产出该命令：属 P4 卡）
- 主树 /Users/wane/SynovaAgent（禁写）

## Q3: 验收（入口 → 交互 → 结果）

**入口**：`bash scripts/control-tower/check-dual-repo-sync.sh [--json] [--help]`；环境缝 `SYNO_SYNC_*`（见头部契约）。
**交互**：三态退出码；末行 `DUAL-REPO-SYNC: OK|LAG|FORK|DEGRADED … as_of=<ISO> out=<路径>`；JSON 落 `<repo>/.codex/control-tower/tmp/dual-repo-sync.json`。
**结果**（原始输出为准）：
- 配测 `bash tests/control-tower/check-dual-repo-sync.test.sh` ⇒ **15 通过 / 0 失败**、exit 0
- 🔴 改坏必红：夹具里 `git rev-list --count <gh_main>..local-main` = **0**（假绿），探针仍 ⇒ `LAG lag=2`、exit 1
- 降级：Gitea 远端不可达 ⇒ `DEGRADED reason=gitea_unreadable`、exit 2（JSON `degraded=true`）
- 真实现场（as_of 2026-10-19T14:10+0800）：`LAG lag=120 gitea=695ada515 github=49ddc63ee`、exit 1
- workflow：`grep -c "check-dual-repo-sync.sh" .gitea/workflows/dual-repo-sync.yml` ⇒ ≥1

## Q4 契约与测试

- 头部契约 `@input/@output/@exit/@degraded`＋设计哲学＋「已知限制」4 条；纯 bash（macOS bash 3.2 兼容）；UTF-8 强制；静默吞错处均带 `# swallow-ok:` 理由（失败均落到 degraded，不吞）。
- 配测全沙箱（`mktemp` ＋ 本地 bare 仓当远端），零网络、零真实仓库写入；覆盖三态＋分叉＋假绿陷阱＋`--json`。

## 本任务在哪一层

基础设施（控制塔巡检面；不触 L1–L5 业务代码）

#CRITERIA: D
<!-- #CRITERIA 补记：历史件无单一归属证据，按 criteria-code-map 兜底 D（L1 #645，2026-10-20） -->

## Done 标准

- [ ] verify: cd /Users/wane/SynovaAgent/.synova-wt-p10-609 && bash tests/control-tower/check-dual-repo-sync.test.sh; test $? -eq 0
- [ ] verify: cd /Users/wane/SynovaAgent/.synova-wt-p10-609 && bash scripts/control-tower/check-dual-repo-sync.sh --help; test $? -eq 0
- [ ] verify: cd /Users/wane/SynovaAgent/.synova-wt-p10-609 && test "$(grep -c 'check-dual-repo-sync.sh' .gitea/workflows/dual-repo-sync.yml)" -ge 1
- [ ] verify: cd /Users/wane/SynovaAgent/.synova-wt-p10-609 && test "$(grep -c 'scripts/audit' scripts/control-tower/check-dual-repo-sync.sh)" -eq 0
