# A2 机器证据清单 — 待 K3 复核（14 个验收点）

> 2026-08-18 | CTO 整理 | 交 K3 审计
> 背景：创始人要求"不调 K3 大模型的机器审计体系补完成度"。D430 已把 test 绑定的验收点对应测试套件跑通（12 文件 91 测试全绿），evidence 已落库。
> 这些点现在状态 = pending_k3（🟡 待裁判），需要 K3 复核测试证据后转 verified（🟢 计分）。

---

## 复核说明（给 K3）

- 证据来源：`docs/synova/product-lines/evidence/test-2026-08-17.json` + `test-2026-08-18.json`（run-machine-evidence.sh 生成）
- 每个点绑定 `test:<套件名>`，套件测试文件在 tests/ 下（vitest 跑绿）
- 复核方式：抽查套件测试是否有真实断言（非空壳），确认测试真的覆盖了验收点语义
- **红线**：这是机器证据（pending_k3），K3 复核通过才转 verified；K3 若发现测试空壳/假绿，应判 FAIL

## 待复核清单（14 个点）

| 线 | 验收点 | 描述 | test 套件 |
|---|---|---|---|
| 4 | 4-3 | 飞书连接器 | connector |
| 7 | 7-7 | 定时任务容错（cron 失败有记录、可重试） | cron-scheduler |
| 10 | 10-4 | 现金流跑道计算正确（filter bug 修复） | compute-cash-runway |
| 15 | 15-1 | 专家注册表 + 文件驱动自动发现 | expert-registry |
| 15 | 15-3 | 工具/技能工作流接线 | tool-registration |
| 19 | 19-2 | 方向失效信号定义 | direction-monitor |
| 20 | 20-5 | 熔断/优雅停机/卡会话检测 | conversation-engine |
| 21 | 21-1 | DeepSeek 适配器 | provider |
| 21 | 21-2 | 提示词优化策略（效果可测量） | golden-case |
| 22 | 22-1 | 看门狗/熔断/健康检查 | watchdog |
| 24 | 24-4 | 防篡改（审计哈希链） | audit-chain |
| 25 | 25-1 | 专家插件（新专家=加文件自动注册） | file-driven |
| 25 | 25-2 | 技能插件（新技能=加目录自动发现） | file-driven |
| 25 | 25-3 | 哨兵插件（新哨兵=加文件自动加载） | file-driven |

## 复核结果回填方式

K3 复核后，用 evidence-writer 写 k3 类型证据（或出审计报告），calc-progress 消费后转 verified。

```bash
# K3 复核通过后（示例，K3 自己执行）：
python3 scripts/product-lines/evidence-writer.py \
  --type k3 --verdict pass \
  --points "4-3,7-7,10-4,15-1,15-3,19-2,20-5,21-1,21-2,22-1,24-4,25-1,25-2,25-3" \
  --source "K3 A2 证据复核（机器测试证据抽查通过）"
```

## 影响（复核全通过后）

14 个点 pending_k3 → verified，产品完成度从当前 4% 提升（每个点计分）。
