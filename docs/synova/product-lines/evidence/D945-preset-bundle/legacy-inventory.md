# D945 段② — legacy 预设退役清单 + 备份回执

> **任务**：D945 / task-17（写者 `d945-coder-b`）｜**工作树** `.synova-wt-squad-d945`｜**分支** `feat/d945-preset-bundle`｜**base** `origin/main` = `11458279`
> **生成时点**：2026-09-25 00:29 +0800（采集主机 = Mac DSH）
> **🔴 红线**：本件**只读 + 备份，绝不删除**任何 legacy 目录。本件不含任何 `rm`。删除动作由 **CTO** 在 §4 条件**全部**满足后另行执行。

---

## 1. 范围与口径

| 项 | 值 |
|---|---|
| 收录对象 | **两处 home × `.agent-presets/synova-*`**（`~/.dsh/`、`~/.dsh-trial-017/`） |
| 收录粒度 | **逐目录 + 逐文件**（含隐藏文件如 `.synova-preset-version`），每条附 `sha256` + 字节数 |
| 收录目录数 | **4 + 5 = 9 个** |
| 收录文件数 | **9 + 12 = 21 个** |
| **排除**（非本卡范围） | 同两处 home 下的**非 synova 预设**：`liangshen`、`securities-research`、`shanhe-{business,director,product,tech,theory}` — 属其他产品线，**不在本卡收录/退役范围**，本文不做删除建议 |
| 采集方式 | `find <dir> -type f \| sort` + `shasum -a 256` + `wc -c` + `stat -f %Sm`（全部为命令原始输出，无手写数字） |

**口径说明**：本件只覆盖 `synova-*` 前缀目录。非 synova 预设虽随 tar 备份一并归档（备份是整目录快照，不裁剪），但**退役结论不适用于它们**。

---

## 2. 清单：两处 home × `synova-*`（逐文件 sha256）

### 2.1 `~/.dsh/.agent-presets/` — 4 目录 / 9 文件

| 目录 | 文件（相对 `~/.dsh/.agent-presets/`） | sha256 | bytes |
|---|---|---|---|
| `synova-cto` | `synova-cto/agent.cordis.yml` | `b3c115de4254cfa67704ccf063adaf62617f06dc7016b5a997367b4e7ab38f86` | 17901 |
| `synova-cto` | `synova-cto/preset.yml` | `7325d014a6010402bc9ea76525bae908757ed2f5226a9cbcb6c06931f3b74961` | 335 |
| `synova-dsh` | `synova-dsh/.synova-preset-version` | `022b6075cf1b6fb401a9b70f53ceeb994218230a0cbf6f749c851d729df3ee92` | 133 |
| `synova-dsh` | `synova-dsh/agent.cordis.yml` | `c2fa46c0c4faa07e8bd779be01e13bc74e5f7a1704794db84077af52dc974b83` | 18563 |
| `synova-dsh` | `synova-dsh/preset.yml` | `40af74b08cb609afbd72ce9ee517cebde490d0d5324fe8d51a0b80d9e74063ab` | 382 |
| `synova-k3-audit` | `synova-k3-audit/agent.cordis.yml` | `a4ae9f515acc0268f3ce73f766f6e5daf0d1e06fa26986845b16e0981cd6a9bf` | 11501 |
| `synova-k3-audit` | `synova-k3-audit/preset.yml` | `58ba73b50a2d6c10a350256d4313d32ef272fbcf4b27842a818934aa22b3795d` | 302 |
| `synova-squad-lead` | `synova-squad-lead/agent.cordis.yml` | `ce80a3da057130ecfafe4a55ce4dd3a4f0b1e21e780905a8f493f171cbc62c9d` | 17055 |
| `synova-squad-lead` | `synova-squad-lead/preset.yml` | `20f76fc2287ac0e9ceffd0edfff32dd4016ecc58ed72a528ea17bf7ce6836a87` | 381 |

