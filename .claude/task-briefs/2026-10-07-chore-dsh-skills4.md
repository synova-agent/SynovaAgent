# Task Brief: 引入 4 个编程类过程技能（DSH 技能面）

> 生成: 2026-10-07 | 分支: chore/dsh-skills-4-coding | worktree: .synova-wt-skills4 | 执行: DSH 会话（Win 侧代行）
> 来源: 创始人 2026-10-07 指示"从 GitHub 高星编程类 skill 中挑 4 个装上"；上游 = obra/superpowers（MIT, @8ca22dba）+ addyosmani/agent-skills（MIT, @1401c8b8）

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
本任务不落在产品五层（L1-L5），落在**载体层（DSH 会话资产）**：`.claude/skills/**` 单源 + `.dsh/skills/**` 镜像。
DSH 技能发现根（实证：`dsh-skill-filesystem/lib/index.js`）= `<projectRoot>/.dsh/skills`（rank 100）与 `<projectRoot>/.agents/skills`（rank 200）；预设 `synova-squad-lead` 已挂 `@deepseek-ai/dsh-skill-filesystem` + `@deepseek-ai/dsh-tool-skill`（`dsh/presets/synova-squad-lead/cordis.patch.yml:88-91`），**故新增技能不改预设**。
现有 17 个技能（origin/main）：brief-compose / claim-verifier / contract-template / cto-handover / ctrl-tower-change / dev-doc-delivery / dev-doc-spec / dsh-decision-lens / git-sync-pr / north-star-guard / pr-review / pre-dispatch-check / sentinel-lifecycle / squad-discipline / synova-audit / synova-verify / windows-compat。
新增/扩展判定：**新增 4 个（不覆盖任何现有技能名）**，补的是工程过程面空档——现有 17 个全是 Synova 治理/协作/审计面，**没有调试、简化、接口契约、安全加固四个工程过程技能**。

### b) 文件审计
`ls .claude/skills/` 实测 17 个目录；目标 4 名 `systematic-debugging` / `code-simplification` / `api-and-interface-design` / `security-and-hardening` **零命中**（无同名冲突）。
相关既有资产：`docs/synova/DOC-CONTRACT.md` 把 `.claude/skills/**`、`.dsh/skills/**` 列为**豁免类**（新增 md 必须命中白名单的三闸不适用于技能目录）；`scripts/workflow/sync-dsh-skills.sh` 提供单源→镜像同步与 `--check`。

### c) 决策
无覆盖 → 新建（文件驱动，零 TypeScript 改动）。冲突检查：0。
取舍：**不整包引入上游仓库**（superpowers 15 技能 = 2304 字符 description；addyosmani 25 技能 = 8691 字符 description，全部进每个会话的 catalog），只挑 4 个并改写成中文精简版（每份 < 8192 code point，实测最大 5951）。理由：catalog 成本 + 与现有 17 技能语义不重叠。

## Q1: 调研 — 决策链 + 执行约束

### a) Anthropic 决策链
① Done 标准：4 技能可被 DSH 发现 + 两份逐字节一致（先定义，见文末）。
② 测试/验证先行：先跑 `sync-dsh-skills.sh --check` 与 `diff -r`，再落内容。
③ 实现：只写 `.claude/skills/`（唯一事实源），`.dsh/skills/` 由脚本产出，**禁止手改**。
④ 接线：技能 = 会话启动时被 `dsh-skill-filesystem` 发现；接线判据 = 新会话 catalog 出现技能名（本 brief 记为新会话验收项，不在本会话内伪称已验证）。
⑤ 验证：`sync-dsh-skills.sh --check` → SYNC-OK + exit 0（原始输出入交付说明）。
引用：铁律 7（入口可触达+链路走通+结果可见）、铁律 35（能脚本化的不靠 review——同步用脚本而非手工拷贝）、铁律 47/48（本任务无 compute 函数/无测试文件，不适用）。

### b) 本任务执行约束
- rule: "`.dsh/skills/` 由 sync 脚本产出，禁止手改；两份必须逐字节一致"
  verify: `bash scripts/workflow/sync-dsh-skills.sh --check`（期望 SYNC-OK + exit 0）
