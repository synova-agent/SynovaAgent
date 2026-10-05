# 派活文件：GS-01~08 黄金场景脚本实现（D442-D449）

> 2026-08-18 | CTO 派发 | 执行：🛠 synova-dsh（编码 session）
> 背景：创始人问"26 条线能不能一次跑通"→ 盘点发现 105 个 scenario 验收点零脚本（GS-01~08 未实现）。
> 本文档是唯一派活依据，编码 session 按此执行，写完跑通后 evidence 自动进完成度。
> **边界澄清（2026-08-18 创始人确认）**：D357（L5 连接器，src/connectors/）**交回 Win Claude Code**，
> 不在 Mac 编码 session 范围。GS 场景脚本（scripts/golden-scenarios/）归 Mac Harness，
> 但 GS-02/GS-04 依赖 Win 的 D355+D357 完成后才能跑通——编码 session 遇到依赖缺失时，
> **先做不依赖 Win 的场景（GS-03/GS-05），依赖 Win 的（GS-02/GS-04）挂起等 Win 交付**。

---

## 一、任务总览

8 个场景脚本，每个 = 一个可执行的垂直切片（服务拉起 + 数据注入 + 机器断言 + 证据落盘）。
设计文档（必读）：`docs/plans/codex/strategy/SYNOVA-DESIGN-黄金场景与创始人驾驶舱-v1-20260816.md`
目录规范：`scripts/golden-scenarios/README.md`（运行契约 8 条硬要求）

**交付顺序**（设计 §2.4 建议 + 依赖就绪度）：GS-03 → GS-02/GS-04 → GS-05 → GS-01 → GS-06 → GS-07/08

| D# | 场景 | 数据 | 关键断言 | 依赖 |
|---|---|---|---|---|
| D442 | GS-03 资本循环 | erp-standard | manifest 挂载 + cashBalance↔cash 对齐 + 阈值触发 | ✅ **可立即开工**：D355（99fa8df5）+ D356（audited）均已入 main |
| D443 | GS-02 客户循环 | crm-standard | Market→Client 收敛 + customer-demand-shift 出 critical | ⏳ 依赖 Win：D355（L4 契约已就绪）+ D357（CRM 连接器，**交回 Win**） |
| D444 | GS-04 人才循环 | hr-standard | People→Person 收敛 + key-person-risk 产出 | ⏳ 依赖 Win：D355（L4 契约已就绪）+ D357（HR 连接器，**交回 Win**） |
| D445 | GS-05 告警闭环 | 越阈 fixture | sentinel_tickets 有行 + 推送去重键稳定 | ✅ **可立即开工**：D356 已就绪 + D354（去重键，待确认） |
| D446 | GS-01 首诊旅程 | 问卷 | 首诊报告产出 ≤3 天路径 + ≥1 盲区命中 | D232/D233 确认 |
| D447 | GS-06 进化闭环 | 反馈注入 | loop-3/5 真实执行体 + 规则变更可验证 | D333 确认 |
| D448 | GS-07 数据安全 | 敏感数据 | PII 脱敏 + 越权拒绝 + 本地库不出网 | D338 + security/ |
| D449 | GS-08 报告可读 | GS-01 产物 | 一页纸结构 + 移动端渲染 + 复述 checklist | 报告模板 |

## 二、每个场景的硬契约（README §2.2，逐条必须满足）

1. **fresh-db**：临时数据目录（服务自建 schema），测后删除；真实库只读；禁止 cp data/synova.db
2. **bootstrap**：临时端口拉起服务，healthz 就绪探测
3. **inject fixture**：按场景注入（crm/erp/hr/问卷/敏感数据），走 field-mappings 契约
4. **触发**：API 调用 / cron 手动 run
5. **断言**：expect.json 逐条执行 → evidence JSON；**每场景 ≥3 条**（正常 + 降级 + ≥1 负向）
6. **证据**：写 `scripts/golden-scenarios/evidence/GS-XX-<date>.json`（git 跟踪）
7. **exit 0/1**：全部断言过 = 0；任一失败 = 1（失败明细入 JSON）
8. **幂等**：重复跑结果一致；中途失败也清理临时资源

## 三、断言规范（防假转绿——第一红线）

| 禁止 | 说明 |
|---|---|
| 恒真断言 | `echo true`、无 expect、`|| exit 0` 一律禁止 |
| 空壳 | 对齐铁律 48：断言不可为空壳 |
| 人工看 | 必须机器判定 exit 0/1 |

**负向断言必须 ≥1 条**：如"越权必须被拒"、"空数据必须降级不误报"。

## 四、可复用基础设施（已验证存在）

`scripts/golden-scenarios/common/`：
- `bootstrap.ts` — 临时端口拉起服务 + healthz 探测
- `fresh-db.ts` — 隔离临时数据目录
- `inject.ts` — fixture 按 field-mappings 契约归一
- `assert.ts` — expect.json 断言 → evidence JSON（calc-progress 直接消费）

## 五、工作流（每个场景）

1. 认领 D#：`bash scripts/control-tower/alloc-task-id.sh` 已分配（D442-D449，直接用对应号）
2. 建目录：`scripts/golden-scenarios/GS-0X-<name>/`（run.sh + fixtures/ + expect.json + README.md）
3. 复用 common/ 工具（不重复造轮子）
4. 跑通：本地执行 run.sh → exit 0 + evidence JSON 生成
5. 提交：走 synova-commit（13 组门禁）+ 推送 + PR

## 六、验收标准（CTO 验收）

- [ ] 场景目录结构符合 README §2.1
- [ ] run.sh 满足 8 条硬契约（含 fresh-db 隔离、负向断言）
- [ ] evidence/GS-XX-<date>.json 生成且被 calc-progress 消费（该场景绑定的验收点转 pending_k3）
- [ ] 提交经 synova-commit + 入 main

## 七、红线

- 场景脚本 = Harness 代码 → **进 K3 审计，无豁免**（不自审）
- 不碰 scripts/audit/；不写审计标准
- 断言只认产品物理输出，不认 agent 自述
- 一个场景一个 D#，不批量提交（证据链清晰）

## 八、当前状态（2026-08-18）

- 基础设施：common/ 4 工具就绪 ✅
- D356（GS-03/GS-05 依赖）：audited ✅
- GS 场景脚本：全部未实现（本轮交付）
- 完成度影响：场景脚本全部跑通后，105 个 scenario 验收点可机器验证 → 26 线完成度真实反映
