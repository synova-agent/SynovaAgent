# .github/ · 施工守则

> GitHub 侧门禁与政策面：PR 到 main 的 12 个必需检查全部由这里产出。

## 一、这块是什么（≤3 句）
`workflows/`（5 个；`ci.yml` 10 个 job 产出 main 分支保护的 12 个必需 context）+ `CODEOWNERS`（**生成产物**）+ `ISSUE_TEMPLATE/`、`pull_request_template.md`、`dependabot.yml`（**仓内零消费者**，实测 grep 0 命中）。
真生产入口是 **GitHub Actions 本身**：本地绿不算完成，须跑到 PR check-run。

## 二、谁可以改（归属 + 越界）
- **归属是两条线，勿当整域同属（实测）**：`workflows/**` + `CODEOWNERS` → **mac／治理线**（`ownership.yaml:151,154`）；`ISSUE_TEMPLATE/**` + `dependabot.yml` + `pull_request_template.md` → **win**（落 `**` 兜底，`ownership.yaml:35`）。
- **改一块必须同时改**：
  - 改任一 job 的 `name:` ⇒ 同步 `scripts/control-tower/required-checks-baseline.txt`（12 条逐字）；失配 ⇒ 该 check 永不上报 ⇒ PR 永久 blocked。
  - 改 `ci.yml` 的 docs-only 白名单 ⇒ **10 处内联副本同改**（实测唯一形态数=1；无门禁断言一致性）。
  - 改 `CODEOWNERS` ⇒ 只改 `docs/synova/coordination/ownership.yaml`，重跑 `python3 scripts/control-tower/check-ownership.py --emit-codeowners > .github/CODEOWNERS`（文件头即"请勿手改"）。
- **越界判定**：`python3 scripts/control-tower/check-ownership.py <文件> --owner mac`；对 `ISSUE_TEMPLATE/bug.md` 实测 `❌ 越域 … 实际 owner=win`。
- ⚠️ 本件 `.github/AGENTS.md` 机器归属实测=**win**（落兜底），与「治理线」口径冲突 ⇒ 改本件先问 CTO。
- **越界找**：归属争议 → CTO；必需集语义变更见 §五。

## 三、改完怎么算完成
- **必须穿的生产入口（本地等价物，均实测通过）**：
  1. `python3 scripts/control-tower/check-required-contexts.py` → `12/12 命中 / REQUIRED-CONTEXTS: OK`
  2. `SYNO_CI=1 bash docs/synova/product-lines/evidence/D1023-861-docsonly-guard.sh` → `20 PASS / 0 FAIL / HARD`
  3. `bash scripts/control-tower/check-gate-integrity.sh` → `GATE-INTEGRITY: OK`
  4. 动了 workflow ⇒ `bash scripts/control-tower/ci-signal-classify.sh --files .github/workflows/ci.yml` → `HIT ⇒ run=true`
  5. 终判以 PR 上 check-run 为准；`synova-submit.sh:51` 提交链已拉 `simulate-ci.sh`。
- **本域独有红线**：
  - `ci.yml` 是那 12 个必需 context 的**唯一产出者**：job `name:`／matrix 展开名不得乱改；`needs:` 上游红时禁用 job 级 `if:` 静默 skip（context 会消失）。
  - `control-tower-tests` **禁止 job 级 `paths:` 过滤**（`ci.yml:358`）。
  - `ci.yml:17` 的 `merge_group:` 是 merge queue 的物理先决条件（D1070）⇒ 删了队列永不出 required check。
  - `npm audit` 是必需 context 但 `continue-on-error: true`（2026-08-16 创始人豁免，`ci.yml:683`）⇒ 不得擅自撤豁免；升级条件=上云/公网化。
  - `ci.yml` **无 `permissions:` 块**（其余 4 个 workflow 均有）⇒ 补权限块【待定】：尚未立案，先问 CTO。
- **「改坏即红」最小用例（已实测）**：
  - A 把 `Architecture Check` 改成 `Architecture CheckX` ⇒ 入口 1 `EXIT=1 / VIOLATION / 11/12 命中`。
  - B 把 `.gitattributes` 加回白名单 ⇒ 入口 2 `EXIT=1 / 18 PASS 2 FAIL`。
  - C 手改 `CODEOWNERS` 一行 ⇒ `--emit-codeowners` 与文件不再一致；该夹具**未接 CI**，须手跑 `bash tests/control-tower/check-ownership.test.sh`。
  - D 删 `golden-case` job ⇒ `tests/ci/golden-case-gate.test.ts` 两条正则转 false。

## 四、不在这里的事
门禁脚本本体（`scripts/**`）→ 治理线；铁律与流程模板 → 根件；代码分层/接线 → 各产品线域。

## 五、不确定找谁
| 问题类型 | 找谁 |
|---|---|
| 必需 context／分支保护语义变更 | K3 → CTO |
| workflow 触发器、`permissions:` 收敛 | 治理线（mac/DSH） |
| 域归属（mac vs win） | CTO |