目录 mtime（退役溯源证据）：

```
2026-08-25 03:08:07  .dsh/.agent-presets/synova-cto
2026-09-23 16:35:45  .dsh/.agent-presets/synova-dsh
2026-08-22 20:57:54  .dsh/.agent-presets/synova-k3-audit
2026-09-23 18:44:03  .dsh/.agent-presets/synova-squad-lead
```

### 2.2 `~/.dsh-trial-017/.agent-presets/` — 5 目录 / 12 文件

| 目录 | 文件（相对 `~/.dsh-trial-017/.agent-presets/`） | sha256 | bytes |
|---|---|---|---|
| `synova-cto` | `synova-cto/agent.cordis.yml` | `b3c115de4254cfa67704ccf063adaf62617f06dc7016b5a997367b4e7ab38f86` | 17901 |
| `synova-cto` | `synova-cto/preset.yml` | `7325d014a6010402bc9ea76525bae908757ed2f5226a9cbcb6c06931f3b74961` | 335 |
| `synova-devdoc` | `synova-devdoc/.synova-preset-version` | `6d6fe0186f686e689b0c385502297b7452be5ca9deb561039a54c5dc6f6a2b17` | 133 |
| `synova-devdoc` | `synova-devdoc/agent.cordis.yml` | `8adf4a4051dee880b0b80e7baeeb49c0b3532b8049e6f860642dc1f58d9b2963` | 21615 |
| `synova-devdoc` | `synova-devdoc/preset.yml` | `71b97d397c30f5cb0dd8896296f470c713884cd3bee1396f7a8466dd19355e48` | 291 |
| `synova-dsh` | `synova-dsh/.synova-preset-version` | `654fd465353a8112b05b378a79f9fa56bcd27fce49a6e3e4d7ffedf9f5c5e37b` | 133 |
| `synova-dsh` | `synova-dsh/agent.cordis.yml` | `ad6ce85bdba6c3df3054c542c840823ec20a55bebcc90add827b1008c48a0c6e` | 28769 |
| `synova-dsh` | `synova-dsh/preset.yml` | `40af74b08cb609afbd72ce9ee517cebde490d0d5324fe8d51a0b80d9e74063ab` | 382 |
| `synova-k3-audit` | `synova-k3-audit/agent.cordis.yml` | `a4ae9f515acc0268f3ce73f766f6e5daf0d1e06fa26986845b16e0981cd6a9bf` | 11501 |
| `synova-k3-audit` | `synova-k3-audit/preset.yml` | `58ba73b50a2d6c10a350256d4313d32ef272fbcf4b27842a818934aa22b3795d` | 302 |
| `synova-squad-lead` | `synova-squad-lead/agent.cordis.yml` | `ce80a3da057130ecfafe4a55ce4dd3a4f0b1e21e780905a8f493f171cbc62c9d` | 17055 |
| `synova-squad-lead` | `synova-squad-lead/preset.yml` | `20f76fc2287ac0e9ceffd0edfff32dd4016ecc58ed72a528ea17bf7ce6836a87` | 381 |

目录 mtime：

```
2026-08-25 03:08:07  .dsh-trial-017/.agent-presets/synova-cto
2026-08-16 12:12:32  .dsh-trial-017/.agent-presets/synova-devdoc
2026-08-16 12:12:32  .dsh-trial-017/.agent-presets/synova-dsh
2026-08-22 20:57:54  .dsh-trial-017/.agent-presets/synova-k3-audit
2026-09-21 21:49:47  .dsh-trial-017/.agent-presets/synova-squad-lead
```

### 2.3 跨 home 差异（退役前必须知道）

