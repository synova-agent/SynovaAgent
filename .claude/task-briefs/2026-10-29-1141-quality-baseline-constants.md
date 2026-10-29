# Task Brief — #1141 quality-baseline 测试常量随登记表同步

#CRITERIA: D

## Q1: 问题
合并七卡后 `tests/control-tower/quality-baseline.test.sh` 本地 FAIL（pass=161/fail=2）：`REGISTRY-OK rows=22` 与真值不符、`orphans` 分母 `40` 过期。该测试不在 CI 两腿内 ⇒ CI 绿但本地红，属**常量漂移**，非逻辑缺陷。

## Q2: 范围
做：
- `tests/control-tower/quality-baseline.test.sh`（注释行 + 断言行：`rows=22` → 真值 **26**；`orphans` 分母 `40` → **41**）
不做：
- 不改 `scripts/control-tower/quality-baseline.py`（判据逻辑零改动）
- 不改 `docs/authority/WIRING-REGISTRY.yaml`（登记表内容）
- 不接线 CI（另由 CTO 裁，见 Done 标准备注）

## Q3: 验收
入口：`bash tests/control-tower/quality-baseline.test.sh`
处理：真件 `--check-registry` 末行 `REGISTRY-OK rows=26`；夹具路径不变
结果：`TEST-OK pass=163 fail=0`；改坏（把 rows 改回 22）⇒ 断言必红

## 架构层: 不属五层业务（治理/测试常量）

## Done 标准
- [x] `bash tests/control-tower/quality-baseline.test.sh` ⇒ `TEST-OK pass=163 fail=0` verify: `bash tests/control-tower/quality-baseline.test.sh 2>&1 | tail -1`
- [x] 改坏即红：临时把 `rows=26` 改回 `22` ⇒ 断言红 verify: 见 PR 正文前后态
- [x] 判据逻辑零改动（`git diff --numstat` 只动测试文件） verify: `git diff --numstat gitea/main -- scripts/control-tower/quality-baseline.py`
- [x] ①d：`check-gate-protection --changed-base gitea/main` 0 失败 verify: 见 PR 正文
- [ ] （待 CTO 裁）是否把该测试接入 CI 两腿（当前不跑，同类漂移只在本地可见）
