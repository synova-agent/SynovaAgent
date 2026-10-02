# Task Brief: D937 gate-failopen-fakegreen

> 生成: 2026-09-24 | 任务: D937 | 认领: d937-c1（编码A·门禁本体）
> 参考: D333 决策四步（第一性原理→Anthropic→开源实证→收敛）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
L0 控制塔工具层（非 L1-L5 产品运行时）。对象 = `scripts/pre-commit-check.sh` 组 7a
「禁止新 DiagnosticModule」。该组自 D467（ab05e2de, 2026-08-21）的 BRE→ERE 迁移起恒过
（fail-open 假绿）：`grep -Ev` 模式含未转义 `^+++`（非法 ERE）→ 管道整体失败 →
`NEW_DIAG` 恒空 → 检查恒判通过。本任务让该检查真实可判别，且不引入误伤。

### b) 文件审计
- `scripts/pre-commit-check.sh:990-992` — 组 7a 全文（行号自 origin/main 2cda1528 实测）
  - `:991` = 出问题管道：`... | grep -Ev "scripts/pre-commit-check.sh|.md|.html|//|@deprecated|import type|^+++|hard_check|禁止新 DiagnosticModule|不要再使用 DiagnosticModule" || true`
- `scripts/pre-commit-check.sh:49-68` hard_check / `:105-124` soft_check — 命中/未命中两态，无"降级"态
- `scripts/pre-commit-check.sh:262-286` — D390 武装注入缝（`SYNO_TEST_ARM=1` 才生效）
- `tests/control-tower/hard-gate-convergence.test.sh:59` — 结构断言钉住组 7a 的
  `soft_check "禁止 DiagnosticModule: 新模块须实现 Sentinel 接口"` 字面串（**必须保全**）
- `tests/control-tower/grep-oP-regression.test.sh:255 行` — 同族「grep 语法 → 检查静默失效」回归网
  （D661/D664/D718）；实测其金值断言**不触及**组 7a 行（`grep NEW_DIAG|DiagnosticModule` 零命中）
- `.github/workflows/ci.yml:84` — pre-commit-check.sh 生产调用；`:186/:208` control-tower-tests
  双平台矩阵（ubuntu + windows）；`:255` 密封测试清单
- `docs/synova/coordination/ownership.yaml:88` — `scripts/pre-commit-check.sh` 归属 mac

### c) 决策
复用既有形态、不新建机制族：修复落在组 7a 本体 + 同族回归网扩展；**不新增门禁组**
（组数是下游真值源，改组数会连锁打破既有断言）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 铁律 11（静默降级禁止）+ 铁律 24/31：`|| true` 吞掉 grep 自身错误（exit≥2）→ 与"无命中"不可区分。
- 铁律 0-2（接线验收）/ 铁律 48（三路径）：夹具必须跑生产脚本本体，不得测副本。
- 铁律 35（自动化优先）/ 铁律 37（dead code 入仓库即违规）：恒过的门禁 = 死检查。
- `ctrl-tower-change` 模式 1：门禁三态退出码（0 通过 / 1 业务阻断 / 2 检查自身失败），
  禁止 `|| true` 吞崩溃；禁止只探存在性不探可用性。
- memory/ 同族教训：D328（探存在性不探可用性）、D661/D664（BSD grep 无 `-P` → 检查静默失效，27 处）、
  D718（BOM 顶掉 shebang）、D390（注入缝必须武装，生产路径 fail-closed）。
- 决策参考：第一性原理（门禁的价值 = 可判别；恒过即零价值 + 假绿负价值）
  + Anthropic 基线（fail-closed：检查自身失败必须不等于通过，铁律 11）
  + 开源实证（POSIX ERE 中 `+` 出现在 `^` 后无操作数 = 未定义行为，BSD grep 报 exit 2）
  → 结论：**转义/结构化 + 三态退出码 + 逐文件豁免**，不新增组。
  参考：Anthropic/DeepSeek/第一性原理 + 结论=转义+三态+逐文件豁免，不新增组