| 预设 | `~/.dsh` | `~/.dsh-trial-017` | 关系 |
|---|---|---|---|
| `synova-cto` | `b3c115de…` / `7325d014…` | `b3c115de…` / `7325d014…` | **逐字节相同** |
| `synova-k3-audit` | `a4ae9f51…` / `58ba73b5…` | `a4ae9f51…` / `58ba73b5…` | **逐字节相同** |
| `synova-squad-lead` | `ce80a3da…` / `20f76fc2…` | `ce80a3da…` / `20f76fc2…` | **逐字节相同** |
| `synova-dsh` | `c2fa46c0…`（18563 B） | `ad6ce85b…`（28769 B） | ⚠️ **不同**（差 10206 B） |
| `synova-dsh/.synova-preset-version` | `022b6075…` | `654fd465…` | ⚠️ **不同**（同 133 B，内容异） |
| `synova-devdoc` | **不存在** | `8adf4a40…` | 仅 trial-017 有 |

**交叉核验（对 CTO brief 的独立性验证）**：brief Q0b 声称 legacy 源 `~/.dsh-trial-017/.agent-presets/synova-squad-lead/agent.cordis.yml` = `ce80a3da…`、含 `- id: agent-team`、无 `- id: delegation`。三条**全部实测为真**：

```
$ shasum -a 256 ~/.dsh-trial-017/.agent-presets/synova-squad-lead/agent.cordis.yml
ce80a3da057130ecfafe4a55ce4dd3a4f0b1e21e780905a8f493f171cbc62c9d
$ grep -c '^- id: agent-team' …/synova-squad-lead/agent.cordis.yml   → 1
$ grep -c 'id: delegation'    …/synova-squad-lead/agent.cordis.yml   → 0
  （`delegation` 仅出现在注释 :193 / :198，非声明行）
```

---

## 3. tar 备份回执（仓库外）

| 项 | 值 |
|---|---|
| **备份路径** | `/tmp/d945-legacy-presets-20260925-002954.tar.gz` |
| **备份位置** | **仓库外**（`/tmp`，非 git 工作树；`git status` 不受影响） |
| **字节数** | `48611` |
| **sha256** | `b9de50fecc9a11e102c64301057921de8dff6549e4598f507946ab1a8a18b09d` |
| **tar 条目数** | `30`（21 文件 + 9 目录） |
| 归档命令 | `cd ~ && tar -czf <out> .dsh/.agent-presets/synova-{cto,dsh,k3-audit,squad-lead} .dsh-trial-017/.agent-presets/synova-{cto,dsh,k3-audit,squad-lead,devdoc}`（`tar rc=0`） |

`shasum -a 256` 原始输出：

```
b9de50fecc9a11e102c64301057921de8dff6549e4598f507946ab1a8a18b09d  /tmp/d945-legacy-presets-20260925-002954.tar.gz
```

`tar -tzf` 头部清单（按卡验收 #4 要求）：

```
.dsh/.agent-presets/synova-cto/
.dsh/.agent-presets/synova-cto/agent.cordis.yml
.dsh/.agent-presets/synova-cto/preset.yml
.dsh/.agent-presets/synova-dsh/
.dsh/.agent-presets/synova-dsh/agent.cordis.yml
.dsh/.agent-presets/synova-dsh/.synova-preset-version
.dsh/.agent-presets/synova-dsh/preset.yml
.dsh/.agent-presets/synova-k3-audit/
.dsh/.agent-presets/synova-k3-audit/agent.cordis.yml
.dsh/.agent-presets/synova-k3-audit/preset.yml
.dsh/.agent-presets/synova-squad-lead/
.dsh/.agent-presets/synova-squad-lead/agent.cordis.yml
...
总条目数: 30
```

### 3.1 备份可用性验证（不是"声称有备份"，是"证明备份可还原"）

仅"打了 tar"不等于备份可用。已做**还原比对**：解包到 `mktemp -d` 沙箱，对 **21 个文件逐条**比对源文件与还原件 sha256：

```
files=21 mismatch=0
RESTORE-VERIFY: ALL MATCH
```

