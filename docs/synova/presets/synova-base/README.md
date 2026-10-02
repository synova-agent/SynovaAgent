# synova-base — 🏗 Synova 基座线（agent preset）

> 状态：**已落位并验证**（2026-09-29）｜派单：Mac-CTO｜执行：创造模式预设
> 载体：DSH bundle 声明行（**不是** `~/.dsh/.agent-presets/` 目录 —— 该载体已被上游作废）

---

## 1. 身份

| 项 | 值 |
|---|---|
| `id` | `synova-base` |
| 显示名 | 🏗 Synova 基座线 |
| 定位 | **基座线** —— 维护基座（内核/契约/注册/故障隔离/账本）+ **插件契约**；**不写产品业务代码** |
| 常驻运行时 | `~/.dsh-trial-017/profiles/desktop`（DSH `0.1.7-rc.1`） |
| 底座 | DSH 自带 `preset-cordis`（创造模式）的插件行，逐行照搬，只换 persona |

### persona 要点（四条 + 引用四条 + 三条红线）

- **① 契约**：五类插件契约（哨兵/compute/专家/业务线/治理）+ 建档 → `docs/synova/coordination/PLUGIN-CONTRACT-*.md`
- **② 源码核**：条款必须回 DSH 源码核过（基准 `0.2.0-rc.1` = `/Users/wane/src/deepseek-harness-020` @ `4878cdabd8`；`-017` 只作对照）—— **不许引研究转述当源码事实**
- **③ 符合性检查器**：每条条款要有机器判据，且**必须「改坏即红」**（否则就是下一份 wiring-audit）
- **④ 故障隔离**：参照 DSH fiber 的 `epoch`（依赖指纹）—— `inject` 是持续契约、失败只落本地 `_error` ⇒ **坏插件不拖垮基座**
- **引用四条**：数字查未核实登记册 ｜ `file:line` 查取码登记 ｜ 取舍查权威索引 ｜ **判据要穿生产入口的用例，不是 grep 命中**
- **红线**：不引 `@deepseek-ai` 代码依赖（G1）｜**契约未过六条冻结门禁不得标「冻结」**｜契约变更走 migration + 双签

### 能力行（`config.plugins`）

标准全能力 + 创造模式工具：`persona` / `agent-instructions` / `tool-bash` / `tool-pwsh` / `tool-fs(-search)` / `tool-jobs` / `command-goal` / `tool-goal` / `planning`(plan-mode) / `compaction`(basic+compact+pruner) / `subagent-delegation`(subagent+fork+workflow-ptc+ralph) / `tool-ask-user` / `tool-todo` / `tool-web` / **`tool-cordis`** / `skill-filesystem`(creator 技能目录) / `tool-skill` / **`present`** / **`tool-plugin-manager`**。

> `subagent-delegation` = 上游 `delegation` 分组的改名 —— 见 `docs/synova/presets/README.md` §5 坑 6（控制塔 guard 子串误伤）。分组 id 只是内部地址，无语义影响。

---

## 2. 为什么 CTO 原先那份没生效（根因，四条独立缺陷）

原物：`~/.dsh/.agent-presets/synova-base/{preset.yml, agent.cordis.yml}`（16627 字节）。**四条都足以单独致哑**：

