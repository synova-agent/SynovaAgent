# 任务路由表（v4，2026-08-16 创始人定稿）

> 派活前查这张表。同一模块同一时间只允许一个角色认领（防撞车）。
> **本 v4 以创始人与 Mac DSH 的沟通为准，覆盖 v3（Win 版）。** 完整分工见 [DIVISION-CHARTER-v4.md](dsh-division-draft/DIVISION-CHARTER-v4.md)。
> 状态标注：`进行中·<角色>` → `已完成·<角色·日期>`。

---

## 〇、给创始人的大白话版（30 秒看懂）

**一句话：两个人各管一块地，但 DSH 也写一块核心代码（哨兵），互不踩线，你只负责点"合并" + 看评估看板。**

| 谁 | 管什么 | 打比方 |
|----|--------|--------|
| **Mac DSH** | 控制塔 + 验证系统 + 门面（MCP/桌面）+ **哨兵体系核心代码** + 主 CTO（盯全局） | 建仪表盘 + 修哨兵 + 总管家的人 |
| **Win Claude** | 产品核心（诊断体系 GA + 本体/存储/交互） | 修发动机的人 |
| **Codex** | Claude 线 dev doc + Claude 线 D# 分配（**不再跟仪表盘**） | 画图纸的人 |
| **K3**（双轨：Win Kimi CLI + Mac DSH+K3） | 验收（审两边） | 监理 |
| **你** | 定产品 + 点 Merge + 看评估看板 | 老板 |

**决策分工（不变）**：
- **技术决策** → DSH 按 DECISION-REFERENCE 四步自决（记录参考系，K3 可核）
- **产品/业务决策** → 只有你

---

## 一、模块所有权表（唯一权威，撞车时查这张表）