（逐条 21 行 `OK` 见 §7 复现脚本；`extract rc=0`）

**结论**：备份对 21/21 文件**逐字节忠实**，可作为退役后回滚源。

---

## 4. 退役时点说明（何时可删 / 删前条件 / 由谁执行）

### 4.1 上游判据（已逐字复核，非转述）

上游 DSH 自身声明 legacy 目录范式已作废。该文件**不在本仓库**，在 DSH 工具链 checkout：

```
/Users/wane/src/deepseek-harness-017/packages/preset/agent-preset/skills/editing-cordis-compositions/SKILL.md:70
```

第 70 行原文（`sed -n '70p'` 实取）：

> Before declaration rows, a user preset was a directory `$DSH_HOME/.agent-presets/<id>/` holding `preset.yml` … and `agent.cordis.yml` (the plugin entry list). **Nothing reads that directory any more.** To migrate one, create a bundle as above … Install it, **verify the row**, then **delete the legacy directory**.

**该段同时给出了上游规定的退役次序**：`建 bundle → install → verify the row → delete legacy`。本件 §4.2/§4.3 即按此次序落地为可核条件。

（注：CTO brief 引用该文件时省略了 checkout 前缀，写作 `packages/preset/agent-preset/skills/…`，在本仓库内 `find` **不存在**——已在 checkout 内核实为真，非虚构引用。建议后续引用补全根路径。）

### 4.2 ⚠️ 关键：两处 home 的迁移状态**相反** —— 不可一并退役

实测两处 home 的 bundle 层状态：

| home | profile | `dsh.profile.bundles` 条数 | `@local/` 预设数 | 迁移状态 |
|---|---|---|---|---|
| `~/.dsh-trial-017`（**本会话活动 `DSH_HOME`**） | `profiles/desktop` | **16** | **12** | ✅ **已迁移** |
| `~/.dsh-trial-017` | `profiles/headless` | 2 | 0 | —（非预设 profile） |
| `~/.dsh` | `profiles/desktop` | 4 | **0** | ❌ **未迁移** |
| `~/.dsh` | `profiles/tauri` | 2 | **0** | ❌ 未迁移 |
| `~/.dsh` | `profiles/web` | 23 | **0** | ❌ 未迁移 |

**`~/.dsh-trial-017` 侧：legacy ↔ bundle 严格 1:1**（12 legacy 目录 ↔ 12 个 `@local/dsh-preset-*`，逐名双向配对，零缺漏）：

```
legacy dirs (N=12)                @local bundles (N=12)
liangshen                         dsh-preset-liangshen
securities-research               dsh-preset-securities-research
shanhe-{business,director,product,tech,theory}  dsh-preset-shanhe-{…}
synova-cto                        dsh-preset-synova-cto
synova-devdoc                     dsh-preset-synova-devdoc
synova-dsh                        dsh-preset-synova-dsh
synova-k3-audit                   dsh-preset-synova-k3-audit
synova-squad-lead                 dsh-preset-synova-squad-lead
→ legacy 无对应 bundle：0；bundle 无对应 legacy：0
```

新载体形态实例（`dsh-preset-synova-squad-lead/`）：`package.json`（171 B）+ `cordis.patch.yml`（21526 B，Sep 23 02:07）。

> **由此得出两条不可合并的结论**：
> 1. **`~/.dsh-trial-017/.agent-presets/synova-*`** → 具备退役前提（bundle 侧已有等价物），**待 §4.3 条件满足后可删**。
> 2. **`~/.dsh/.agent-presets/synova-*`** → **不具备退役前提**：该 home **完全没有** `@local/` bundle，legacy 目录仍是其**唯一载体**。此时删除 = 该 home 预设直接消失。**不得随 trial-017 一并删除。**

### 4.3 删前必须满足的条件（全绿才可删；任一未满足 → 不删）

