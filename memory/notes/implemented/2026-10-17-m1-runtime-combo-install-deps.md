# 决策 Note · M1 运行时组合固化与 install-deps 真计数

**状态**：已实施
**日期**：2026-10-17
**决策**：① 把"可用组合 = node v22.23.2 ＋ better-sqlite3 ABI 127 重建"固化进 `install-deps.sh`（打印 + 非 v22.x 警告，不改退出码）；② install-deps 的 `rebuilt` 由变量冒充（`${ALLOW_N}`）改为逐包真计数；③ node v24.x 全系登记为禁用组合（两态必崩）。依据：派单 `2026-10-17-派单-M1-运行时组合与构建链.md`（v2）＋ CTO 裁定 146–156。
**登记件**：`docs/synova/runtime/M1-运行时组合与构建链登记-2026-10-17.md`

## 一、为什么警告不改退出码

CI（node24）会跑 `install-deps.sh` 但不加载原生件（现绿）；硬拦 = 变相改 CI 语义（红线：不擅改 CI）。故非 v22.x 只发 `::warning`，判据责任在启动侧（ABI 断言：真加载 native）。

## 二、为什么 rebuilt 必须真计数（反例实证）

原实现管道 `while` 进子 shell 丢计数，末行恒打 `${ALLOW_N}`——白名单抽掉 `better-sqlite3` 后仍打 `rebuilt 2`（照常打印冒充真计数）。修复后同反例打 `rebuilt 1`，计数随实况变化。

## 三、禁用组合两态（实测原始输出见 M1 回执）

| 态 | 组合 | 结果 |
|---|---|---|
| A | node24 ＋ ABI137 自建件 | SIGABRT（shell 134 / signal 6），`Assertion failed: (env) != nullptr` @ `api/hooks.cc:142`，`Statement::~Statement()` @ better_sqlite3.node |
| B | node24 ＋ ABI127 件 | rc=1，`ERR_DLOPEN_FAILED: NODE_MODULE_VERSION 137 vs 127` |

任一态 rc≠0 ⇒ node v24.x 全系禁用。组合对照纪律：不许把某组合下的现象当代码性质。
