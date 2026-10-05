# 编码指令 — D546 哨兵 findings 事件化收口（d394-slice1）

> 交付: DeepSeek Harness · dev-doc | 2026-08-28 | 随 spec 交付，供编码 session 启动（独立 clone / 同机 worktree 均可）

---

## 1. 任务文档表（先读后动，顺序即优先级）

| 文档 | 路径 | 作用 |
|---|---|---|
| **实现 spec（编码唯一契约）** | `docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D546-sentinel-findings-event-20260828.md` | §5 事件模型 / §6 D500 复用评估 / §7 durationMs 定位（诚实声明）/ §8 公共契约字段表 C1-C7 / §9 接线 / §10 测试与验收 / §13 DS1-DS8 |
| 派单 D546 | `docs/synova/coordination/派单-D546-sentinel-findings-event-20260828.md` | 写集约束 / 五断言验收 / 防膨胀红线 |
| K3 战略咨询 §4.1/§4.6 | `docs/synova/audit-reports/2026-08-16-D394-D398-strategy-consult.md` | I1/I2/I3 不变量 + durationMs 原文 |
| D394 片1 spec（前序交付，勿重做） | `docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D394-sentinel-events-20260816.md` | 事件层设计权威 |
| Win 片2-A 契约（对齐对象，只读） | `docs/plans/codex/implementation/SYNOVA-IMPL-D487-ga-session-events-slice2a-20260828.md` | 公共契约另一侧（PR #241 已合 main） |
| 北星 | `.claude/PRODUCT-BRIEF.md` §三.2/§六 P0 | 哨兵线方向锚 |
| 铁律 | `AGENTS.md` 0-2/24/31/32/38/47/48 | 质量底线 |

## 2. 执行要求

认真阅读任务文档，然后执行任务。做到你的最高代码水平。任务复杂 → 先用 plan mode 做好计划再执行；先想清楚再动手（禁止没想清楚就改代码）。做完复核：与 dev doc 一致 / 不违反铁律 / 无 bug / 接线完整 / 测试到位 / 其他你认为需要复核的点。Kimi K3 会盯着你的任务，也会做最后的审计。

## 3. 任务专属硬约束（违反 = 审计 FAIL）

1. **基线与行号（M7 防漂移）**: 基线 = **origin/main @ e8ea8ed3**。开工先 `git fetch origin` 核对基线；spec 全部 file:line 锚定该 sha——开工前抽验 3 处（sentinel-events.ts L119 appendSentinelEvent、runner.ts L713 persistRunEvents、session-store.ts L127 session_events DDL），漂移则先对齐 spec 再动手。
2. **写集（目录级，spec §3.3.1）**: src/sentinel/（条件修，预计零改动）/ src/store/（预计零改动）/ src/l3/（预计零改动）/ tests/sentinel/（1 改 + 2 新建）。收工 `git diff --name-only origin/main..HEAD` ⊆ 写集 + package.json 零 diff（DS6）。
3. **禁碰清单**: electron-renderer/ 与 tests/electron/（D544 领地，并行零重叠）；Win 写集文件（src/agent/conversation-engine.ts、src/agent/diagnosis-launcher.ts、src/deploy/bootstrap.ts、src/server.ts、src/store/session-store.ts）；scripts/audit/；scripts/pre-commit-check.sh；.github/workflows/ci.yml。
4. **防膨胀红线**: 零新组件/守护进程/launchd/DSH 依赖；不改 sentinel_events 表 DDL 与 event_type 枚举（D394 已 audited）；契约对齐 = 测试层，不合并两表（spec §6 结论）。
5. **诚实 RED（S-5）**: 实现已在位——测试的 red 用**故障注入**证明网有效: ①契约测试喂「durationMs 冒充 checkedAt」违约 payload → C6 断言必须红；②sha256 等价测试删一条 finding 事件 → 必须红；③回归测试构造 `new Date(durationMs).toISOString()`（年份 1970）→ 必须红。禁伪造 red/绿。
6. **诚实声明传播**: spec §4.1/§7 已标注派单两处前提与代码不符（事件化已交付；durationMs 位置错位且已修）——PR 描述与交付声明必须携带这两条标注，禁止当作"已修 bug"邀功。
7. **evidence 落盘**: 三测试文件运行输出 + §9 五条 grep 输出 + CI check-runs 结果 → 落盘 evidence/D546/（K3 独立重跑可复现）+ 同步 PR 描述。
8. **环境坑**: 本机 BSD grep 无 `-P`；测试全走 vitest（include 已含 tests/**/*.test.ts）；`durationMs` 断言必须经 executeSentinel 生产路径（runner L1080-1081 会用真实耗时覆盖哨兵内部值——builtin 内部返回 0 不影响最终断言）。

## 4. 复核清单（做完逐项自查）

- [ ] DS1-DS8（spec §13）逐项对照，禁重编号/跳号/静默缺项（S-10）
- [ ] DS2 契约测试 3 用例绿（含违约注入 red 证明）
- [ ] DS3 I1 sha256 强化 + 既有 kill -9 用例（tests L170-197）不回归
- [ ] DS4 回归测试 4 用例绿（真实 check 正值 + 纪元防护 + 来源锁定 + 故障注入 red）
- [ ] DS5 §9 五条接线 grep 命中并贴输出
- [ ] DS6 零膨胀: diff ⊆ 写集 + package.json 零 diff
- [ ] DS7 CI 三 job（quality / Vitest 1/2 / Vitest 2/2）全 success 贴结果 + Architecture Check 绿（本地绿不算——D540 教训）
- [ ] DS8 task-state/D546.json impl 段回填 + status=impl_done + L07 收益标注（L07-3 → 持久化+可回放+双线契约统一）
- [ ] 铁律: as any=0 / 降级诚实 / 接线生产调用点（S-3）/ 无 --no-verify / 无 git stash（0-3）

## 5. 审计提示

- 提审口径: 一次提审覆盖 **D546（收口执行）**；K3 重点核对 evidence/D546/ 三测试独立重跑 + §8.1 公共契约表与 D487 doc 的一致性。
- 验证点收口: 五断言（回放/durationMs/契约/CI/接线）从 spec 预判收口为 evidence 实测；task-state slice=d394-slice1 回填后待 K3 verified。
- 与 D544 并行纪律: 各自独立 clone/分支；不碰对方写集；合并顺序由 CTO 排。

---

开始吧。