**A 门 — 新载体已生效（对 `~/.dsh-trial-017`）**
- [ ] A1 该 home `profiles/desktop/package.json` 的 `dsh.profile.bundles[]` 含对应 `@local/dsh-preset-<id>`（当前：12/12 ✅）
- [ ] A2 `node_modules/@local/dsh-preset-<id>/` 实体在读，且 `{package.json,cordis.patch.yml}` 与仓库 bundle 源一致（归 **D945 段①/段④** 的 `check-preset-bundles.sh --check` 判据面）
- [ ] A3 **上游 `verify the row` 步骤已完成**：在**活 host 会话**里 `plugin_manager` `list_bundles` 列出该 bundle、`list_plugins` 显示 `preset-<id>` 行**且 activation 状态正常**（── 该步**只能在活 host 侧由人执行**，静态检查替代不了；对应 CTO 令「CTO 活 host 侧确认选择器可见」）
- [ ] A4 新会话（非既有会话）内**实际选中该预设可用**——上游明示"既有会话与其子会话保持启动时的插件 revision"，故必须在**新会话**验证

**B 门 — 无仓库内残留消费者**
- [ ] B1 `grep -rln "agent-presets" packages/*/src` = **0** ✅（实测已满足）
- [ ] B2 ⚠️ **本仓库自有工具的消费者已处理**：`dsh/plugins/synova-dashboards/scripts/install-dashboards.sh:22` 仍读 legacy：
      `PRESET_FILE="$DSH_HOME_DIR/.agent-presets/synova-cto/agent.cordis.yml"`（`:71-76` 读 + 改写，逻辑="从 synova-cto 预设删除旧 loader 块"）。
      → **删 `~/.dsh/.agent-presets/synova-cto/` 前必须先改道该脚本**（其 `:71` 已有 `if [ ! -f ]` 分支，删后为**静默跳过**而非崩溃——但"跳过"是否语义正确须由该脚本 owner 判定）。**本项未完成时，`~/.dsh` 侧 synova-cto 不得删。**
- [ ] B3 `docs/synova/coordination/Win侧同步包-20260923.md:128-129` 等文档仍在指示读 legacy 的**人工命令**——文档口径需同步（不阻断，但会误导下一个人）

**C 门 — 备份与回退**
- [ ] C1 本件 §3 的 tar 备份**已被复制到仓库外第二处**（当前仅在 `/tmp`；`/tmp` 会被清理，**不足以作为唯一回退源**——建议由 CTO 复制至 iCloud Drive/异地，对齐铁律 0-4"数据资产备份"）
- [ ] C2 备份 sha256 已记录（`b9de50fe…`）且还原比对通过（§3.1 ✅ 21/21）

**D 门 — 授权**
- [ ] D1 创始人/CTO 明确授权（legacy 属**仓外、创始人机器状态**；D922 已有先例口径：`~/.dsh/.agent-presets/synova-devdoc` "**须创始人明确授权后处置**"）

### 4.4 执行者与执行方式

| 项 | 规定 |
|---|---|
| **执行者** | **CTO**（本卡 `d945-coder-b` 及 D945 小队**一律不得删除**；卡与 brief §Q2 均列"不删 legacy 目录"为红线） |
| **执行范围** | **仅** `~/.dsh-trial-017/.agent-presets/synova-{cto,dsh,k3-audit,squad-lead,devdoc}`；`~/.dsh/**` 与两处 home 的**非 synova 预设**均**不在**范围内 |
| **前置** | §4.3 A/B/C/D **四门全绿** |
| **回退** | 任一预设异常 → `tar -xzf /tmp/d945-legacy-presets-20260925-002954.tar.gz -C ~` 原样还原（路径结构一致，可直接还原） |
| **执行后** | 归档本件 + 更新 §4.3 勾选状态 + 记 Note（铁律 49） |

### 4.5 当前就绪度小结

