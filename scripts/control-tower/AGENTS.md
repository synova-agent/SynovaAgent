# scripts/control-tower/ · 施工守则

> 本域 = 门禁物理执法层。改这里 = 改全仓「红/绿」的定义。

## 一、这块是什么
78 个顶层文件（34 `.sh`·32 `.py`·3 `.ts`·4 `.json`·3 `.txt`·`synova-commit`·`PLATFORM-CHECKLIST.md`）＝控制塔与门禁脚本本体，由 git hooks/`synova-commit`/CI 调用，只产出「通过·阻断」与基线棘轮。近 30 天实测 72 改动/62 commit。测试在同级 `tests/control-tower/`。

## 二、谁可以改
- **归属**：治理线（Mac DSH）。`ownership.yaml:73` → `scripts/control-tower/** = mac`。
- **改这块必须同时改的**：
  1. 任何**行为变化** ⇒ 同 commit bump `.codex/control-tower/VERSION.md` 并打 tag（`synova-commit` 自动；`pre-push-check.sh:143` D319 只查不补）。
  2. 改判定或新增脚本 ⇒ 同步测试，并登记进 `.github/workflows/ci.yml` 密封清单。
  3. 新增 `scripts/{control-tower,workflow}/**/*.sh|py` ⇒ 对照 `PLATFORM-CHECKLIST.md` 9 条（禁裸 `python3`/`timeout`·CRLF 清洗…）。
  4. 改判定或 job 结构 ⇒ 同步 `gate-integrity-baseline.txt`·`ci-red-baseline.txt`·`required-checks-baseline.txt`（12 条必需 context，禁手抄）。
  5. 新增 `.md` ⇒ 登记 `docs/authority/DOCS-REGISTRY.yaml`（`doc-registry-gate.sh` 拦未登记新增件）。
- **越界判定**：`python3 scripts/control-tower/check-ownership.py <文件…>`；输出含两域即 `❌ FAIL 跨域` exit 1。
- **越界找**：门禁语义变更（判定逻辑/退出码/job 结构）→ 治理线提案 → **K3 过审 → CTO 裁**；`scripts/audit/**` 是 K3 红线不碰。

## 三、改完怎么算完成
- **必须穿的生产入口**（实测调用方，非 grep 命中）：
  - git pre-commit → `scripts/pre-commit-check.sh`（`ct-test-gate.sh`·`verify-claims-table.sh`·`session_registry.py`）
  - git pre-push → `scripts/pre-push-check.sh`（`session_registry.py`·`verify-parallel.sh`·`baseline-check.sh`）
  - git post-commit → `scripts/hooks/post-commit.sh`（`bypass-ledger.sh`·`external-auditor.sh`）
  - CI → `.github/workflows/ci.yml`：`control-tower-tests`（`ci-signal-classify.sh`+密封清单）·`gate-integrity`·`quality`（`merge_writeset_gate.py`）
  - `scripts/control-tower/synova-commit` — 唯一合规提交入口（提交后自动打 tag）
- **本域独有红线**：
  1. **三态退出码**：0=通过/1=违规/2=检查自身降级或执行失败——**2 同样阻断**；禁 `|| true` 吞崩溃。
  2. 承载必需 context 的 job **禁 job 级 `paths:`**、`if:` 须锁死已登记冻结表达式；新增 `needs:` 下游 job 必须登记（否则其 check-run 永不上报）。
  3. 逃生舱与降级路径必须写 `.codex/control-tower/logs/degraded-events.log`（不静默）。
  4. **纸老虎不算门禁**：每条判据须有判别性夹具（改坏即红）；棘轮台账只减不增，条目失效/过期即红。
- **「改坏即红」最小用例**（本次实跑）：
  - 新增 `tests/control-tower/zz.test.sh` 且不登记 ci.yml ⇒ `bash scripts/control-tower/check-gate-integrity.sh --registry-only` 输出 `VIOLATION: 新增测试未登记 CI 密封清单`+`GATE-INTEGRITY: VIOLATION(1)`，**exit 1**；删掉即回 `OK`。
  - 把 ci.yml 的 `Control Tower Gate Tests` 改名 ⇒ `python3 scripts/control-tower/check-required-contexts.py --workflows <副本>` 输出 `REQUIRED-CONTEXTS: VIOLATION(2)`，**exit 1**。

## 四、不在这里的事
审计标准与 `scripts/audit/**` → K3（红线）；文档真相防线 → `scripts/doc-system/**`；控制塔**显示层**（`app/control-tower.html`·`app/js/control-tower.js`）与产品代码不属本域；域内测试本体 → `tests/control-tower/`。

## 五、不确定找谁
判定逻辑/退出码 → 治理线 → K3 → CTO；跨域判定 → 治理线（`check-ownership.py`）；Windows/Git Bash 写法 → `PLATFORM-CHECKLIST.md`；疑似误拦漏拦 → 治理线。
