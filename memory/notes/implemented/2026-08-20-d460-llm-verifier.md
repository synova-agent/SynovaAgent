---
status: implemented
date: 2026-08-20
task: D460
tags: [llm-verifier, a2, semantic-filter, skill]
---

# D460 — LLM-as-a-Verifier 部署 + synova-verify skill

## 决策
创始人批准：接入 A2 语义预筛（LLM 细粒度打分过滤交付质量，降 K3 成本）+ 本地部署 + 手动触发。

参考：斯坦福 LLM-as-a-Verifier（arXiv 2607.05391，MIT，llm-verifier 0.2.0，DeepSeek 后端 deepseek-v4-flash）。

## 部署
- .venv-llmverifier/（Python 3.9.6 venv，llm-verifier 0.2.0 + google-genai/openai/tqdm）
- DeepSeek 后端连通（DEEPSEEK_API_KEY 从 ~/.dsh/.credentials.yaml 运行时注入）
- synova-verify skill 双轨（.synova/skills 源 → .dsh/skills 同步）

## 验证
- select：正确候选 0.654 vs 错误 0.346
- compare：完整交付 1.0 vs 空泛 0.0（判别力强）
- 真实任务 D456：真实声明 1.0 vs 虚构 0.0

## 触发
手动触发（创始人定），不自动全开。红线：不替代 K3 终审/机器物理验证；key 不入库。