| home | 可否删 | 阻塞项 |
|---|---|---|
| `~/.dsh-trial-017/.agent-presets/synova-*` | ⏸ **未就绪** | A3（活 host 侧 `verify the row` 未做）、C1（备份仍单点）、D1（授权） |
| `~/.dsh/.agent-presets/synova-*` | ⛔ **明确不可删** | **该 home 无 bundle 层**（§4.2）；另有 B2 活消费者 |

---

## 5. 未决项（交 CTO / 队长）

1. **P5 — bundle 源落位中（本件采集时未就位）**：CTO brief §Q2 列 `docs/synova/presets/synova-squad-lead/{package.json,cordis.patch.yml}` 为新建。采集时点（00:29）实测 `find docs/synova/presets -name package.json -o -name cordis.patch.yml` = **0 命中**；至 00:33 复核时 `cordis.patch.yml` **已由 `d945-coder-a` 落盘**（sha256 `24cf1677413f36d84226b80a826011da2d3f1a3c287744af8d50e259124ba47d`，259 行；硬判据 `grep -c "agent-team"` = **6** ≥1、`grep -c "id: delegation"` = **0** —— 由本件独立复跑确认，非转述），`package.json` 仍待落。§4.3 A2 的"仓库 bundle 源一致"判据须待二者齐备。采集时点该目录实际内容：`synova-squad-lead/{SYSTEM-PROMPT.md,preset.yml}`、`synova-cto/{README.md,persona-block.yml,preset.yml}`、`synova-k3-audit/{README.md,persona-block.yml,preset.yml}`、`install-squad-lead.sh`。
2. **B2 — 仓库内仍有 legacy 消费者**：`dsh/plugins/synova-dashboards/scripts/install-dashboards.sh:22/71-76` 读且改写 `~/.dsh/.agent-presets/synova-cto/agent.cordis.yml`。**该脚本不在 D945 任何人的写集内** → 需 CTO 决定：随 D945 一起改道，还是立新卡。**在它改道前，`~/.dsh` 侧退役不可能完成**（且 `check-preset-bundles.sh --consistency` 若以"legacy 在场即判红"为判据，会因此永久红）。
3. **C1 — 备份单点**：当前唯一备份在 `/tmp`（易失）。建议 CTO 落异地副本（铁律 0-4 同口径）。
4. **"判据 1" 指代不明**：CTO 令写"新载体验证生效 = **判据 1 全过** + CTO 活 host 侧确认选择器可见"。本人在 **main 可读**范围内 `grep -rln "判据 1\|判据1" docs/ .claude/ task-state/` 仅命中 `B5-自验.md:643` 与 `总计划-双DSH提升-W1波-20260923.md:223`，**两处均与预设迁移无关** → **本件无法引用"判据 1"的权威定义**。已在 §4.3 按语义拆为可核的 A1–A4，其中 A3 即"活 host 侧确认选择器可见"。**请 CTO 指认"判据 1"的确切出处**，或确认 A1–A4 即其实现。
5. **段③ 状态 = held**：`tests/control-tower/install-dsh-preset.test.sh` 的 T8/T9/T10/T11 适配**未执行**。理由（lead 裁定，已复核为真）：该夹具的三条标注（`T3 LOAD-BEARING` / `T3c LOAD-BEARING` / `T3b NEGATIVE-CONTROL`）由 **B3 分支 `feat/b3-d922-fixture` 引入且未合 main**（`git show origin/feat/b3-d922-fixture:…` → :191/:216/:246/:262/:415 三条齐；D945 base `11458279` 上是 162 行旧版、零标注），且 D945 与 B3 **同改该夹具 + `ci.yml`** → 必冲突。等 CTO 栈式裁定（建议 PR base=`feat/b3-d922-fixture`，合并序 B3 → D945）。

   **附：base 上该夹具本就是红的（实测，非本队引入）** —— 支持"栈在 B3 之上"：
   - `bash tests/control-tower/install-dsh-preset.test.sh` → **`PASS=23 FAIL=2`，`rc=1`**（`git diff --stat HEAD -- <夹具> <安装器>` 为空 = 二者与 base 逐字节一致，非 A 或 B 改动所致）。
   - 失败项 **T3**（漂移检测边界）。根因：**注入是字节级 NO-OP**——T3 注入字面量为 `DeepSeek Harness 编码代理`（夹具 :89-90），而真实 persona 文案是 `DeepSeek Harness **执行**代理`（`docs/synova/coordination/dsh-preset-draft/persona-block.yml:5`）。全仓 grep `编码代理` = **0 命中**、`执行代理` = 2 命中。
   - 判别性证明（对真实源做副本，注入前后比对）：`e0abf35f99da23cb4cd6be3a6d569cf874d3a2ab9088a18db3d0eb55ce587b0a` → **同值** ⇒ 漂移从未被制造。
   - **含义**：base 上的 T3 **看似**覆盖"漂移必被检出"的边界，实际注入空转、边界**从未被真正执行过**（假信心缺陷，非单纯红）。B3 的 `T3 LOAD-BEARING: inject=**structural(块内)**` 正是对这一空转的修复——即 B3 不仅"加了标注"，而是把注入从易碎字面量换成结构锚。故本项亦属"栈在 B3 之上"的实质理由，非仅避冲突。

