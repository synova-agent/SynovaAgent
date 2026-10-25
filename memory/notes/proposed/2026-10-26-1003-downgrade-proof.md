# #1003 裁 409 降级机制：三态判别证据（补 #1002 的缺口）

## 机制
- `check-file-driven.sh`（组 8 的执行体）新增：`SYNO_GROUP_DOWN=1` ⇒ 违规只报 ⚠️、rc=0（降级）；否则硬阻断 rc=1。
- `pre-commit-check.sh` 的并行调用点显式传 `SYNO_GROUP_DOWN`（默认 1；`SYNO_GATE_STRICT_LEGACY=1` ⇒ 0）。
- 组 9 起始处复位，避免降级泄漏到后续组。

## 三态原始输出（现场）
```
A) SYNO_GROUP_DOWN=1 + 违规：rc=0
   ⚠️ 硬编码类型回归 (禁止在 src/ 新增本体类型定义): 1 处 [裁 409 降级 —— 只报不拦]
B) SYNO_GROUP_DOWN=0 + 同违规：rc=1
   ❌ 硬编码类型回归 (禁止在 src/ 新增本体类型定义): 1 处 [硬阻断]
C) 无违规：rc=0
```
夹具：`src/agent/tool-loop-executor.ts` 追加 `export type DemoOntologyType = 'a' | 'b' | 'c';`（组 8 的类型联合判据要求 ≥3 个字面量成员）。

## 端到端对照（整仓 pre-commit）
- 默认语义：`❌ 1 组未通过`（组 8 已降级为 ⚠️）
- `SYNO_GATE_STRICT_LEGACY=1`：`❌ 2 组未通过`（组 8 恢复硬阻断）
⇒ **降级确实生效**，且不误扫其它组。

## 已知限制
- 本次只对**组 8** 做了组级降级接线；组 6/10/13 仍走 `_downgraded()` 名称匹配（未逐一验证）。
