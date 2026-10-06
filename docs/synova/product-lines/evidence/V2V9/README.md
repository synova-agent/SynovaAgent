# V2/V9 证据 · 施工项登记执法体：接线 + 具名归因 + 改坏必红 + 三态

> as_of: 2026-10-06T14:09:26+08:00 ｜ 分支 HEAD: 125d80a2e ｜ origin/main: 74eb6c44c
> 全部为原始命令回显；数字一律来自命令输出，禁手写（判例 S-01③）

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
  [PASS] 第三态：登记件读不到 ⇒ exit=2 且具名「检查自身失败」

  ══ 夹具有效：破坏 ⇒ 红且具名（INV-4 / INV-5）；读不到 ⇒ exit 2；复原 ⇒ 绿 ══
EXIT=0
```

## ③ 夹具自证可伪（不是"永远绿"）—— 三段都实测过
| 把执法体的哪一条改瞎 | 夹具反应 | 复原后 |
|---|---|---|
| INV-4 判据（`if (false) fails.push(...)`） | rc=1，4 条针全 FAIL | rc=0 |
| INV-5 判据 | rc=1，2 条针全 FAIL | rc=0 |
| 第三态 `exit(2)` → `exit(0)` | rc=1 | rc=0 |

## ④ 本卡修掉的执法体自身缺陷（V9 要"具名归因"，先得让它不自我拔高）
- 表头原写 `判据：INV-1 … INV-6 / BLOCK`（7 个名字），实装只有 4 条 + BLOCK；
  INV-5 此前只进 ℹ️ notes、从不 `fails.push`，INV-6 从未存在 ⇒ 宣称覆盖面 > 实际覆盖面（W6 同型）。
- `ref: origin/main@1630a5014` 是硬编码（2026-10-04 的值）⇒ 随 main 前进变成假陈述（判例 S-05）。
- 现：表头由实装判据枚举 + 逐字声明"INV-6 未实装"；ref 改为 `git rev-parse --short origin/main` 实算。
- 新实装 INV-5：`sharedWrite` 引用的项 id 必须存在（本件实测 0 违规 ⇒ 有牙且当前为真）。

## ⑤ 反假通过通道（实测抓到并关掉）
- 针 `INV-4` 曾在**表头**命中（`… / INV-4 写集 / …`）⇒ 把 INV-4 改瞎后断言照样 PASS。
  已换成只可能出现在违规行的针：`INV-4: 1 处` + `0-11 × 2-4 同写 src/tools/tool-registry.ts` + 违规消息正文。
- 同理 `INV-5` 裸词在新表头命中 ⇒ 换成 `INV-5: 1 处`。
- 第三态只看 exit code 不够（node 崩溃也可能"恰好 2"）⇒ 同时验输出含「检查自身失败」。
