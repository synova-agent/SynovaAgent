# STATUS.md — 当前状态（2026-10-21）

> ⚠️ 目标：本文件**应**由脚本自动生成（读 git / 测试 / 审计信号）；当前为人工维护件，**数字行内带取数命令**（可复跑）。
> 工程事实以 `docs/synova/DASHBOARD-CN.md`（自动生成）与 `docs/synova/audit-reports/` 为准。

- as_of 基线提交（本 PR 的 base tip，取数基线）：`1924f761e`（取数：`git rev-parse --short 1924f761e`）

---

## 一、一句话状态

**工程治理成熟，产品验证起步。** 控制塔 / 门禁 / 审计体系已成型；资产同步自动化（ASSET-MAP ＋ asset-sync.py ＋ workflow）已合入；产品在第一个付费客户（客户A）上做诊断验证。

## 二、工程事实（git 派生，逐行可复跑）

- 仓库提交总数（全史）：`5580`（取数：`git rev-list --count 1924f761e`）
- 仓库文件总数（tracked）：`5476`（取数：`git ls-tree -r 1924f761e | wc -l`）
- 最近提交日期：`2026-10-22`（取数：`git log -1 --format=%ad --date=short 1924f761e`）
- 控制塔版本（根件头部元信息）：`V5.2.7`（取数：`git show 1924f761e:AGENTS.md | grep -m1 -oE 'V[0-9]+\.[0-9]+\.[0-9]+'`）
- 根件版本（AGENTS.md 头部）：`V7.1`（取数：`git show 1924f761e:AGENTS.md | grep -m1 -oE 'V[0-9]+\.[0-9]+'`）
- pre-commit 组数（脚本横幅真值）：`12`（取数：`git show 1924f761e:scripts/pre-commit-check.sh | grep -cE '── 组 [0-9]+:'`）
- open PR（取数时点 = 本批建 PR 之前，活数；本批 PR 建立后该值加一）：`14`（取数：`curl -s -D - -o /dev/null -H "Authorization: token $(cat /Users/wane/gitea/.win-push-token)" "http://127.0.0.1:3000/api/v1/repos/synova-agent/SynovaAgent/pulls?state=open&limit=1" | grep -i '^x-total-count'`）
- 远端分支数（远端 = Gitea；不含本任务分支，避免自身在飞造成波动）：`1136`（取数：`git ls-remote --heads gitea | grep -vc 'refs/heads/ct/p6-807-1021'`）
- 任务编号：以 **Issue 号**为准（D 号已退役，见根件头部）；看板见 `DASHBOARD-CN.md`
- 协作：开发线（DSH 为开发者工具；Claude Code 已退役）＋ 审计线（K3），协议见 `docs/synova/coordination/`

## 三、产品事实

- 两大系统：GA 按需诊断 ＋ Sentinel 定时哨兵（均已接线）
- 专家数（registry 真值，根件声明同值）：`6`（取数：`git show 1924f761e:expert/expert-registry.yaml | grep -cE '^  [a-z0-9_-]+:$'`）
- 客户：客户A（第一个付费客户；建档与跟进见客户档案与卡，本件不复制历史日期）
- 本体图节点（DB 实测，本机取数／仓外数据件）：`0`（取数：`sqlite3 data/synova.db "select count(*) from graph_nodes"`）
- 本体图边（DB 实测，本机取数／仓外数据件）：`0`（取数：`sqlite3 data/synova.db "select count(*) from graph_triples"`）
- 因果边设计口径：见研究院仓权威设计文档（设计文档口径，**非 DB 实测**）

> DB 注：上两行取数命令需在**本机主工作区根**运行（`data/` 为仓外数据件，fresh clone 无此文件）；本机 DB **空且可用**（`PRAGMA integrity_check` 返回 ok）⇒ 值是**空库真值**，不是「取不到」。

## 四、风险清单（诚实版）

1. **文档-代码漂移**：历史上专家数 / 门禁组数多处不一致；现真值只从脚本与 registry 取（专家数见 §三、组数见 §二），历史分歧值不再复制。
2. **文档总量膨胀**：docs/ 下 md 份数 `541`（取数：`git -c core.quotePath=false ls-tree -r --name-only 1924f761e docs/ | grep -c '\.md$'`）；历史 Archive 不在主仓，无复跑命令（不复制旧值）。
3. **历史档案单点**：三代历史备份只在单机磁盘（路径与状态见备份策略 / 卡），异地副本未验证。
4. **早期历史缺口**：主要缺口创始人已补录；剩余小缺口见过程档案（本件不复制日期）。
5. **PRD 空缺**：新 PRD 仍为 draft 待创始人确认（版本看 `docs/authority/PRD.md` 头部）。

## 五、审计轨迹

- 审计报告以 `docs/synova/audit-reports/` 为准（报告自带日期与结论，本件不复制）：LLM failover、L4 数据契约、哨兵阈值、dedup-key、AGENT-CAPABILITY-FULL-CHAIN-AUDIT、AGENT-INFRASTRUCTURE-AUDIT 等
- 独立审计线：K3（`scripts/audit/**` 归 K3 专属，任何人禁碰）

---

*本文件将逐步改为自动生成；当前人工维护，数字行均带取数命令。*