| # | 缺陷 | 证据 |
|---|---|---|
| 1 | **载体错**：写成了 legacy 目录式预设 | 运行时读的是 bundle 声明行。`grep -rn "\.agent-presets" <017 checkout>/packages` 唯一命中是 `packages/preset/agent-preset/skills/editing-cordis-compositions/SKILL.md:70`：*"Nothing reads that directory any more."* |
| 2 | **home 错**：写进了 `~/.dsh`，运行时用的是 `~/.dsh-trial-017` | `lsof -p <GUI 宿主 pid>` → `cwd = /Users/wane/.dsh-trial-017/profiles/desktop`。该 home 的 `.agent-presets/` 里根本没有 `synova-base`（有 `synova-devdoc` 而没有 `synova-base`，两处 home 内容不同即为佐证） |
| 3 | **persona 键名错**：用 `text:`，017 的 schema 只认 `prefix` | `packages/preset/persona/src/index.ts`：`Config = z.object({ prefix: z.string().required(), … })`。活 roster 里 `liangshen` 现存同款故障，原文：`persona (@deepseek-ai/dsh-persona): invalid config: $.prefix missing required value` |
| 4 | **组合文件不是合法 YAML** + 含已删包名 | 尾部 277–292 行是**无缩进的裸散文**（文档契约段落）⇒ js-yaml：`end of the stream or a document separator is expected (277:1)`；且用了 `@deepseek-ai/dsh-workflow-worker-thread` —— 该包在 **017 与 020 的源码树里都不存在**（现名 `@deepseek-ai/dsh-workflow-ptc`） |

⇒ 处置：**以本 bundle 为准覆盖**（CTO 已授权「若我那份结构不合 ⇒ 以你的为准，可覆盖」）。原目录**未删**（退役须创始人授权，D945 口径）。

---

## 3. 落位与验证（照做即可）

```bash
# 落位（幂等；写入运行中 profile）
bash scripts/control-tower/install-dsh-preset.sh --install synova-base
bash scripts/control-tower/install-dsh-preset.sh --check  synova-base   # 期望 SYNC-OK
bash scripts/control-tower/check-preset-bundles.sh --repo               # 期望 REPO-OK

# 生效确认（活 profile 有 hmr ⇒ 立即生效，无需重启 App）
#   plugin_manager list_plugins → include:preset-synova-base, enabled=true, fiberPhase=active

# 挂载 + 起 session 验证（隔离 Host，步骤见 docs/synova/presets/README.md §4）
```

### 2026-09-29 实测记录

- `check-preset-bundles.sh --repo` → `REPO-OK: synova-base package.json + ./cordis.patch.yml 形态合规`（rc=0）
- `install-dsh-preset.sh --install synova-base` → `INSTALLED: synova-base → …/node_modules/@local/dsh-preset-synova-base（bundle 声明 新增）`
- `install-dsh-preset.sh --check synova-base` → `SYNC-OK`
**在运行中的 GUI Host 上（未重启 App）：**

- `plugin_manager list_plugins` → `include:preset-synova-base` `enabled=true, fiberPhase=active`
- `cordis_inspect_query` host/`Config`/`listConfigs` → 该 entry `status="schema"`

**在隔离验证 Host 上（同一 bundle 层、独立 DSH_HOME，不碰创始人会话）：**

- roster：`synova-base | 🏗 Synova 基座线 | clean`（无 `broken`）
- 起 session：`session/create {agentPreset:"synova-base"}` → `{sessionId:"session-…", agentPreset:"synova-base"}`
- **反向控制**：同法起 `minimal` session → 技能数 **0**；`synova-base` session → 技能数 **18**（含 `cordis-plugin-development` / `editing-cordis-compositions` / `cordis-composition-reference`，由本预设 `skill-filesystem.customSkillDirs` 行提供）⇒ 判据有判别性，不是恒真

> 选择器出现在 GUI 里：客户端在会话/页面加载时拉一次 roster ⇒ **刷新一次页面**即可看到「🏗 Synova 基座线」。

---

## 4. 维护注意

- 改 `cordis.patch.yml` 后**必须重跑 `--install`**（否则运行时仍是旧组合），再 `--check` 确认 `SYNC-OK`。
- persona 文本里的 `{{model}}` / `{{cwd}}` 是运行时插值变量，**严格模式**：任何未注册的 `{{…}}` 会让该行报错。
- 红线：不引 `@deepseek-ai` 代码依赖（G1）—— 本预设只**声明挂载**官方插件行，不含任何 `import`。
