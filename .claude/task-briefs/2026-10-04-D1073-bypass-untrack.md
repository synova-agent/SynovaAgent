# D1073：bypass.log 停跟踪 + 对账改账本来源（126/136 PR 冲突的单一来源）

> 卡: #1073（p0）｜归属: 治理线｜坐标系: 执行态=开发中｜批次=清仓组阶段0｜命名空间=治理｜验证级别=L2-真跑通｜阻塞源=无

## Q0:
a) 项目拼图: 控制塔 × git 提交链。`.claude/bypass.log` 是 append-only 运行期证据账本，
   **被 git 跟踪** ⇒ 每次 commit（post-commit hook 追加 + 影子登记提交）都改它 ⇒ 每条分支必带它
   ⇒ 两分支必冲突。实测 126/136 个 open PR 都改它；#946/#947 13/13 全绿但 CONFLICTING，冲突文件只有它。
b) 文件审计: 写者 `scripts/hooks/post-commit.sh::_bypass_append`（双写：旧路径 + per-session）；
   账本解析 `scripts/control-tower/bypass-ledger.sh`（D735 Stage 1 已建 `.sessions/<sid>/` 新落点）；
   读者 `check-bypass-log.sh`（pre-push 门禁 7 对账）、`pre-commit-check.sh`（GATEKEEPER + 7c 审计）、
   `gen-cto-health.py`（健康度）、`ci/verify-d703.sh`（DS5/DS8 证据）。合并策略声明 `.gitattributes`（merge=union）
   + `install-hooks.sh`（注册 union driver）。
c) 决策: **停跟踪（不是搬位置）** —— CTO 裁决 D3 明确否掉"移到 .codex/（仍受跟踪 ⇒ 冲突照旧）"。
   本卡做 Stage 2a：停跟踪 + 删影子提交段 + 幂等判据（按 HASH）；Stage 2b（其余读者切数据源）另卡。
   复用: 全部复用 D735 Stage 1 的 per-session 落点，不新增机制。

## Q1:
a) 业界最佳实践: 运行期产物不进版本控制（判例 M-05）；GitHub 不执行 .gitattributes 自定义驱动
   （M-06：本地 merge=union 干净 ≠ 服务端干净）⇒ "靠合并策略兜冲突"结构上不成立，必须源头停跟踪。
b) memory 历史教训: D735 Stage 1 已把"新落点可写可读"跑起来，派单明确"不许一个 PR 切完" ⇒ 本卡是 Stage 2。
   D521/D537 的影子提交是"让树保持干净"的补丁，其根因是"文件受跟踪"；根因一除，补丁即可删。
c) 决策参考: 参考 Anthropic/DSH（诊断与主路径分离、机制只增不减即失败）——本卡**净减一个机制**（影子提交）。

## Q2:
做什么:
  - `.gitignore` 增 `.claude/bypass.log`；`git rm --cached`（停跟踪）
  - `.gitattributes` 删 `.claude/bypass.log merge=union` 声明
  - `scripts/install-hooks.sh` union driver 注释/文案改为 reference-map.md 专用
  - `scripts/hooks/post-commit.sh`：账本权威化（per-session 先写、失败回落镜像且显式告警）；
    **删影子登记提交段**；新增 `_ledger_has_hash` 幂等判据
  - `scripts/control-tower/check-bypass-log.sh`：fail-closed 判据由"单文件存在"改为"全部来源皆空"
  - 夹具：`tests/control-tower/bypass-untracked.test.sh`（新，改坏即红）、`post-commit.test.sh`（Stage 2 重写）、
    `clone-shadow-commit.test.sh`（Stage 2 重写）；ci.yml 密封清单登记新夹具
不做什么（含文件路径）:
  - 不改 `scripts/pre-commit-check.sh` 的 GATEKEEPER/7c（镜像仍写 ⇒ 读者继续可用；切换属 Stage 2b）
  - 不改 `gen-cto-health.py` / `ci/verify-d703.sh`（同上，Stage 2b）
  - 不改 `scripts/audit/**`（K3 红线）；不改任何 ci.yml 的 job `name:`

## Q3:
入口: `git commit` → `.git/hooks/post-commit` → `scripts/hooks/post-commit.sh`
处理: 判定 → `_bypass_append`（per-session 权威 + 本地镜像）→ 按 HASH 幂等登记
结果: 账本可查（`bash scripts/control-tower/bypass-ledger.sh read`）；工作树零变更；
      对账 `bash scripts/control-tower/check-bypass-log.sh <base>` 仍有数据源

## 本任务在哪一层
工具层（scripts/hooks + scripts/control-tower + .gitignore/.gitattributes + tests）

## Done 标准
① `git ls-files .claude/bypass.log` 无输出（停跟踪）
② 新提交后 `git status --porcelain` 不出现该文件
③ 对账仍有数据源：`bash scripts/control-tower/bypass-ledger.sh read | grep -c HASH` > 0
④ 消费方改前/改后逐条列出（PR 正文）
⑤ 改坏即红：`bash tests/control-tower/bypass-untracked.test.sh` rc=0（含"回退停跟踪 ⇒ 两分支必冲突"重现）
⑥ 全量回归：CI 密封清单 58 条夹具 rc 全 0

## 写集（机器生成，禁手改）

| 文件 | 类型 |
|---|---|
| .claude/task-briefs/2026-10-04-D1073-bypass-untrack.md | task |
| .gitattributes | task |
| .github/workflows/ci.yml | task |
| .gitignore | task |
| memory/notes/proposed/2026-10-04-d1073-bypass-untrack.md | task |
| scripts/control-tower/check-bypass-log.sh | task |
| scripts/hooks/post-commit.sh | task |
| scripts/install-hooks.sh | task |
| tests/control-tower/bypass-untracked.test.sh | task |
| tests/control-tower/clone-shadow-commit.test.sh | task |
| tests/control-tower/post-commit.test.sh | task |
