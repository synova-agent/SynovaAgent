---
状态: proposed
日期: 2026-10-07
决策: staging_guard.py 整件退役 —— 本地暂存区隔离改为「只读归属呈报」，判据面移交 CI D708 写集对账
理由: 见下（K3 R1「认领制退役」项；同一判据三套实现必然漂移）
---

## 决策内容

1. **整件退役**：`scripts/control-tower/staging_guard.py` 删除（不保留空壳/桥接件）。
   其两条判据的去向：
   - ① 认领制身份比对（D329 段）→ 由 `resolve-commit-brief.sh` 防劫持
     ＋ **CI D708 合并级写集对账**（`merge_writeset_gate.py`，声明源 S0 = `claim.writeset`）承担。
   - ② 他人活跃写集阻断（registry 面）→ **文件级精度在本级取消**；同风险类仍有三处载体：
     `task-start.sh` D515 项1（开工）／`pre-commit-check.sh` 组 6 D537 #2（提交端主树占用）／
     CI `verify-parallel.sh --ci-pr`（inter-PR）。
2. **本地不新增阻断**：退役后 `synova-commit` 的暂存段只做**只读归属呈报**
   （单一入口 `claim_store.py --resolve`），不判红 —— 避免"删一套判据再补第三套"。
3. **禁静默空白（铁律 11）**：呈报段**恒定**打印退役结论；`claim_store`/python 取不到数据时
   打印**显式降级行**（三种降级路径：python 不可用 / claim_store 缺失 / 自身 rc≠0）。
4. **逐消费点处置**（退役不留悬空引用）：

   | 消费点 | 处置 |
   |---|---|
   | `synova-commit`（唯一真实调用点） | 改读 claim（只读呈报） |
   | `self-health.py` CORE_COMPONENTS | 摘除（否则组件存在性检查**恒定 degraded**） |
   | `incident-loop.py` R1 工具表 | 换为 `merge_writeset_gate.py`（真承担者） |
   | `session_registry.py` 文档串 | 改述（原"供 staging-guard 查询"已成假声称） |
   | `tests/…/staging_guard.test.sh` | 删除 → 由 `staging-guard-retirement.test.sh` 承接 |
   | `tests/…/staging-guard-session.test.py`、`test-staging-guard.py` | 删除（import 对象已不存在） |
   | `tests/…/synova-commit.test.sh` | 断言对齐现行为（含 D706/D370 潜伏陷阱修复） |
   | `.github/workflows/ci.yml` | **零引用**（无需改动） |

## 为什么（第一性原理）

判据的价值来自**单一事实源**，不来自实现次数。staging_guard 的认领制判定在 D-C 落地后
已有两处更强承载（resolver 守卫 + D708 对账）：本地那份既不能覆盖 PR 整体（只看暂存区），
又引入第三套解析口径（K3 R1 定罪形态）——**留着不是防线，是漂移源**。

## 代价与已知边界（诚实声明）

- **文件级他人写集阻断取消**：退役前"暂存文件 ∈ 他人活跃写集 → 硬阻断"在本级消失。
  粗粒度同风险类仍在（见上三载体），但**精确到文件**的本地预判没有了。此代价已写进
  `synova-commit` 段注释与 PR 正文「判据变更点」，供 K3/CTO 复核是否需回补。
- **`resolve-commit-brief.sh --session` 生产调用点归零**：其唯一生产调用方即退役件
  （D331 P2-2 的接线落点）⇒ 该 flag 成为**只读保留**（仍实现、测试可调、无生产调用方）。
  是否复接或退役该 flag，需另卡裁决（本卡只登记，不静默）。
- **退役前无法自证等价**：未做"旧件 vs 替身"行为对照实验（旧件已删）。判断依据是
  *判据面归属*（谁权威）而非逐用例等价，故登记为边界而非已证事实。

## 关联

- 卡：D1223（本件）／父 D-C 标识归一
- K3：R1「认领制退役」项
- 夹具：`tests/control-tower/staging-guard-retirement.test.sh`（6 结构断言 + 5 变异体 + 对照组）
- 承接件：`tests/control-tower/merge_writeset_gate.test.sh`（D708 本体判据，不在本卡写集）
