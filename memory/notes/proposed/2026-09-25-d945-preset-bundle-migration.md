# 决策 Note — D945 预设机制迁移收口（legacy 目录 → bundle 声明行）

- 状态: proposed（待 K3 审 + CTO 收件闸后 git mv 到 implemented/）
- 日期: 2026-09-25
- 决策: 预设载体以 **bundle 声明行**为唯一投递面（`@deepseek-ai/dsh-agent-preset` + `config{id,name,description,plugins}`）；**legacy 目录退役采用"先验证、后移除"两段式**——本卡只出清单 + tar 备份 + 退役时点说明，删除由 CTO 在"新载体验证生效"之后执行。
- 理由: 第一性原理——载体退役若无回退路径即不可逆；实测运行时 bundle 内容**陈旧**（`delegation` 残留 / `agent-team` 缺失），而 legacy 源才是正确内容 ⇒ 此刻删除 legacy = 销毁正确副本。故必须保留到新载体验证通过。

## 实测事实（2026-09-25 00:27 +0800）

- 上游：`packages/preset/agent-preset/skills/editing-cordis-compositions/SKILL.md:70`「Nothing reads that directory any more」；`grep -rln "agent-presets" packages/*/src` = **0 文件**
- 运行时：`profiles/desktop/package.json` 的 `dsh.profile.bundles` = 16 条（含 5 个 synova 预设）；`node_modules/@local/` 12 个预设已安装
- **陈旧点**：`dsh-preset-synova-squad-lead/cordis.patch.yml`（21526 B，Sep 23 02:07）含 `delegation`、`agent-team` 命中 **False**
- **正确源**：`~/.dsh/.agent-presets/synova-squad-lead/agent.cordis.yml` 与 `~/.dsh-trial-017/.../agent.cordis.yml` 同为 `ce80a3da…`，含 `- id: agent-team`（6 处命中）、无 `- id: delegation`（delegation 仅在注释 :193/:198），`maxMembers: 4`（:213）

## 关键设计决定

1. **仓库为源、bundle 为投递面**：`docs/synova/presets/synova-squad-lead/{package.json,cordis.patch.yml}` 入库；安装器改走 bundle 层，legacy 路径只保留"已废弃"提示分支。
2. **一致性问题显性化**：新脚本 `check-preset-bundles.sh` 同时校验（仓库源形态 / 运行时一致性 / legacy 在场或复活判红），把 D931 那类"迁移完成 ≠ 内容最新"变成可执行判据。
3. **判据三分**：正常（声明行齐 + 一致性 OK）/ 降级（DSH 缺失或版本不足 → 显式 `degraded`，exit 2）/ 边界（legacy 在场 → 判红；legacy 复活 → 判红）。
4. **平台无关**：新脚本过 V5（PYBIN 探针，禁裸 `python3`／`grep -P`／`date +%s`／`date -v`）；夹具禁依赖方言（ERE/BRE、`sed -i`、权限位）。

## 参考系

第一性原理（不可逆操作必须两段式）+ Anthropic 工程基线（判据可执行 + 变异体改坏即红）+ 仓内先例（D313 M5 编码强制、D516 登记后等 CI、D931 副本漂移、D937/M9 跨平台判定陷阱）→ 结论：仓库为源 + bundle 投递 + 一致性对账 + legacy 两段式退役。