---

## 6. 红线声明

- 本件执行期间**未删除、未移动、未改写**任何 legacy 目录或文件；全部操作为 `find` / `shasum` / `stat` / `tar`（只读 + 归档）。
- `tar` 输出落 `/tmp`（**仓库外**），`git status --porcelain` 不因备份而变。
- 两处 home 的 `.agent-presets/` 现状与 §2 清单一致（采集后未再改动）。

---

## 7. 复现脚本（供独立复核）

```bash
# 清单 + 逐文件 sha256（§2）
cd ~ && for h in .dsh .dsh-trial-017; do
  for d in "$h"/.agent-presets/synova-*; do [ -d "$d" ] || continue
    for f in $(find "$d" -type f | sort); do
      printf "%s  %8s  %s\n" "$(shasum -a 256 "$f" | awk '{print $1}')" "$(wc -c < "$f" | tr -d ' ')" "${f#./}"
    done
  done
done

# 备份回执（§3）
shasum -a 256 /tmp/d945-legacy-presets-20260925-002954.tar.gz
tar -tzf /tmp/d945-legacy-presets-20260925-002954.tar.gz | head
tar -tzf /tmp/d945-legacy-presets-20260925-002954.tar.gz | wc -l   # → 30

# 备份可用性验证（§3.1）
EXT=$(mktemp -d) && cd "$EXT" && tar -xzf /tmp/d945-legacy-presets-20260925-002954.tar.gz
cd ~ && for e in $(tar -tzf /tmp/d945-legacy-presets-20260925-002954.tar.gz | grep -v '/$'); do
  a=$(shasum -a 256 "$HOME/$e" | awk '{print $1}'); b=$(shasum -a 256 "$EXT/$e" | awk '{print $1}')
  [ "$a" = "$b" ] && echo "OK   $e" || echo "DIFF $e"
done   # → 21×OK, 0×DIFF

# 两处 home 迁移状态（§4.2）
for h in ~/.dsh ~/.dsh-trial-017; do
  python3 -c "import json,io,sys;d=json.load(io.open(sys.argv[1],encoding='utf-8'));b=(d.get('dsh') or {}).get('profile',{}).get('bundles',[]);print(sys.argv[1],'bundles=',len(b),'@local=',len([x for x in b if str(x).startswith('@local/')]))" "$h"/profiles/desktop/package.json
done

# 仓库内 legacy 消费者（§4.3 B2）
grep -rn "\.agent-presets" --include="*.sh" . | grep -v node_modules
```
