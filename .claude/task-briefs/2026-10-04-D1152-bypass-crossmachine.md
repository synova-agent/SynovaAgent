# D1152：#1075 阻塞根修 —— 跨机证据链（待记录集合）+ 夹具 hermetic 化

> 卡: #1075（PR #1075 / 分支 fix/D1145-bypass-untrack）｜归属: 治理线｜坐标系: 执行态=开发中｜批次=清仓组阶段0｜命名空间=治理｜验证级别=L2-真跑通｜阻塞源=独立复核阻塞项（本地实测，不依赖 CI）

## Q0:
a) 项目拼图: 控制塔 × git 提交链 × pre-push 门禁 7。D1145 把 `.claude/bypass.log` 停跟踪后，
   COMMITTED 证据行**不再随 git 走**（这是停跟踪的必然代价，不是意外）——于是「对账器怎么知道
   哪些提交需要记录」从"文件随 git 传播"变成了"必须按本机视角重算范围"。本卡修的是这个口径。
b) 文件审计: 对账方 `scripts/control-tower/check-bypass-log.sh`（范围 = merge-base(BASE,HEAD)..HEAD，
   来源 = per-session 账本 ∪ 本地镜像）；上游 `scripts/pre-push-check.sh:420-445` 门禁 7 调用它；
   夹具 `tests/control-tower/check-bypass-log.test.sh`（对账语义）、
   `tests/control-tower/post-commit.test.sh`（hook 登记语义 + 停跟踪判别性）。
c) 决策: **最小修——不加新机制、不恢复被跟踪账本**。两处口径收紧：
   ① 对账范围收窄为「本机要新推的提交」（已是 `<远端>/<当前分支>` 祖先 ⇒ 他机已过闸 ⇒ 跳过；
   ref 取不到 ⇒ 不过滤 = fail-closed）；② 「全部来源皆空 → exit 1」条件化（先算待记录集合，
   空集 ⇒ exit 0；非空且无来源 ⇒ 仍 exit 1）。夹具侧：沙箱只投放被驱动脚本（消同仓 git 竞态）。

## Q1:
a) 业界最佳实践: 门禁的判据必须是**本机可判定的物理事实**。「别人机已过闸」在 git 里的物理表达
   就是"已推到远端"（`merge-base --is-ancestor <sha> <remote>/<branch>`）——不引入新账本、
   不引入新协议，只把范围口径从"分支全部新提交"收窄为"本机新增提交"。
b) memory 历史教训: D513（Win 37dc1cae）已证「`git push <URL>` 不更新 remote-tracking ref ⇒ 陈旧
   ref 判祖先会误判」，故祖先判定前必须 fetch 刷新；D508（范围 merge-base 化）已证"范围口径错 ⇒
   噪音/误拦"；D451（纯补记豁免）打断「补记→新提交→再缺」死循环。三条语义在本卡全部保留。
   夹具侧教训（复核席实测 100 轮 94 绿 / 4 假红 / 2 中止，6 轮带 index.lock）：**假红的指控方向是
   门禁自己**（"marker 缺失仍登记=洗白绕过"、"证据丢失"）⇒ 维护者会照着错断言去"修"被测代码。
   根因: 沙箱 `ln -s $REPO/scripts` + 委托整 hook ⇒ 真 `external-auditor --dispatch` 与
   `decide-next.sh &`（其 :57 `git status --porcelain` 会刷新并重写 index）在同仓跑 git。
c) 决策参考: 参考 Anthropic/DSH（机制只增不减即失败；失败要 fail-closed 且可解释）——
   本卡**净减**一处机制残留（沙箱整树委托），并把"夹具自身失败"与"产品缺陷"在退出码上分开。

## Q2:
做什么:
  - `scripts/control-tower/check-bypass-log.sh`: ① 待记录集合（D451 豁免 + 他机已过闸过滤）；
    ② 空集 ⇒ exit 0（fresh clone 典型态）；③ 非空且来源全空 ⇒ exit 1（fail-closed 保留）；
    ④ 祖先 ref 先 fetch 刷新；⑤ ref 不可解析 ⇒ 不过滤 + 显式说明（首次推送不得免检）
  - `tests/control-tower/check-bypass-log.test.sh`: 全部用例改 hermetic 沙箱（bare 远端 + A 机 + 真 clone
    的 B 机）；锁死两头（fresh clone ⇒ 0；本机新提交无记录 ⇒ 1）+ 首推不免检 + 他机提交不误列
  - `tests/control-tower/post-commit.test.sh`: 沙箱只投放被驱动脚本（post-commit.sh + bypass-ledger.sh），
    无 auditor/decide-next 可达；每个"应当是提交"的动作 fail-fast（rc=0 且 HEAD 前进）+
    「应当是失败」的动作反向断言；失败报 `fixture: commit did not happen` 并 exit 3
不做什么（含文件路径）:
  - 不改 `.github/workflows/ci.yml`（含 job `name:` — 12 必需 context 的唯一产出者）
  - 不改 `scripts/pre-commit-check.sh`（GATEKEEPER/7c 语义属 Stage 2b，另卡）
  - 不改 `scripts/hooks/post-commit.sh` 的已定行为（登记/幂等/降级语义保持原样，本卡零改动）
  - 不碰 `scripts/audit/**`（K3 红线）；不碰 `scripts/workflow/**`
  - 不引入新机制、不恢复被跟踪账本（`.gitignore`/`.gitattributes` 不动）

## Q3:
入口: `git push` → `.git/hooks/pre-push` → `scripts/pre-push-check.sh` 门禁 7 → `check-bypass-log.sh <base>`
处理: base 可解析性（fail-closed）→ 范围 merge-base 化 → 待记录集合（D451 豁免 + 他机已过闸过滤）
      → 空集 exit 0 / 非空 → 来源存在性 → HASH 对账
结果: 三种终态可解释——`无待记录提交`(0) / `N 条本机待推提交全部有记录`(0) / `缺记录清单 + exit 1`；
      fresh clone（来源全空）不再假红；他机已过闸提交不再被重复索要记录

## 本任务在哪一层
工具层（scripts/control-tower + tests/control-tower；不触产品五层 L1-L5）

## Done 标准
① fresh clone：`cd /tmp && rm -rf fc && git clone <本仓> fc && cd fc && bash scripts/control-tower/check-bypass-log.sh origin/main` → rc=0
② 本机新提交无记录（真 clone 内外均验）→ rc=1（不许放宽）：`bash tests/control-tower/check-bypass-log.test.sh` 含该断言
③ `bash tests/control-tower/post-commit.test.sh` 连跑 20 轮 rc 全 0（flake 率 0）
④ 故障注入：`PATH=/tmp/fakegit:$PATH FAKEGIT_N=8 bash tests/control-tower/post-commit.test.sh` → 报 `fixture: commit did not happen`、exit 3（不得出现"洗白绕过/证据丢失"类产品指控）
⑤ `bash scripts/control-tower/check-gate-integrity.sh` → `GATE-INTEGRITY: OK`
⑥ 相邻夹具零回归：bypass-ledger / bypass-union-merge / tag-bypass-wiring / clone-shadow-commit / pre-audit-summary / post-commit-marker / synova-commit 全 rc=0

## 写集（机器生成，禁手改）

| 文件 | 类型 |
|---|---|
| .claude/task-briefs/2026-10-04-D1152-bypass-crossmachine.md | task |
| memory/notes/proposed/2026-10-04-d1152-bypass-crossmachine.md | task |
| scripts/control-tower/check-bypass-log.sh | task |
| tests/control-tower/check-bypass-log.test.sh | task |
| tests/control-tower/post-commit.test.sh | task |
