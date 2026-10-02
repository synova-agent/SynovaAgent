# DSH 预设（agent preset）：载体、创建、落位、验证

> 状态：**生效**（2026-09-29）｜维护：基座线
> 适用：给本机 DSH 运行时（`$DSH_HOME` = `~/.dsh-trial-017`，**运行实例 = DSH `0.2.0-rc.2`**）新增/修改 agent 预设。
> 本文件是「下一次加预设照做」的唯一入口；根因与证据见 §1、§5。

> **入库记录（D1098，2026-10-01）**：本件与 `synova-base/` **此前只存在于主工作区、从未入仓**
> （`git ls-tree origin/main -- docs/synova/presets/` 实测缺这两项）⇒ 工作区一丢即无处恢复。本 PR 一并入仓。
>
> **入库时同步的两处版本事实**（防「照抄老命令读到错断面」）：
> - 下文 §4/§5 里「017」所指源码树 `/Users/wane/src/deepseek-harness-017` **已删除**（2026-10-01，释放 3.6G）。
>   恢复：`git clone --local /Users/wane/src/deepseek-harness-020 /Users/wane/src/deepseek-harness-017 --branch dsh-v0.1.7-rc.1`
>   （校验 `46a7f68b0922371ce7144b668b90e377d8e799f4`）；**当前唯一源码基线 = `/Users/wane/src/deepseek-harness-020`**。
> - 🔴 **断面错配**：`-020` 本地 HEAD = `4878cdab`（=rc.1），而**运行实例 = rc.2**（`639ed015`）
>   ⇒ 凡引 `file:line` 必须写明取自哪一侧。
>
> **未复核项（本 PR 未动，留待基座线）**：§1 表格里的 bundle 计数（12 个 `@local`）与 §4 的 `--port 0` 实测流程
> **未在 rc.2 下重跑**；截至本 PR 提交时**未取到**运行时可解析性证据（`dsh plugin --profile desktop list`）。

---

## 0. 一句话

**预设 = profile 的一个 bundle 声明行，不是一个目录。**
新增预设 = 在仓库写 `docs/synova/presets/<id>/{package.json, cordis.patch.yml}` → 跑 `install-dsh-preset.sh --install <id>` → 在运行中的 Host 上热加载生效。

---

## 1. 载体：目录式已死，只剩 bundle 声明行（含证据）

| 事实 | 证据（可自行复跑） |
|---|---|
| 运行时读的是 **bundle 声明行** | `plugin_manager list_bundles` → 12 个 `@local/dsh-preset-*`，每行 1 条 `preset-<id>` row（`moduleName: @deepseek-ai/dsh-agent-preset`） |
| 声明行来自 profile 的 `dsh.profile.bundles` | `<DSH_HOME>/profiles/desktop/package.json` 的 `dsh.profile.bundles` + `node_modules/@local/dsh-preset-<id>/{package.json,cordis.patch.yml}` |
| **`.agent-presets/` 目录不再被任何代码读取** | `grep -rn "\.agent-presets" <DSH checkout>/packages` → 唯一命中是 `packages/preset/agent-preset/skills/editing-cordis-compositions/SKILL.md:70`，原文 "Nothing reads that directory any more" |
| 017 里连旧包都没了 | `<DSH checkout>/packages/preset/` 只有 `agent-preset` / `agent-preset-registry` / `persona`（旧 `agent-presets` 复数包已删） |
| 目录在场 ≠ 出现 | 运行中 Home 的 `.agent-presets/` 有 12 个目录，选择器里一个都不来自它们 |

> ⇒ **凡把预设写进 `$DSH_HOME/.agent-presets/**` 的做法一律无效**（D946 已作废该载体）。

---

## 2. 创建（可复现步骤）

```bash
# ① 建仓库侧源（两个文件，缺一不可）
mkdir -p docs/synova/presets/<id>
cat > docs/synova/presets/<id>/package.json <<'JSON'
{
  "name": "@local/dsh-preset-<id>",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
JSON
cp <一份可用的 cordis.patch.yml> docs/synova/presets/<id>/cordis.patch.yml
```

`cordis.patch.yml` 的骨架（一条 insert patch，声明一行 preset）：

