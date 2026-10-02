# tests/control-tower/ · 施工守则

> 门禁脚本的测试本体。改测试即改全仓「红/绿」的定义。

## 一、这块是什么
138 个 git 跟踪文件（118 `.test.sh` · 17 `.py` · 3 `.test.ts`）＝ 控制塔/工作流/hooks 门禁脚本的测试。**三条 runner 三种命运**：`.test.sh` 走 `ct-test-gate` + CI 密封清单；`.test.ts` 走 vitest glob 自动覆盖；`test-*.py` **不在密封面、CI 零执行**。近 30 天实测 88 commit / 101 次文件改动。

## 二、谁可以改
- **归属**：治理线（Mac DSH）。`ownership.yaml:106` `tests/control-tower/**` owner=`mac`；实测 `check-ownership.py …/gate-stats.test.sh` → `✅ PASS 同域: mac`。
- **必须同时改**：
  1. **配对铁律**（`ct-test-gate.sh:18` 声明 / `:34`+`:45` 强制）：改 `scripts/{control-tower,workflow,hooks}/<名>.{sh,py}` ⇔ 同 commit 改 `tests/control-tower/<名>.test.sh`。实测配对 60/108。
  2. 新增/改名 `*.test.sh|*.test.py` ⇒ 登记 `.github/workflows/ci.yml` 全文；删基线内条目或改判定/退出码 ⇒ 同步 `scripts/control-tower/` 三个 `*-baseline.*`。域内密封面 125，已登记 52。
  3. 新增/改测试脚本 ⇒ 过 `PLATFORM-CHECKLIST.md` 9 条（禁裸 `python3`/`timeout`/`grep -oP`）。
- **越界判定**：`check-ownership.py <文件…>`。实测 `…gate-stats.test.sh src/l4/graph-bridge.ts` → `❌ FAIL 跨域 ['mac','win']`，**exit 1**。与 `scripts/control-tower/**` **同属 mac** ⇒ 同 PR 改脚本+测试**合规**。
- **越界找**：归属争议 / 门禁语义变更 → 治理线 → **K3 过审 → CTO 裁**；`scripts/audit/**` 是 K3 红线，永不碰。

## 三、改完怎么算完成
- **必须穿的生产入口**：
  1. `pre-commit-check.sh:617` 调 `ct-test-gate.sh`（2d 段，三态 **0/1/2，1 与 2 同判红**）。
  2. `ci.yml:378` `control-tower-tests` job（`Control Tower Gate Tests (ubuntu|windows-latest)` = 必需 context 之二）的 `for t in` 密封清单。
  3. `synova-submit.sh:51` → `simulate-ci.sh`（清单自 ci.yml **单源提取**）。
  4. `check-gate-integrity.sh --registry-only` → `GATE-INTEGRITY: OK`。
- **本域独有红线**：
  1. **测试须自证接线**：断言被测脚本真被 pre-commit/pre-push/hooks 调用（域内 84/118 含「接线」断言）；「文件存在」不算（铁律 0-2）。
  2. **沙箱禁污染宿主**：`mktemp -d` + `trap` 清理；git 身份用 `git -c user.name=t -c user.email=t@t`（禁持久写）。hook 导出的 `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE` 是沉默杀手（`ct-test-gate.sh:48-55` 已剥，自带 unset 为双保险）；仅 9/118 剥了。
  3. **跨平台**：本机实测 macOS 无 `timeout`（`command not found`）；BSD grep 无 `-P`。以 `PLATFORM-CHECKLIST.md` 为准。
  4. **三态退出码**：2 = 检查自身降级，**同样阻断**；禁 `|| true` 吞崩溃。
  5. **`.test.py` 是死面**：域内 7 个在 ci.yml **零登记**（实测 grep 无命中）⇒ 永不在 CI 跑。【待定】是否补登记。
- **「改坏即红」最小用例**（实跑）：
  - A. 建 `tests/control-tower/zz-agents-probe.test.sh`（不登记）⇒ `check-gate-integrity.sh --registry-only` → `基线外新增 1`，**exit 1**；删除即回 `OK` exit 0。
  - B. 删基线内 `attach.test.sh` ⇒ 同上 → `基线过期 1`，**exit 1**；恢复即回 exit 0。
  - C. `SYNO_TEST_ARM=1 SYNO_CT_STAGED="scripts/control-tower/wait_manager.py" bash scripts/control-tower/ct-test-gate.sh` → `❌ 缺配对测试`，**exit 1**。

## 四、不在这里的事
`scripts/control-tower/**` 脚本本体 → 同级 `scripts/control-tower/AGENTS.md`；审计标准与 `scripts/audit/**` → K3（红线）；`tests/doc-system|project|sentinel` 等他域 → 各自域；`src/**/*.test.ts` → 不属本域。

## 五、不确定找谁
判定/退出码 → 治理线 → K3 → CTO；算不算跨域 → 以 `check-ownership.py` 为准；平台写法 → `PLATFORM-CHECKLIST.md`；是否进 ci.yml 密封清单 → 治理线。
