# V2/V9 证据 · 施工项登记执法体：接线 + 具名归因 + 改坏必红

> as_of: 2026-10-06T14:01:55+08:00 ｜ 分支 HEAD: ff5f1caad ｜ origin/main: 74eb6c44c
> 以下全部为原始命令回显；数字一律来自命令输出，禁手写（判例 S-01③）

## ① 执法体 · 真登记件（期望 exit 0）
```
$ node --experimental-strip-types --no-warnings docs/synova/coordination/tools/check-construction-registry.ts
  施工项登记执法体 ｜ 项数 48 ｜ 块数 12
  ref: origin/main@74eb6c44c ｜ 实装判据：INV-1 依赖 / INV-2 派单 / INV-3 标准 / INV-4 写集互斥 / INV-5 共写声明引用可判 ｜ BLOCK 块完整性（含 BLOCK-INV3 块级标准复用）
  ⏳ 未实装（不准当已覆盖读）：INV-6 块标准覆盖 —— 现有等价物为 BLOCK + BLOCK-INV3，未单列；其余"ℹ️"行一律非违规



  ══ 合计 0 处违规 ══
EXIT=0
```

## ② 夹具 · 判据的判据（期望 exit 0）
```
$ bash docs/synova/coordination/tools/fixture-inv4-red.sh
  [PASS] 复原态：exit=0（真登记件当前 0 违规）
  [INFO] 已注入 INV-4 违规：删去 0-11 × 2-4 对 src/tools/tool-registry.ts 的两侧共写声明（before=2 → after=0）
  [PASS] 破坏态：exit=1
  [PASS] 破坏态输出含 INV-4 违规计数行：'INV-4: 1 处'
  [PASS] 破坏态输出含 具名违规三元组：'0-11 × 2-4 同写 src/tools/tool-registry.ts'
  [PASS] 破坏态输出含 违规消息正文：'写集同路径且未声明共写'
  [PASS] INV-5 场景：exit=1
  [PASS] INV-5 场景输出含：'INV-5: 1 处'
  [PASS] INV-5 场景输出含：'2-3-NOT-A-REAL-ID'

  ══ 夹具有效：破坏 ⇒ 红且具名（INV-4 与 INV-5 两场景）；复原 ⇒ 绿 ══
EXIT=0
```

## ③ 夹具自证可伪（不是"永远绿"）
把执法体的 INV-4 判据改成 `if (false) fails.push(...)`（模拟"接了线但没判别力"）后：
```
夹具 EXIT=1，三条针对违规行的针全 FAIL（表头针已废 —— 见夹具内注释）
复原执法体后：夹具 EXIT=0
```

## ④ 本卡修掉的执法体自身缺陷（V9 要求"具名归因"，先得让表头不撒谎）
- 表头原写 `判据：INV-1 … INV-6 / BLOCK`（7 个名字），实装只有 4 条 + BLOCK；
  INV-5 此前**只进 ℹ️ notes、从不 fails.push**，INV-6 从未存在 ⇒ 宣称覆盖面 > 实际覆盖面。
- `ref: origin/main@1630a5014` 是**硬编码**（2026-10-04 的值）⇒ 随 main 前进变成假陈述（判例 S-05）。
- 现：表头由实装判据枚举 + 逐字声明"未实装 INV-6"；ref 改为 `git rev-parse --short origin/main` 实算。
- 新实装 INV-5：`sharedWrite` 引用的项 id 必须存在（在本件上实测 0 违规 ⇒ 有牙且当前为真）。