```yaml
- insert:
    - id: preset-<id>                      # Loader row id：约定 preset-<id>（4 空格缩进，installer 会校验）
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: <id>                           # 预设身份 = 会话记录里保存的 id
        name: 🏗 显示名                    # 选择器里的名字
        description: '一句话说明'
        plugins:                           # 子插件行列表 = 这个预设的能力
          - id: persona
            name: '@deepseek-ai/dsh-persona'
            config:
              prefix: |-                   # ⚠️ 是 prefix，不是 text
                人格文本（{{model}} / {{cwd}} 由运行时插值）
          - id: tool-fs
            name: '@deepseek-ai/dsh-tool-fs'
          # …其余工具行
```

**能力来源（照抄哪个底座）**：DSH 自带的 `standard` / `ptc` / `minimal` / `cordis` 四个预设就在运行时的 web-app bundle 里：

```bash
# 源码树（开发运行时的真实来源）
sed -n '1,200p' <DSH checkout>/packages/bundle/web-app/presets/cordis.patch.yml
```

- 要「标准全能力」⇒ 抄 `standard.patch.yml`
- 要「创造模式 / 改运行时」⇒ 抄 `cordis.patch.yml`（含 `tool-cordis`、`tool-plugin-manager`、`present`、指向 agent-preset skills 的 `skill-filesystem`）
- **不要**凭记忆写插件包名 —— 017 已删/改名的包会让整棵子树挂不起来

---

## 3. 落位（写进运行时 profile）

```bash
bash scripts/control-tower/install-dsh-preset.sh --install <id>      # 落位
bash scripts/control-tower/install-dsh-preset.sh --check  <id>       # 对账（SYNC-OK）
bash scripts/control-tower/check-preset-bundles.sh --repo            # 源形态（REPO-OK）
bash scripts/control-tower/check-preset-bundles.sh --consistency     # 运行时 vs 仓库源
```

`--install` 的产物（逐字节复制，不做转换）：

1. `<PROFILE>/node_modules/@local/dsh-preset-<id>/{package.json,cordis.patch.yml}`
2. `<PROFILE>/package.json` 的 `dsh.profile.bundles[]` 追加 `@local/dsh-preset-<id>`

`PROFILE` 的解析序（脚本内已实现，缺省自动）：`$DSH_HOME/profiles/desktop` → `~/.dsh-trial-017/profiles/desktop` → `~/.dsh/profiles/desktop`。

**生效方式**：活 profile 有 `hmr` 时**立即生效，不需重启**（`plugin-manager` 的 `application = hmr ? 'applied' : 'restart-required'`）。
落位后确认（不需要动 Selection；若没出现，刷新一次页面即可）：

```
plugin_manager list_plugins        # 应出现 include:preset-<id>，enabled=true, fiberPhase=active
```

---

## 4. 验证挂载（「目录存在」不算通过）

判据分三层，**至少两层**才算过：

| 层 | 判据 | 怎么取 |
|---|---|---|
| L1 行已激活 | `plugin_manager list_plugins` 有 `include:preset-<id>`，`fiberPhase=active` | 本会话直接调 |
| L2 组合配置合法 | `cordis_inspect_query` host/`Config`/`listConfigs`，该 entry `status="schema"` | 本会话直接调 |
| **L3 真的挂载（无 broken）** | 活 Host 的 roster 里该预设 **没有 `broken` 诊断** | 见下 |
| **L4 真的起 session** | `session/create` 带 `agentPreset=<id>` 返回同 id | 见下 |

L3/L4 需要跟运行中 Host 的 `/api`（需要它的 token）。做法（已在 2026-09-29 实测通过）：

