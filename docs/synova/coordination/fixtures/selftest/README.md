# V6 · runner 自检 —— 证明夹具 runner 自身有分辨力

> 一个**只会在"全过"时 exit 0** 的 runner 不是判据。判例 V-08 说"坏不掉的夹具 = 无效夹具"，
> 同一条对工具本身成立：必须证明它的 **exit 1 / exit 2 真的可达**，否则三态退出码只是声称。

## 一条命令跑完全部三段

```bash
bash docs/synova/coordination/fixtures/selftest/run-selftest.sh
```

自身 exit：`0` = A/B/C 三段行为**都**与预期一致；`1` = 任一段不符预期。

原始输出落 `docs/synova/product-lines/evidence/V6/`（命令 + stdout/stderr 原样，无手写数字）。

## 三段各自证明什么

| 段 | 输入 | 期望 | 证明的东西 | 证据 |
|----|------|------|-----------|------|
| **A** | `noop-break.json` | runner **exit 1** | 语法上改动了、语义上零变化（只加一句注释）⇒ 判据**不得**转红 ⇒ runner 必须判 `INVALID`。若它报 `VALID`/exit 0，就是在把"跑了命令"当"判据有效"。 | `_selftest-noop-break.out` |
| **B** | `unique-miss.json` | runner **exit 2** | `breakHow.find` 在目标文件中出现 **0 次** ⇒ runner 拒绝猜测定位、拒绝静默跳过 ⇒ 拿不到结论（判例 **M-02**：禁吞崩溃）。 | `_selftest-unique-miss.out` |
| **C** | 无 manifest —— 直接对实现置空转 | 判据 **exit 0** | **负夹具**：把 `writeIndustryThresholds` 整个写入段空转后，3-12 的判据**仍然全绿** ⇒ 该判据第 4 例「写入临时目录 → JSON 文件可读」**保护不了任何东西**（断言断的是测试自己写死的字面量）。 | `_negative-fixture-3-12.out` |

## 为什么自检脚本自己也要防假绿

第一版脚本在外层 `REPO_ROOT` 少算一级目录，`node` 抛 `MODULE_NOT_FOUND`、退出码恰好是 **1**，
于是"段 A 期望 exit 1"**假绿通过**——runner 一次都没跑起来。

修法：**先验行为特征，再信退出码**。

- 段 A：输出里必须出现 runner banner（`V6「改坏即红」夹具 runner`）
- 段 B：输出里必须出现 `HARNESS-FAILURE`
- 段 C：输出里必须出现 vitest 汇总行（`Test Files`）

三条任一缺失即判该段失败，无论退出码多"对"。

> 这条与主 runner 的 `--only` / 退出码设计同源：**"命令跑了" ≠ "判据生效"**，
> 中间那一步（信号真的产生了吗）必须单独验。

## 段 A / B 的 manifest 是**故意做坏**的

两者都由 `run-fixtures.ts --manifest <path>` 载入，内容是对真实 2-4 夹具的拷贝 + 一处改写：

- `noop-break.json`：`replace` 只在原语句后追加 `// selftest: 语义空操作`
- `unique-miss.json`：`find` 改成一个文件里不存在的串

它们**不是**生产 manifest 的一部分，只在自检里被引用。
