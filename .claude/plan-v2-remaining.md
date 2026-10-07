# v2.0 剩余任务执行计划（Lead 版 · 2026-10-07）

> 目标：完成门禁减法 v2.0 剩余 65%。原则：**按写集分线，同文件串行，异文件并行；每线先夹具后实现；独立复核后方可合并。**

## 一、写集分线（唯一防止冲突的手段：同文件只归一条线）

| 线 | 任务 | 写集（唯一所有者） | 阻塞关系 |
|---|------|------------------|---------|
| **A 标识与提交端** | D-C（R1-R7 全部）+ D-A2（pre-commit 收敛）+ D-D（旁路清场） | `scripts/control-tower/{brief_parser.py,staging_guard.py,merge_writeset_gate.py,synova-commit,self-health.py,incident-loop.py}` · `scripts/workflow/{resolve-commit-brief.sh,commit-msg-check.sh}` · `scripts/{pre-commit-check.sh,check-verifiable-done.sh,check-brief-vs-code.sh}` · `gate-integrity-baseline.txt` · 新 `scripts/control-tower/claim*.py` · 对应对夹具 | 无（可立即开工） |
| **B CI 面** | D-E 余项（Vitest changed/nightly + 夹具去重）+ D-F（判据单源 + 发现制）+ #1215（CT-34 merge 级对账） | `.github/workflows/ci.yml` · `tests/control-tower/ci-signal-classify.test.sh` · `scripts/control-tower/required-checks-baseline.txt` · `docs/synova/product-lines/evidence/D1023-861-docsonly-guard.sh` | 与 A 零交集，可并行 |
| **C 文档契约** | #1251（X1/X2/X3 逃逸 + 性质夹具）+ #1252（过渡表机器化 + 落盘 + 计数防腐）+ #1214（SIGPIPE flake） | `scripts/control-tower/validate_doc_contract.py` · `docs/authority/DOC-CONTRACT.md` · `tests/doc-system/*` · `tests/control-tower/check-required-contexts.test.sh` | 无 |
| **D ownership** | D-I（目录内嵌归属 + CODEOWNERS + 校验器改发现制） | `scripts/control-tower/ownership.yaml` · `scripts/control-tower/check-ownership.py` · `.github/CODEOWNERS` · 对应对夹具 | 无 |
| **E 坐标系** | D-H（7→3 字段规格 + 存量处置） | `docs/synova/CTO-ROLE.md`（仅 §7.3 段）· `scripts/control-tower/check-project-coordinates.sh`（字段集） | **板侧字段变更需创始人 GitHub admin**（我停下问） |

## 二、每条线的强制纪律（写进 teammate 提示词）
1. **夹具先行**：每个判据变更先交 red→green 夹具 + 变异体（改坏即红）。
2. **三态退出码** 0/1/2；禁 `|| true` 吞崩溃；禁裸 `python3`（PYBIN 三级探测 + D520 标记注释）。
3. **提交**：`bash scripts/control-tower/synova-commit --task-id <issue或D号> --agent <线名> --message "..."`（禁 `--no-verify`）。
4. **分支与工位**：各自 `git worktree add ~/SynovaAgent/.synova-wt-<线> -b <branch> origin/main`；禁直推 main；禁 force push。
5. **K3 协议**：改「哪条检查阻断合并」的判据 ⇒ 先出送审件（Lead 统一编排送 K3）。
6. **报告格式**：① 判据通过率（逐条+可复跑命令）② 例外清单 ③ 在飞/卡数。

## 三、独立复核（创始人指定角色）
- **verifier**（非作者、非编码者，fresh context）：对每条线的 PR 逐项复核：
  a) 夹具是否真判别（自造反例复跑，不采信作者自测）；b) 有无静默降级/纸老虎；c) 判据强度是否下降；
  d) 写集是否越界；e) 与 K3 要求（R1-R7）是否逐条对应。
- 复核通过后由 **Lead 合并**（Lead 持 workflow scope），串行：一次只合一个，合完等 GitHub 重算。

## 四、验收（全局）
| # | 判据 | 复跑命令 |
|---|------|---------|
| 1 | 常规提交全程 <30s | `time bash scripts/pre-commit-check.sh` |
| 2 | 新任务零 D#；声明两字段生效 | `ls .claude/claims/ && grep -c 'D[0-9]' <新声明>` |
| 3 | 10 消费点全切 claim 库，旧 D# 只读不劫持 | 夹具 a/b/c 三场景 |
| 4 | CI 绿且墙钟 ≤5m | `gh run view <id> --json createdAt,updatedAt` |
| 5 | 判据单源：docs-only 正则零内联副本 | `grep -c 'docs/.+\\.(md|json|html)' .github/workflows/ci.yml` = 0（引用单源文件） |
| 6 | ownership 发现制：新增目录零中央登记 | 夹具（删标记 ⇒ 红） |
| 7 | #1251 三逃逸复跑全红 | K3 附录三命令 |
| 8 | 每条线交付含「改坏即红」证明 | PR 正文 |

## 五、停止条件（遇即停，问创始人）
1. 需 GitHub admin 动作（板侧字段 7→3、规避保护设置）；
2. K3 整改超出现有 scope 或与创始人批准口径冲突；
3. 出现无法串行化的写集冲突（两线必须同文件同时间改）；
4. main/CI 出现非本团队引入的红且 30 分钟未定位。

## 六、串行合并序（Lead 执行）
```
B(D-E) → C(#1214) → C(#1251/#1252) → D(D-I) → A(阶段1 claim库) → A(10 消费点) → A(D-A2+D-D) → E(D-H，待 admin)
```
（原则：先合零风险、后合判据变更；每次合并后等 main 重算再动下一个。）
