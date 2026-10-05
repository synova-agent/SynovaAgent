# Win 侧部署说明：LLM-as-a-Verifier（synova-verify）

> 2026-08-20 | CTO 编写 | 供 Win 侧（Claude Code / Codex）部署
> Mac 侧已部署验证（D460），Win 侧按本文档部署，两边一致
> 参考：斯坦福 LLM-as-a-Verifier（[arXiv 2607.05391](https://arxiv.org/abs/2607.05391) / [GitHub](https://github.com/llm-as-a-verifier/llm-as-a-verifier)，MIT 许可）

---

## 一、用途（为什么装）

**A2 语义预筛**：对任务交付质量做 0-1 连续打分，区分"真实交付"vs"空泛声称"。用于：
1. 交付质量存疑时打分（手动触发）
2. 降 K3 审计成本（先预筛再终审）
3. 候选方案择优（架构取舍辅助决策）
4. 进度细粒度监控

**已验证效果**（Mac，2026-08-20）：
- 完整交付声明 1.0 vs 空泛声明 0.0（判别力强）
- select 选最优：正确 0.654 vs 错误 0.346

## 二、前置条件

- Python ≥ 3.9（Win 用 `py -3.9` 或最新 python 均可）
- DeepSeek API key（在 `~/.dsh/.credentials.yaml` 或环境变量）
- 网络可访问 `api.deepseek.com`

## 三、安装步骤（Win PowerShell / Git Bash）

### 1. 建独立 venv（隔离，不污染系统 Python）

```bash
# 在 SynovaAgent 仓库根目录
python -m venv .venv-llmverifier
```

### 2. 安装 llm-verifier

```bash
.venv-llmverifier/Scripts/pip install llm-verifier
# Windows venv 的 python 在 Scripts/ 下（不是 bin/）
```

### 3. 验证安装

```bash
.venv-llmverifier/Scripts/python -c "import llm_verifier; print('llm-verifier OK')"
```

### 4. 配置 DeepSeek key（运行时注入，不写仓库）

key 在 `~/.dsh/.credentials.yaml` 的 `DEEPSEEK_API_KEY`。运行时注入：

```bash
# Git Bash / PowerShell 里临时导出
export DEEPSEEK_API_KEY="<你的 key>"
```

**红线**：key 绝不写进仓库任何文件（Secrets 门禁会拦，且会泄露）。

## 四、使用方式（与 Mac 一致）

### 对比打分（交付质量预筛主力）

```bash
.venv-llmverifier/Scripts/python -c "
import llm_verifier
r = llm_verifier.compare(
    problem='<任务描述>',
    trace_a='<候选A：真实完整交付声明>',
    trace_b='<候选B：对照/空泛声明>',
    criteria={'Completeness': '是否有真实代码变更+测试+合并证据'},
    n_evaluations=1, model='deepseek-v4-flash',
)
print('A 分:', round(r[0],4), '| B 分:', round(r[1],4))
"
```

### 多候选择优

```bash
.venv-llmverifier/Scripts/python -c "
import llm_verifier
result = llm_verifier.select(
    problem='<问题>',
    candidates=['<候选1>', '<候选2>', '<候选3>'],
    criteria={'Correctness': '<标准>'},
    n_evaluations=1, model='deepseek-v4-flash',
)
print('最优:', result.index, '| 分数:', result.scores)
"
```

## 五、预筛判定标准

| 分数 | 判定 | 动作 |
|---|---|---|
| ≥ 0.7 | 质量达标 | 可进 K3 终审 |
| 0.4 ~ 0.7 | 存疑 | 人工复核，补证据或打回 |
| < 0.4 | 空泛/假交付 | 打回，不浪费 K3 |

## 六、红线（与 Mac 一致）

- **不替代 K3 终审**：预筛是过滤，终审仍 K3 独立审计
- **不替代机器物理验证**：git 提交/测试绿仍走脚本（U8）
- **key 不入库**：只运行时注入
- **成本意识**：预筛用 `n_evaluations=1`（select 默认 4 较慢，track 多步会超时）
- **Win 特有**：venv 路径是 `.venv-llmverifier/Scripts/`（Windows）不是 `bin/`（macOS/Linux）

## 七、验收标准（装完确认）

- [ ] `import llm_verifier` 成功（版本 0.2.0）
- [ ] compare 测试：完整声明 > 空泛声明（如 1.0 vs 0.0）
- [ ] DeepSeek key 连通（`api.deepseek.com` 200）
- [ ] 未把 key 写进任何仓库文件

## 八、已知注意

- Windows 下 `timeout` 命令不可用于 python（用 PowerShell 的 `Start-Process` 或直接跑）
- track 多步评估较慢（n_evaluations=3 会超 60s）——预筛不用 track
- 模型默认 `deepseek-v4-flash`（与 Mac 一致）
