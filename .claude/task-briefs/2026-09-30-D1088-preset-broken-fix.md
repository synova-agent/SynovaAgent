# Task Brief: D1088 — 预设「加载失败」根因与修复

> 生成: 2026-09-30｜任务: D1088｜认领: 工程线（X30 启动窗）｜分支: feat/D1070-x30-48h-m0
> 触发: T8 空会话测试实测（创始人截图）——新建的 shanhe-researcher 显示红标「加载失败」

## 项目身份（每次重读 — 源自 CLAUDE.md §项目身份）

SynovaAgent 是驻扎企业的 AI 诊断系统；诊断是手段，**增长导航**才是目的：持续观测、主动发现、自动诊断、给出行动建议、跟踪执行。

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
**预设载体面**（DSH 落位质量），非产品 L1–L5。影响 T8 验收与三包部署。

### b) 文件审计
- `.dsh-trial-017/profiles/desktop/node_modules/@local/dsh-preset-shanhe-researcher/cordis.patch.yml`（软链 → `/Users/wane/src/dsh-preset-bundles/shanhe-researcher`）
- 源码机制：`@deepseek-ai/dsh-agent-preset-registry/lib/index.js` 的 `list()`/`diagnostic()`（asar 内实读）
- 对照件：`synova-main-cto` 与其余 13 个 @local 预设
- 关系：**修复既有**（我建的包），非新建。

### c) 决策
先定位机制（源码）→ 再做**行集差集**（对已验证能跑的同族包）→ 最小修复（补 1 行 runtime）；不猜、不改无关行。

## Q1: 调研 — 决策链 + 执行约束

### a) Anthropic 决策链
① Done＝红标消失且行集与对照件一致 → ② 复算＝差集命令 → ③ 修 → ④ 生效路径＝软链 → ⑤ 自检。
引用铁律 7/9/24。

### b) 本任务执行约束
- rule: "修复必须与已验证可跑的对照包做行集差集，不得凭形状对齐"
  verify: §五 ③ 的差集命令输出「无」
- rule: "不改他人预设（liangshen）"
  verify: 本次改动仅 shanhe-researcher 包

### c) 决策参考系
参考：Anthropic（可复跑证据）+ 第一性原理（最小修复＝补缺失的 runtime 行）→ 结论：补 1 行 + 记录源头教训。

### d) 相关 Note 引用
- [x] 无独立决策（缺陷修复），教训并入 D1088 件 §三。

## Q2: 范围 — 正确的最简方案是什么？

做什么：
- 在 `shanhe-researcher/cordis.patch.yml` 的 delegation 组补 `workflow-ptc` 行（照主 CTO 写法）。
- 落 `docs/synova/coordination/D1088-预设加载失败根因与修复-20260930.md`（机制/证据/修法/复跑/存量发现）。

不做什么（含文件路径）：
- 不改 `liangshen`（存量坏件，非本窗口产物，只报告）；
- 不改参考件 `角色包实例/线研究员/preset.yml`（研究院件，改动走 ⑧ 复核）；
- 不触 `scripts/audit/**`（D336）。

## 写集

| 文件 | 类 |
|---|---|
| `.claude/task-briefs/2026-09-30-D1088-preset-broken-fix.md` | task |
| `docs/synova/coordination/D1088-预设加载失败根因与修复-20260930.md` | task |
| `.claude/bypass.log` | builtin（synova-commit D414：证据链随提交入库，非人工写入） |

## Q3: 验收 — 入口 → 交互 → 结果

入口（从哪触发）：设置 → Agent 预设，看红标是否消失。
处理（中间经过哪些步骤）：定位机制 → 行集差集 → 补行 → 软链即时生效。
结果（最终展示在哪）：D1088 件 + 预设卡片红标消失。

## 架构层: 基础设施（预设载体面，非 L1–L5）
## 文档引用: `D946-载体制核实-20260930.md`；`空对话测试清单.md`；`D1087-空会话测试操作卡-20260930.md`
## 接口审计: 无代码接口变更

#CRITERIA: A

## Done 标准
- [ ] 入口可触达: delegation 组行集与 synova-main-cto 差集为空
- [ ] 链路走通: 全 15 预设中「有 tool-workflow 无 workflow-ptc」者 = 0
- [ ] 结果可见: `git log -1 --oneline -- docs/synova/coordination/D1088*` 有提交