## Q2: 范围 — 正确的最简方案
做什么：
- `scripts/pre-commit-check.sh` 组 7a（L990-992）：
  ① diff 头（`+++ b/<path>`）改为**结构化判定**（字符串比较，免正则）→ 根除非法 ERE 类
  ② `grep` 退出码**三态**：`rc≥2`（模式非法/grep 不可用）→ 显式降级 + `degraded-events.log`，
     **绝不判 ✅**；CI strict 下转硬失败
  ③ 文件级豁免（检查器自身 / `.md` / `.html`）改为**按文件**判定（原按行子串匹配 → 实测误报）
  ④ 行级注释豁免**锚定** `^\+\s*(//|/\*|\*|#)`（原裸 `//` → `#`/`*` 注释实测误报）
  ⑤ **保全** `soft_check "禁止 DiagnosticModule: 新模块须实现 Sentinel 接口"` 字面串
- `tests/control-tower/gate-failopen-net.test.sh` — 新建：夹具 T1-T5 + 家族 ERE 编译网 + 反向金丝雀
- `.github/workflows/ci.yml` — 新测试入 control-tower-tests 密封清单
不做什么：
- 不改 `scripts/audit/**`（K3 红线）
- 不改 `scripts/control-tower/check-ownership.py`、`docs/synova/coordination/ownership.yaml`（卡 3/卡 5 写集）
- 不改 `tests/control-tower/hard-gate-convergence.test.sh`（保全其结构断言）
- 不改 `tests/control-tower/grep-oP-regression.test.sh`（与本卡零耦合，避免无谓冲突面）
- 不改 `scripts/control-tower/alloc-task-id.sh`（卡 2 写集）
- 不改 `src/**`、`packages/**`（非本卡域）
- 不改 `scripts/pre-commit-check.sh` 其他 12 组判定逻辑与组数（避免连锁）

## Q3: 验收 — 入口 → 交互 → 结果
入口：`bash scripts/pre-commit-check.sh`（本地 pre-commit hook / CI Iron Laws job，ci.yml:84）
处理：读 `GIT_CACHED_DIFF` → 逐文件过滤 → 行级豁免 → 命中则 soft_check（CI strict 转硬）
结果：干净树 ✅；含 `DiagnosticModule` 新增 → CI strict 下 ❌ + exit 1；
      检查自身失败 → 显式降级输出（不判 ✅）

## 写集

| 文件 | 类别 |
|---|---|
| `scripts/pre-commit-check.sh` | task（写者 d937-c1，仅组 7a L990-992 及其相邻注释） |
| `docs/synova/product-lines/evidence/D937-改动清单.md` | task（写者 d937-c1） |
| `tests/control-tower/gate-failopen-net.test.sh` | task（写者 d937-c2，新建） |
| `.github/workflows/ci.yml` | task（写者 d937-c2，仅密封清单 +1 行） |
| `docs/synova/product-lines/evidence/D937-夹具原始输出.md` | task（写者 d937-c2） |
| `docs/synova/product-lines/evidence/D937-自验.md` | task（写者 d937-v，独立自验） |
| `docs/synova/product-lines/evidence/D937-收尾与回执-20260924.md` | task（写者 lead，M6 收尾三件 + 团队运行记录，治理产物） |
| `.claude/task-briefs/2026-09-24-D937-gate-failopen-fakegreen.md` | builtin（本 brief，队长治理产物） |
| `docs/synova/product-lines/evidence/D937-CI-GNU-方言返修.md` | task（CI 方言返修证据，#762 返修，写者 coder-a） |
| `.claude/task-briefs/2026-09-24-D937-gate-failopen-fakegreen.md` | task（本 brief 随卡演进：#762 返修补写集 include，写者 coder-a） |

## 架构层: scripts（控制塔门禁域，非 L1-L5）

## Done 标准
- [ ] verify: `SYNO_TEST_ARM=1 SYNO_CI=1 SYNO_GATEKEEPER_ACK=1 SYNO_SKIP_PARALLEL_WARN=1 SYNO_GIT_CACHED_DIFF='+const x = new DiagnosticModule();' bash scripts/pre-commit-check.sh` → exit 1 且点名组 7a（改前实测为 exit 0 + `✅ 全部 13 组通过` = 假绿）
- [ ] verify: `bash tests/control-tower/gate-failopen-net.test.sh` → 全绿（T1-T5 + 家族网 + 金丝雀）
- [ ] verify: 判据② 无误伤 — `git show 58a19796` 真实文档样本经组 7a 管道 → 0 命中
- [ ] verify: 变异体 M1-M5 逐条「改坏 → 夹具红」+ `git checkout` 复原 → 绿
- [ ] verify: `bash scripts/control-tower/check-pr-budget.sh` PASS（≤12 文件 / 单域）
