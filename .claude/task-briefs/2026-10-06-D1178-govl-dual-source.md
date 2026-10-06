# Task Brief: D1178 govl-dual-source

> 生成: 2026-10-06 | 任务: D1178 | 认领: 治理线(deepseek-flash)
> 参考: D333 决策四步（第一性原理→Anthropic→开源实证→收敛）
> 坐标系: 执行态=已交付 ｜ 施工批次=第4批-文档 ｜ 服务承重件=不适用 ｜ 总闸=不适用
>          命名空间=不适用 ｜ 验证级别=L2-真跑通 ｜ 阻塞源=等创始人裁
> 派单源: CTO《开发计划 v2》第四批 **D3**（双真源 ⇒ 合并）｜**本卡对配方做了更正，见 Q0c**

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
文档契约层（`docs/authority/` + `scripts/control-tower/`），非产品五层。
### b) 文件审计（**先复核，不靠记忆**）
- `docs/authority/DOCS-REGISTRY.yaml` —— **59** 条目（id/type/path/status/owner）｜**本门禁消费**
- `scripts/control-tower/doc-registry.json` —— **18** `docs` + **16** `aliases` ｜**`inject-context.py:34` 消费**
- 实测两源 **交集 = 1 条**（`docs/synova/coordination/DECISION-REFERENCE.md`）
- JSON 自身**当前是干净的**：18/18 `docs` path 存在、16/16 `aliases` 指向真实 key —— 但**没有任何检查**保证它明天还是
### c) 决策 —— 🔴 **配方更正（判例 P-01）**
派单原文「双真源 ⇒ **合并**」。**实测两者近乎不相交、用途不同**：
YAML = 登记台账；JSON = **权威文档短名 → 路径**（给上下文注入器用）。
⇒ **强行合并会打断 `inject-context.py` 的消费面，且解决不了一个真实存在的问题**。
⇒ 真正的问题是「**两个源互不校验**」⇒ 本卡改为补**交叉一致性检查**，并**在本卡内如实报配方更正**。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 铁律 35/47；判例 **P-01**（先核派单方的配方，不照抄）、**V-02**（真跑）、**V-09**（未核写未核）、**M-02**（三态）。
- 决策参考：**第一性原理**（"两个源"本身不是问题，**"两个源互不校验"**才是）+ **Anthropic 工程基线**（先立不变量，再谈合并）⇒ 结论 = 立交叉不变量。

## Q2: 范围 — 正确的最简方案
做什么：
- scripts/doc-system/doc-registry-gate.sh
- .github/workflows/ci.yml
  🔴 D1188 补声明（复核整改）: 登记新夹具进**两处密封清单** —— D526 语义「未列举 = 永不执行」，
  未登记则 `check-gate-integrity.sh --registry-only` 判 VIOLATION。
  ⚠️ **登记 ≠ 进必需 context**（既有机械义务 vs 门禁语义变更）—— 我此前把两件事混为一谈。
- tests/doc-system/doc-registry-selfcheck.test.sh
- .claude/task-briefs/2026-10-06-D1178-govl-dual-source.md
- memory/notes/proposed/2026-10-06-d1178-dual-source.md
- task-state/D1178.json
不做什么：
- 不合并两个源（合并会打断 inject-context.py 的消费面）
- 不改 scripts/control-tower/inject-context.py
- 不改 scripts/control-tower/context-injector.sh
- 不改 scripts/control-tower/doc-registry.json
- 不改 .github/workflows/ci.yml
- 不改 docs/authority/DOCS-REGISTRY.yaml
- 不改 scripts/audit/check-audit-consistency.sh

## Q3: 验收 — 入口 → 交互 → 结果
入口：`bash scripts/doc-system/doc-registry-gate.sh`
处理：登记判定（原有）+ 台账自洽（D2）+ **双真源交叉**：JSON `docs` path 存在 / `aliases` 指向真实 key / 与 YAML 交集逐字一致
结果：逐条 `✅/⏭️/❌`；exit 0/1
- `bash tests/doc-system/doc-registry-selfcheck.test.sh` ⇒ `RESULT: 16 PASS / 0 FAIL`

## 架构层:
文档契约层 + scripts/doc-system（非产品五层）

## Done 标准
- [ ] verify: `bash tests/doc-system/doc-registry-selfcheck.test.sh` ⇒ 含 `RESULT: 16 PASS / 0 FAIL`
- [ ] verify: `bash scripts/doc-system/doc-registry-gate.sh; echo $?` ⇒ 0
- [ ] verify: `bash scripts/doc-system/doc-registry-gate.sh 2>&1 | grep -c '双真源: docs 18 条'` ⇒ 1
- [ ] verify: `grep -c 'NOPE\|NO-SUCH-KEY' docs/authority/DOCS-REGISTRY.yaml scripts/control-tower/doc-registry.json` ⇒ 全 0
