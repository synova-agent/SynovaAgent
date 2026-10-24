# Note · #975 GATE-INVENTORY 三处整改（四态 · 铁律 49）

issue: "975" ｜ 裁定: 裁 399（A 案）＋ 裁 402（净增口径） ｜ date: 2026-10-25 ｜ status: proposed

## 现状

`--check-inventory` 的两列判据此前无判别力：`label_hash` 零校验（装饰性，任何值都过）；
`compute_wiring` 把任何 workflow 文件（含 `.github/workflows/ci.yml`）的行号都按 local-gates 步序折算 `CI-S<n>`
⇒ 6 行 `wired_to` 失真（K3 #974「登记表失真」根因）；另有 CI-S10/11 两个假 hash（步名在 #912/#917 改过、表未跟）；
①i 步名 `R1/R2/R3` 与实跑规则 `R1–R6`（#915 Q-5 扩 R4/R5/R6）不一致。

## 决定

1. `quality-baseline.py`：C10 跨文件分支改为「只有 `rel == WORKFLOW_PATH` 才折 `CI-S<n>`，其余记 `script:<rel>`」；
   C5 段追加 `label_hash == label_hash(step["label"])` 真校验（既有断言一字不动）。
2. `GATE-INVENTORY.yaml`：6 行 `wired_to` ＋ 3 个 `label_hash` 全部换**修正后实算值**（禁手写）；CI-S12 的 label/what 改 R1–R6。
3. `.gitea/workflows/local-gates.yml:303` 仅 `- name:` 一行同步改 R1–R6（run 体一字不动）。
4. 净增口径（裁 402）：不新增门禁件、不新增阻断面；收编 1 条空转判据、替换 1 处折算行为，净增 ≤ 0。

## 依据

- 规格 `派单件/2026-10-25-规格-975-GATE-INVENTORY三处整改.md` §2.1/§3/§6；裁 399 A 案批复；K3 #974「登记表失真」。
- 实算值与本 Note 同源（同一 `label_hash()`/`compute_wiring()`）：CI-S10 `f78e127cef46`／CI-S11 `361f9807d303`／CI-S12 `8c3ca37189ce`。

## declared-only（consumer: null）

- `--check-inventory` 无 CI 调用、无 pre-commit 调用（grep `.gitea/workflows/ .github/workflows/ scripts/pre-commit-check.sh` 0 命中），
  且不在 E5 盘点面（35 件 check-*/verify-* 中无 `quality-baseline.py`）⇒ **declared-only，consumer: null**。
- 理由：它是「盘点表的校验器」，盘点表本身尚未接入任何阻断面（#841 P4-P0 既有缺口，非本件引入）。
- **到期条件**：随 Q-11／门禁收编批（裁 402 处置）二选一 —— ①把 `--check-inventory` 接进 ①d 步或 pre-commit；
  ②判定不值得接则降为报告器并在表 `decision` 列标 `report-only`。到期前判据只靠配对测试守（变异体全跑）。
- **meta.counts 到期回填**：现表 `ci_steps: 9／checkers: 32／rows: 35` 与实测 `12／35／40` 不符，本批**刻意不改**
  （改＝宣称全表重跑 E1–E7）；随 #841 全表重跑批回填，若提前要求须另裁（会扩写集）。
- 对外表述一律「修判别力（declared-only，未接阻断面）」，不说「新增门禁」。

## K3 三处风险（原样抄自开工令 §五-②）

1. 🔴 **`wired_to` 语义**：修正后 5-6 行的值变成 `script:.github/workflows/ci.yml`。K3 可能判："`wired_to` 的语义是**门禁位**（`CI-S<n>`／`PC-*`／`slot`），把"文件引用"塞进去是**混口径**，应另立 kind 或记 orphan＋notes。" —— 这是**范式问题**，超出本件判据授权（我按"如实记引用"处理，若 K3 判错范式，改法是**回退这 6 行＋另开卡定义 `ref-only` 口径**）。
2. 🔴 **`meta.counts` 与实测不符**（`ci_steps: 9／checkers: 32／rows: 35` vs 实测 **12／35／40**）：本件**刻意不改**（改＝宣称全表重跑 E1–E7）。K3 很可能抓"盘点表自己的数字是旧的，却拿它当权威锚"。⇒ 已在 Note／PR 正文写成**到期条件**；若 K3 要求本批就回填，须另裁（会扩写集）。
3. 🟠 **C5 只核 hash 不核文本**：`label` 文本漂移（表里写 R1–R6、实跑 R1/R2/R3）**机器抓不到**，只能靠测试断言。K3 最可能抓"C5 号称真校验，其实只锁了指纹、没锁语义"。⇒ §四-①(c) 的跨载体断言是本件的补丁，但它是**测试断言**，不是**门禁判据**（两者不等价，已在 `@known` 写明）。

## 生效时点

随本 PR 合入 `local-main` 即生效；回滚＝单 commit `git revert`（无数据/迁移副作用）。
