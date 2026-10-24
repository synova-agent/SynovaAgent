# 2026-10-24 · #913 check-test-obligations：git 超时/非法值三处 warn 收口

## 现状（实测，锚 = PR #947 head `b2af486b3`）

#942/#946 复核留了三条 warn，均指 `scripts/control-tower/check-test-obligations.py`：

1. `_sh()`（仅 `--selfcheck` 夹具路径）**无 timeout** ⇒ 夹具 git 卡住时自检可能挂死，且不以 exit 2 收口。
2. `E_GIT_TIMEOUT` 已抛但**没有配对测试** ⇒ 该分支可被删而不被任何断言发现（承重未证）。
3. `GIT_TIMEOUT_SEC = int(os.environ.get("SYNO_GIT_TIMEOUT_SEC","60"))` 在 **import 期**解析 ⇒ 非法值抛**裸 ValueError**、退出码落到 rc=1（不是"检查自身失败"的 rc=2），破坏三态语义。

## 决定

- `_sh()` 补 `timeout=git_timeout_sec()`，`TimeoutExpired ⇒ ObligationError("E_GIT_TIMEOUT", …, phase="selfcheck")`。
- 新增 `git_timeout_sec()`：**每次读 env 并校验**（非整数 / 负数 ⇒ `E_ENV_INVALID` / exit 2），
  不在 import 期抛裸异常；`git()`／`git_ok()`／`_sh()` 三处统一走它。
- `--selfcheck` 分支的 `ObligationError` 也接住 ⇒ 打 degraded + `TEST-OBLIGATIONS: ERROR <code>` + **return 2**
  （此前会 traceback 落到 rc=1）。
- 配对测试 S13-a..e：合法值（非 2）／非法值（rc=2＋`E_ENV_INVALID`＋无 Traceback）／超时（rc=2＋`E_GIT_TIMEOUT`）／
  selfcheck 路径超时（rc=2）／变异体（替换全部 `E_GIT_TIMEOUT` 抛出点 ⇒ 断言翻红，证明承重）。
- 语义约定：`SYNO_GIT_TIMEOUT_SEC=0` 视为"立即超时"（用于确定性触发超时分支），负数/非整数才算非法。

## 依据

#942／#946 验收 warn（CTO 派单）；三态退出码口径 = `scripts/control-tower/AGENTS.md`（0/1/2，禁把"看不见"当通过）。

## 生效时点

本 PR 合入其基分支（#947 `ct/913-PR2`）后生效；回滚＝`git revert`（回到"无 timeout／裸 ValueError"的旧行为）。

## 已知限制

- 超时分支用 `SYNO_GIT_TIMEOUT_SEC=0` 触发（确定性）；真实慢 git 场景未在 CI 复现（等价路径已由同一 `except` 覆盖）。
- 本 PR 是 #947 的**栈式补丁**：base = `ct/913-PR2`，合并顺序须 #947 → 本 PR。