| 模块/目录 | 所有者 | 职责 |
|-----------|--------|------|
| **src/sentinel/ + src/cron/ + src/agent/sentinel-service** | **Mac DSH** | 哨兵体系核心（定时巡检线：数据→哨兵→信号→专家→工单，端到端） |
| scripts/product-lines/ + docs/synova/product-lines/ + 双仪表盘 | **Mac DSH** | 产品进度/任务进展/健康（Codex 已交还） |
| scripts/golden-scenarios/ | **Mac DSH** | GS-01~08 场景脚本 |
| .github/workflows/ | **Mac DSH** | 场景回归 CI、产品进度 CI |
| src/mcp/ | **Mac DSH** | MCP 企业接入 |
| electron/ + electron-renderer/ | **Mac DSH** | Electron 一体化 |
| scripts/control-tower/ + scripts/backup/ + 门禁脚本 + docs/synova/coordination/ + DSH 预设与技能 | **Mac DSH** | 控制塔持续维护 |
| **src/（除 sentinel/cron/mcp 外）L1-L5 + extensions/ + packages/ + synova_worker/** | **Win Claude Code** | 诊断体系（GA 6阶段）+ 本体/存储/交互 |
| docs/计划库（Claude 线 dev doc） | **Codex (Win)** | Claude 线 dev doc + Claude 线 D# 分配 + 任务登记 |
| scripts/audit/ + 审计标准 | **Kimi K3** | 红线：其他角色禁碰 |

### 审计双轨（各自独立）

| 轨 | 壳 | 脑 | 说明 |
|---|---|---|---|
| Win | Kimi code CLI | K3 | 已有 |
| Mac | DSH（🔍 synova-k3-audit 预设） | K3 | DSH 当壳、K3 当脑，零上下文，独立工作区 |

两轨产物都进 `docs/synova/audit-reports/`；红线不变（`scripts/audit/` + 标准 = K3 专属）。

### CTO 主从

| 角色 | 载体 | 职责 |
|---|---|---|
| **主 CTO** | Mac DSH（🧭 synova-cto） | 建体系 + 盯全局（三仪表盘）+ 打补丁 + 周报 + 管员工 + 盯双轨效率/质量/成本 |
| **副手（影子）** | Win DSH | 只读复核主 CTO 产出，异议升级创始人——不主动改 |

### 串行点（机器强制 + 惯例）

| 点 | 规则 | 强制方式 |
|----|------|---------|
| `src/server.ts` | Claude 专属（DSH 不碰，mcp/ 内部除外） | CODEOWNERS |
| 门禁脚本 + coordination 文档 + VERSION.md | DSH 专属 | CODEOWNERS |
| `package.json`/锁文件 | 每批只有一个 agent 改依赖，dev doc 写集声明 | 惯例 |
| 写集重叠 | 出 doc 方声明写集；verify-parallel 查重叠；重叠 → 停手问创始人 | 机器（pre-push） |

### PR 审查路由

- Claude 的 PR → **DSH 预审**（PR 审查 ≠ 审计）+ 创始人 Merge
- DSH 的 PR → **Codex 预审**（写集/范围/门禁）+ 创始人 Merge
- 合并后 → **K3 审计**（红线 3：无豁免）

### DSH 自出 dev doc 的护栏（不变，防"自我闭环"）

1. 结构门禁：过 dev-doc-gatekeeper（Q0-Q3/写集/DS 清单/Done 可证伪）
2. 任务编号：**DSH 线自定**，格式 `SYNOVA-IMPL-DSH-{任务名}-{YYYYMMDD}.md`（不再向 Codex 拿 D#）；Claude 线继续 Codex 的 D#
3. PR 预审：DSH 的 PR → Codex 预审
4. K3 审计：无豁免
5. 写集契约：声明写集，verify-parallel 查重叠

---

## 二、自动化清单（沿用 v3）

| # | 自动化 | 状态 |
|---|--------|:---:|
| B1 | CODEOWNERS（地盘机器强制） | 待建（DSH） |
| B2 | Auto-merge | 待建（创始人一键） |
| B3 | A7 审计派发 | ✅ D371 已建 |
| B4 | 进度页自动刷新 | ✅ D371/D372 已建 |
| B5 | 写集重叠自动检测 | ✅ 已有（CT-28 待 D332） |
| B6 | 认领一条命令 | 待建（Phase 2） |
| B7 | PR 写集重叠 CI | 待建（Phase 2） |

## 三、每周节奏（不变）

```
周一/三：Codex 出 Claude 线 dev doc + DSH 自出 DSH 线 dev doc
周中：两条线同时实现（一人一事一分支）
周五：创始人批量看 PR + 看 CTO 周报（双轨效率/质量/成本对照）
下周初：K3 逢绿必验
```

## 四、当前模块认领状态

| 模块/区域 | 状态 |
|-----------|------|
| scripts/control-tower/ + coordination + DSH 预设/技能 | 进行中·DeepSeek Harness |
| src/sentinel/ + src/cron/（哨兵切片） | 进行中·DeepSeek Harness（编码线 2026-08-16 认领；D379 path-dependency 补实现、D356 P0 阈值告警接线 均已交付 audited PASS；**D577 哨兵阈值配置真实挂载 spec 进行中·synova-devdoc 2026-09-05**，派单 docs/synova/coordination/派单-D577-sentinel-threshold-wiring-20260905.md） |
| src/ 其余业务（诊断体系 L1-L5） | Win Claude Code 主力（**D355-D360 P0 全链路修复进行中**；D391 已完成；部署后负载 D394片2/D397'/D398）。**D357（L5 连接器 src/connectors/）= 🟢 死守层，Win 继续开发**（施工图 DOC-0114 §3 第75行明确归 🟢 领域核心，非 🔵 借DSH；终态经 MCP 消费，但连接器本体持续投入）——GS 场景脚本归 Mac Harness 但 GS-02/GS-04 依赖 D357，等 Win 交付后跑通 |
| scripts/product-lines/ + 双仪表盘 | DeepSeek Harness（主导） |
| scripts/golden-scenarios/ | 进行中·DeepSeek Harness |
| 战略借鉴（**K3 咨询定序**）：D396 + D394 片1 + D395-a + D402 = **dev-doc 线写 spec 中**（派活 brief 就绪，启动指引 docs/synova/coordination/DEV-DOC-DISPATCH-20260816.md）；D394 片2/D397'/D398 = Win 部署后 | 进行中·synova-devdoc（2026-08-16 派活） |
| scripts/audit/ | Kimi K3 专属（双轨：Win + Mac） |
| electron-renderer GaDetail + src/loops/middle-evolution-engine + tests（GA 人机协同端到端·D556，slice ga-collab-e2e） | spec 已交付·dev-doc（DSH 线 2026-08-29：docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D556-ga-collab-e2e-20260829.md；前端接线 + 回流层 2 → 待编码 → K3 → CTO 合并；task-state/D556.json spec_done） |
| **DSH 迁移轨（Stage 0-4）** | 当前全部冻结（施工图 §6：Stage 0 部署后 / Stage 1 9~10月 / Stage 2 10~11月 / Stage 3 Q4评估 / Stage 4 影子后）。Stage 1（D1-D4 范式借鉴）归 **Mac DSH**；Stage 0（⚫删除+AGENTS.md漂移）归 **Mac DSH**（部署后）；Stage 2-4 未分配。详见 docs/synova/coordination/DSH-迁移分工规划-20260821.md |

## 五、认领/交还流程（不变）

1. 接任务 → 标注 `进行中·<角色>·<日期>`
2. 完成（PR 合并）→ 标注 `已完成·<角色>·<日期>`
3. 中途放弃 → 标注 `空闲` + 说明
4. 撞车 → 停手，问创始人仲裁

---

> 完整章程（编码切片细节/监控指标/终态）：见 [dsh-division-draft/DIVISION-CHARTER-v4.md](dsh-division-draft/DIVISION-CHARTER-v4.md)。

---

## 修订 — 2026-09-23（组织形态变更，创始人批准）

> 本次修订取代本文档中「dev doc 线 = 📋 synova-devdoc 常驻 session」与「编码 = 独立线」的旧表述。**规格与门禁职责不变，仅载体与形态变更。**

1. **`synova-devdoc` 预设退役**（B 案：降级为技能 + 触发式独立）
   - 实测依据：近 7 天 dev doc 产物 0 变更；`synova-squad-lead` 成员编制（队长 + ≤2 编码 + 1 自验）无该位。
   - 规格来源：**CTO 派单件 = 规格**（"派单即规格"口径，D821 起）；复杂任务触发式启用 skill `dev-doc-spec`。
   - **独立性硬要求不变**：写了规格的成员不得实现该规格；队长不得兼任规格撰写。
2. **执行形态 = 小队（🎽 synova-squad-lead）**：队长 + ≤2 编码（走 🛠 synova-dsh 纪律模式）+ 1 自验；自验不得由编码兼任。
3. **制衡提示（承重墙）**：规格与协调同归 CTO 后，独立环节只剩 K3 → **K3 必经合并门禁（D923）不是可选项**，是该形态的制衡承重墙。
4. **长任务形状**：程序卡（1）+ 子卡（N）+ Wave 门（K3 审 + CTO 收件闸），见 `docs/synova/coordination/派单-W1-双DSH提升-20260923.md`。

---

## 域归属的唯一源（D943，2026-09-24）

**`docs/synova/coordination/ownership.yaml` 是「路径 → 域（mac/win/k3）」的唯一机器可读源**；本文中任何归属描述（含「Mac 域／Win 域」字样）均为导航性说明，**冲突时以该表的机器裁决为准**。
判定命令：`python3 scripts/control-tower/check-ownership.py <文件...> --owner mac|win`。改表属**门禁语义变更**：须同批 `--emit-codeowners` + 逐字节 drift 断言 + 判别性夹具，并**必过 K3**。
