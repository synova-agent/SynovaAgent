---
状态: proposed
日期: 2026-09-26
决策: 门禁脚本里的「转义反引号」模式（`\``）不可跨方言复用 —— 一律改写为**方括号包裹反引号**（`[`]…[`]`，POSIX 等价）；凡断言/抽取含方言敏感元字符，验收须**两腿各自的原始输出**（BSD + GNU），单腿绿不得视为通过。
理由: (1) `\`` 在 GNU grep 是**扩展锚点**（缓冲区起始），在 BSD grep 是**字面反引号** —— 实测同一模式在 macOS 命中、在 ubuntu/Git-Bash 恒不匹配，属「同一份代码两条腿行为不同」，非测试噪声；(2) 该模式位于 `check-brief-vs-code.sh:59` 的 **Q2 兜底抽取**（生产路径），GNU 侧恒返空 ⇒ 旧格式 brief 的声明文件**在 Linux 上被静默漏抽**（静默降级，非显式失败）；(3) 失效点由「新断言」暴露（main 无该断言），若不修则 Control Tower 两腿恒红 —— 修的判据只能是**真 run 两腿转绿**，本地等价不做判据；(4) 方括号包裹是 POSIX 定义行为、无转义歧义，且不改变判定强度（仍要求「生产脚本含该模式 ∧ 抽取结果==期望」）。
---

# D962 task-32：门禁脚本跨方言反引号模式（BSD vs GNU）

## 触发场景（实测，非推测）

`tests/control-tower/grep-oP-regression.test.sh` 的 `backtick 路径（workflow brief-vs-code）` 断言在
**macOS 本机恒绿**、在 **CI 两腿恒红**：

```bash
# macOS（BSD grep 2.6.0-FreeBSD）
$ printf '%s\n' '改 `src/routes/a.ts` 完成' | grep -oE '\`[^\`]+\.[a-z]{2,5}\`'
`src/routes/a.ts`                     # 命中

# CI ubuntu-latest（GNU grep；job 108238505073 @ 2026-09-25T20:34:07Z / head 807b6b67）
##[error]  ❌ backtick 路径（workflow brief-vs-code） — 期望 '`src/routes/a.ts`' 实得 ''
                                      # 恒不匹配
```

## 决策

| 项 | 决定 |
|---|---|
| 模式写法 | `'\`[^\`]+\.[a-z]{2,5}\`'` → `'[`][^`]+\.[a-z]{2,5}[`]'`（`sed 's/\`//g'` → `sed 's/`//g'`） |
| 落点 | `scripts/workflow/check-brief-vs-code.sh:59-60`（生产兜底抽取）+ 同批 `tests/control-tower/grep-oP-regression.test.sh:134-136` |
| 验收判据 | **真 run**：#803 的 `Control Tower Gate Tests` **ubuntu + windows 两腿由红转绿**（本地等价不作判据） |
| 结论表述 | 旧模式「**实测在 GNU 下恒不匹配**」（`-E` 下以实测为准，不引用未实测的 BRE 细节） |
| 门禁脚本语义变更 | 必须过 **K3**（实现者不自判） |

## 边界（本决策不覆盖）

- 不推广为「所有 grep 模式都换方括号」：**仅**方言敏感元字符（`\``、`\'`、`\+`、`\?`）适用；
- 不改 `ci.yml`、`scripts/control-tower/**`、`scripts/audit/**`、`src/**`、主树（本卡边界）；
- 未新增/未删除任何断言：只改模式写法，判定强度不变（`eq` 仍双向校验「生产含模式」+「抽取正确」）。