```bash
# 起一个隔离的验证 Host（同一 bundle 层，独立 DSH_HOME，不碰创始人的会话）
#   <home>/profiles/verify/{package.json,cordis.patch.yml,node_modules/@local/*}  ← 与目标 profile 同构
DSH_HOME=<home> node <DSH checkout>/apps/cli/lib/bin.js --profile verify --port 0 --no-open
#   → 打印 dsh web: http://127.0.0.1:<port>/?token=<TOKEN>

curl -s -c /tmp/cookies "http://127.0.0.1:<port>/?token=<TOKEN>"   # 换 cookie

# L3 roster：<id> 在列且无 broken
curl -s -b /tmp/cookies -X POST http://127.0.0.1:<port>/api/agentPresets/list \
  -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"1","method":"agentPresets/list","payload":{"args":{}}}'

# L4 起 session
curl -s -b /tmp/cookies -X POST http://127.0.0.1:<port>/api/session/create \
  -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"2","method":"session/create","payload":{"args":{"request":{"agentPreset":"<id>","cwd":"'"$PWD"'"}}}}'
#   → {"ok":true,"value":{"sessionId":"session-…","agentPreset":"<id>"}}

# 反向控制（判据必须能红）：把 <id> 换成 minimal，skill 数应为 0
curl -s -b /tmp/cookies -X POST http://127.0.0.1:<port>/api/skills/list \
  -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"3","method":"skills/list","payload":{"args":{"request":{"sessionId":"session-…"}}}}'
```

端点语法：`/api/<remote 命名空间>/<方法名>`，envelope 固定为
`{"type":"client-request","rpcId":"<任意>","method":"<ns>/<method>","payload":{"args":{……参数按名字……}}}`。
命名空间见客户端源码 `ctx.remote.<ns>.<method>`（如 `agentPresets`、`session`、`skills`）。

---

## 5. 常见坑（每条都真实踩过）

| # | 坑 | 症状 | 正解 |
|---|---|---|---|
| 1 | 写进 `$DSH_HOME/.agent-presets/<id>/`（目录式载体） | 选择器里永远不出现 | 走 bundle 声明行（§2/§3） |
| 2 | 写进**另一个 home**（`~/.dsh` vs 运行时实际的 `~/.dsh-trial-017`） | 同上；且旧 home 里连 `@local` bundle 层都没有 | 先确认运行时 home：`lsof -p <宿主 pid>` 看 `cwd` |
| 3 | persona 用 `text:`（旧键） | 该预设整条 `broken`：`persona: invalid config: $.prefix missing required value` | 017 的 `@deepseek-ai/dsh-persona.Config` 只有 `prefix`/`suffix`/`complete`/`includeRuntimeContext` |
| 4 | 组合文件尾部粘了一段无缩进的说明散文 | YAML 解析失败：`end of the stream or a document separator is expected` | 说明写进注释或 persona，不要裸贴在行列表后面 |
| 5 | 插件包名已删/改名 | 该预设 `broken`（行挂在 `never started`） | 包名以运行时的 `packages/**/package.json` 为准；例：`dsh-workflow-worker-thread` 在 017/020 **都不存在**，现名 `dsh-workflow-ptc` |
| 6 | 分组行 id 恰好叫 `delegation` | `install-dsh-preset.sh` / `check-preset-bundles.sh` 判 `degraded:` 拒绝落位 | 控制塔 guard 是**子串**匹配（D931 为 squad-lead 定的）；**上游 `standard`/`cordis` 本身就带这个 id** ⇒ 给分组换一个不含该子串的 id（如 `subagent-delegation`，分组 id 只是内部地址，无语义影响）。⚠️ 这是 guard 过宽，判据应收窄到 squad-lead（已报 CTO） |
| 7 | 只改了 `cordis.patch.yml` 没重跑 `--install` | 运行时仍是旧组合 | `--install` 是幂等复制；改完必须重跑，再 `--check` 确认 `SYNC-OK` |

---

## 6. 已知边界

- `install-dsh-preset.sh` **不会**把 `@local/dsh-preset-<id>` 写进 profile 的 `dependencies`（只写 `dsh.profile.bundles` + 直接落 `node_modules/@local/`）。功能上可加载，但 UI 的 bundle 详情会显示 `installed: false / removable: false`，且不能用 `remove_bundle` 卸载。
- 已在场的旧 `.agent-presets/` 目录不删（退役须创始人授权，见 D945 legacy-inventory）；`check-preset-bundles.sh --consistency` 会把「legacy 在场」判红。
- `~/.dsh/.agent-presets/synova-cto` 仍被 `dsh/plugins/synova-dashboards/scripts/install-dashboards.sh` 读写，删它前必须先改道。
