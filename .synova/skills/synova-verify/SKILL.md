---
name: synova-verify
description: LLM-as-a-Verifier 语义预筛（A2 增强）——对任务交付质量做 0-1 连续打分，区分"真实交付"vs"空泛声称"。创始人/CTO 怀疑某个任务交付质量、或想降 K3 审计成本时触发。参考：斯坦福 LLM-as-a-Verifier（MIT，llm-verifier 0.2.0，DeepSeek 后端）。
---

# synova-verify — 交付质量语义预筛（LLM-as-a-Verifier）

## 使用时机（触发场景，手动触发）

1. **交付质量存疑**：某个任务声称完成，但你/CTO 怀疑"是不是真的做完了"——对交付声明打分
2. **降 K3 成本**：K3 太贵，先语义预筛，分数低于阈值直接打回，不浪费 K3 终审
3. **候选方案择优**：多个实现方案/架构取舍时，让 verifier 打分选最优
4. **进度细粒度监控**：任务进行中，对每一步打 0-1 分，看真实进展

**当前是手动触发**（创始人定 2026-08-20）：需要时调用本 skill，不自动全开。

## 前置条件（部署）

- venv：`.venv-llmverifier/`（llm-verifier 0.2.0 已装，Python ≥3.9）
- 后端 key：`DEEPSEEK_API_KEY`（在 `~/.dsh/.credentials.yaml`，运行时注入 env）
- 模型：`deepseek-v4-flash`（默认，与我们模型栈一致，已验证连通）

## 使用方式

### 方式 1：对比打分（compare）— 交付质量预筛主力

```bash
DEEPSEEK_API_KEY=$(python3 -c "
import re; t=open('/Users/wane/.dsh/.credentials.yaml').read()
m=re.search(r'DEEPSEEK_API_KEY:\s*[\"\']?([^\"\'\n]+)', t)
print(m.group(1).strip() if m else '')") \
.venv-llmverifier/bin/python3 -c "
import llm_verifier
r = llm_verifier.compare(
    problem='<任务描述>',
    trace_a='<候选A：真实完整交付声明>',
    trace_b='<候选B：对照/空泛声明>',
    criteria={'Completeness': '<标准1>', 'Honesty': '<标准2>'},
    n_evaluations=1, model='deepseek-v4-flash',
)
print('A 分:', round(r[0],4), '| B 分:', round(r[1],4))
"
```

### 方式 2：多候选择优（select）

```bash
.venv-llmverifier/bin/python3 -c "
import llm_verifier
result = llm_verifier.select(
    problem='<问题>',
    candidates=['<候选1>', '<候选2>', '<候选3>'],
    criteria={'Correctness': '<标准>'},
    n_evaluations=1, model='deepseek-v4-flash',
)
print('最优 index:', result.index, '| 分数:', result.scores)
"
```

## 预筛判定标准（A2 语义预筛）

| 分数 | 判定 | 动作 |
|---|---|---|
| ≥ 0.7 | 质量达标 | 可进 K3 终审（语义预筛过） |
| 0.4 ~ 0.7 | 存疑 | CTO 人工复核，补证据或打回 |
| < 0.4 | 明显空泛/假交付 | 打回，不浪费 K3 |

## 预筛 criteria 模板（可调整）

- **Completeness**：交付是否有真实代码变更 + 测试 + 合并证据
- **Honesty**：声明是否有具体证据支撑（非空泛"改好了"）
- **Consistency**：交付是否与任务 spec/范围一致

## 红线

- **不替代 K3 终审**：语义预筛是"过滤"，终审仍是 K3 独立审计（零上下文，不自我审计）
- **不替代机器物理验证**：git 提交存在/测试绿这类物理事实，仍走脚本（U8），不用 LLM
- **不自审**：verifier 打分结果若用于审计结论，需 K3 复核打分标准（criteria）合理性
- **key 不入库**：DEEPSEEK_API_KEY 只在运行时注入，不写进仓库任何文件（Secrets 门禁）
- **成本意识**：select 默认 n_evaluations=4 较慢（track 更慢会超时），预筛用 n_evaluations=1 单次打分

## 已验证（2026-08-20）

- select：正确候选 0.654 vs 错误 0.346 ✅
- compare：完整交付声明 1.0 vs 空泛声明 0.0 ✅（判别力强）
- track：n_evaluations=3 超时（60s）→ 预筛不用 track 的多步模式

## 历史

- 2026-08-20：创始人批准接入 A2 语义预筛 + 部署 + 手动触发。参考：斯坦福 LLM-as-a-Verifier（[arXiv 2607.05391](https://arxiv.org/abs/2607.05391) / [GitHub](https://github.com/llm-as-a-verifier/llm-as-a-verifier)，MIT 许可）
