---
状态: proposed
日期: 2026-10-08
决策: 修 #986（施工单 0-12）：`skills/` 46 个技能文件改由 `getSkillLoader()` 首用一次性自加载，挂载键补 D650「旧名 → v3.0 问题域专家 id」映射，且映射抽为两处共用的单一真源 `src/agent/expert-name-map.ts`。
理由: ① `scanFromFiles()` 此前零调用点 ⇒ 专家 prompt 恒无 `## Available Skills`（宪章 §4.7 现状栏登记）；而选项 (b)「迁到 extensions/skills/」的目标注册表 `skillRegistry` 全仓唯一读点就是它自己的写入行 ⇒ 等于搬进另一个不可达表；② 只加一次扫描仍不足以让判据变绿——loader 用目录名（strategy/org/finance…）当挂载键，而生产传参是 v3.0 问题域 id（host/fundamental-efficiency/…），名字对不上；③ 该映射在 `synova-diagnosis-engine-impl.ts:538-552` 已有一份（D650），若在 loader 再写一份 = 两套同一件东西 ⇒ 必然漂移（本项目反复吃亏的病），故抽常量共用。
---

## 上下文

- **触发**：施工单第 0 批止血项 `0-12`，模块 K9（建档·岗位预设·技能面），卡 `#986`；CTO 2026-10-08 放行 **(a) 启动自加载**。
- **生产消费链**：`src/l3/expert-dispatcher.ts:311` → `getSkillLoader().buildCatalogText(type)` → `:332` 拼进专家 systemPrompt（此前读的是空表 ⇒ 恒无 `## Available Skills`）。
- **权威映射出处**（不得自创）：`src/l3/synova-diagnosis-engine-impl.ts:538-552`（D650 落地）+ 权威第六章 §6.9.1 迁移映射。

## 本次决策要点

1. **自加载落点 = 单例首用**（`getSkillLoader()`），不是 bootstrap：`src/deploy/bootstrap.ts` 不在本卡写集；自加载幂等，将来要「启动期确定性加载」在 bootstrap Phase 2b 显式调用同一函数即可（文件头 `@follow-up` 已留指针）。
2. **挂载键双链**：legacy 目录名（向后兼容）+ 映射后的 v3.0 专家 id（生产口径）；映射目标经 `getAllExpertIds()`（`expert/expert-registry.yaml` 唯一事实源）校验，未知目标只保留 legacy 键 + `log.warn`，**不回落 host**（技能挂载是增强不是路由，挂错会污染该专家 prompt）。
3. **6 个未映射目录**（`cross_validate` / `detect_contradiction` / `human_calibration` / `match_pattern` / `trace_evidence` / `verify_closed_loop`，共 6 技能）**不自创映射**：D650 表不含它们，无权威来源 ⇒ 保持 legacy 链接，覆盖率 40/46；CTO 台账记「待权威定义」，归 K9 后续。
4. **附带修**：front matter 的 YAML 块标量描述（`description: >-` / `|`，实测 7/46 个技能文件）此前会被解析成字面量 `>-` 注入 prompt。

## 实测口径（可复跑）

- 技能文件数：`git ls-tree -r --name-only origin/main -- skills/ | grep -c '\.md$'` ⇒ 46
- 注册表专家：`getAllExpertIds()` ⇒ 6（host / fundamental-efficiency / customer-growth / organizational-capability / technology-foundation / competitive-strategy）
- 映射后覆盖：`host=11  fundamental-efficiency=3  customer-growth=9  organizational-capability=4  technology-foundation=2  competitive-strategy=11` ⇒ 可达 **40/46**
- 判据：`npx tsx scripts/control-tower/probe-skills.ts` ⇒ stdout 含 `## Available Skills`、exit 0

## 相关

- 卡：`#986`（0-12 · K9 · 第 0 批-止血）
- 不属本 Note 的已知未决：`src/skills/skill-loader.ts`（第三套 loader，零消费者，仅登记）
