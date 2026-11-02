# Expert Quality Test Suite

专家产出质量评估套件 — 六维加权评分 + 三层级联测试。

## 快速开始

```bash
# L0+L1（无 LLM，<1s）
npx vitest run tests/expert-quality/layer0-structural.test.ts tests/expert-quality/layer1-rules.test.ts

# L2（真实 LLM，~20s × 7 专家 ≈ 140s）
npx vitest run tests/expert-quality/layer2-judge.test.ts

# 全量（L0→L1→L2）
npx vitest run tests/expert-quality/

# 仅评分标准自身验证（无 LLM）
npx vitest run tests/expert-quality/suite.test.ts
```

## 评分标准

六维加权评分，满分 5.0：

| 维度 | 权重 | 核心问题 |
|------|------|---------|
| 事实准确性 | 25% | 每个 claim 都有证据吗？有无幻觉？ |
| 证据质量 | 20% | 引用的证据具体、相关、充分吗？ |
| 推理深度 | 20% | 是因果诊断还是表面重述？ |
| 可执行性 | 15% | 建议具体可操作吗？ |
| 领域边界 | 10% | 专家是否在自身域内工作？ |
| 表达质量 | 10% | 语言清晰具体吗？有无术语泄漏？ |

**等级**: A(4.0+) → B(3.0+) → C(2.0+) → D(1.0+) → F(<1.0)

## 三层级联

```
L0 结构校验 (5ms)
  └─ 失败 → 跳过 L1+L2
  └─ 通过 ↓
L1 规则检查 (50ms)
  └─ 失败 → 记录警告，继续 L2
  └─ 通过 ↓
L2 LLM 法官 (2s/expert)
```

## 输出

- 控制台：每位专家的六维评分 + 优点/缺陷
- 汇总表：全部专家对比 + 平均分
- `tests/output/expert-quality-report.json`：结构化评分报告（用于趋势跟踪）

## 依赖

- L0+L1：无外部依赖
- L2：需要 `LLM_API_KEY` 环境变量或 `.env` 文件

## 🔴 eval 与 test 的边界（2026-11-02）

- `layer2-judge.eval.ts` 是 **eval**（LLM 当裁判、需真实模型、15–20 分钟、结果统计性），**不是门禁判据**；
  后缀用 `.eval.ts`，`vitest` 的 `include: tests/**/*.test.ts` **不会收集它**。
- **密钥只走环境变量**（`LLM_API_KEY` / `DEEPSEEK_API_KEY`）；**禁止读取仓库内任何文件（含 `.env`）**——
  那等于邀请把 key 落到工作树，一旦误提交即密钥入仓。
- 缺密钥时本 eval **exit 2**（检查自身失败），不伪装成测试红。