- rule: "每份 SKILL.md 正文 < 8192 code point（tool-result pruner 阈值）"
  verify: `wc -m .claude/skills/<name>/SKILL.md`（实测 2482/3106/4175/5951）
- rule: "frontmatter 必须含合法 name(kebab) + description"
  verify: `head -3 .claude/skills/<name>/SKILL.md`

### c) 决策参考系
参考：第一性原理 + 开源实证（上游 MIT 仓库实测 clone/抓取正文）+ Anthropic 工程基线（隔离/机器可验契约）。
结论：① 第一性原理——技能的价值在"被加载时给的判据"，不在数量；4 个针对性技能 > 28 个整包技能。② 开源实证——上游两仓库 star 296,093 / 102,191（GitHub API 2026-10-07 实测），MIT 可改写，正文结构经其自身社区验证。③ 工程基线——单源+镜像+逐字节校验的机器可验契约（已有脚本），本次不新增机制。

### d) 相关 Note 引用
- [ ] 无。本任务为技能资产引入（非治理脚本/铁律/规则文档变更），按 DECISION-REFERENCE 简单决策口径记录参考系即可；若 K3 认为需沉淀，另立 proposed Note。

## Q2: 范围 — 正确的最简方案

做什么：
- 新增 4 个技能到 `.claude/skills/`（单源），中文精简改写，正文保留上游核心判据（四阶段排障 / 五原则简化 / 六原则接口 / 威胁建模+三层边界），每份带 MIT 来源与上游 commit 归属
- 用 `scripts/workflow/sync-dsh-skills.sh` 生成 `.dsh/skills/` 镜像，并跑 `--check` 验证逐字节一致
- 本 brief

不做什么（含文件路径）：
- 不改 `dsh/presets/**`（技能不需要进预设：预设已挂技能加载插件，见 Q0a）
- 不改 `scripts/control-tower/**`、`scripts/workflow/**`、`.github/**`（审计/门禁域，非本任务）
- 不引入上游 `hooks/**`、`index.js`、`scripts/**`（Claude Code 插件机制，DSH 不执行）
- 不整包引入 ECC(1027 SKILL.md) / addyosmani 全量(25) / alirezarezvani(380) 等大包
- 不动 `.claude/skills/` 与 `.dsh/skills/` 下既有 17 个技能

写集（逐文件，组 12 用）：
- `.claude/task-briefs/2026-10-07-chore-dsh-skills4.md`
- `.claude/skills/systematic-debugging/SKILL.md`
- `.claude/skills/code-simplification/SKILL.md`
- `.claude/skills/api-and-interface-design/SKILL.md`
- `.claude/skills/security-and-hardening/SKILL.md`
- `.dsh/skills/systematic-debugging/SKILL.md`
- `.dsh/skills/code-simplification/SKILL.md`
- `.dsh/skills/api-and-interface-design/SKILL.md`
- `.dsh/skills/security-and-hardening/SKILL.md`

## Q3: 验收 — 入口 → 交互 → 结果

入口（用户从哪触发）：DSH 会话启动 → `dsh-skill-filesystem` 扫描 `<projectRoot>/.dsh/skills`（rank 100）→ catalog 出现 4 个技能名；会话中按 description 触发加载。
处理（中间经过哪些步骤）：`tool-skill` 读取 `<skill>/SKILL.md` → 按 frontmatter 判定触发 → 正文作为 tool result 注入（< 8192 code point 不触发 pruner 截断）。
结果（最终展示在哪）：会话内以 `<skill_content>` 块出现，agent 按其中判据执行；`bash scripts/workflow/sync-dsh-skills.sh --check` 输出 SYNC-OK（21 个技能）。

## 架构层: 载体层（DSH 会话资产：.claude/skills 单源 + .dsh/skills 镜像），不落 L1-L5

## Done 标准
- [ ] `sync-dsh-skills.sh --check` → SYNC-OK + exit 0（21 个技能，含新增 4 个）
- [ ] 4 对 `.claude/skills/<n>` ↔ `.dsh/skills/<n>` `diff -r` 全部空输出
- [ ] 4 份 SKILL.md 均 < 8192 code point 且 frontmatter 含 name + description
- [ ] 新开 DSH 会话 catalog 出现 systematic-debugging / code-simplification / api-and-interface-design / security-and-hardening（新会话验收，由使用方复核）
