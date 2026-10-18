# squad-lead 无法建团队成员：tool-agent-team 与 profile bundle 重复挂载

状态: implemented
日期: 2026-10-19

## 一句话

`@deepseek-ai/dsh-experimental-agent-team-profile`（在 `dsh.profile.bundles` 里）已挂载
`tool-agent-team`，而 squad-lead 预设**又挂了一次** ⇒ 同一 scope 内 `team:policy` 二次注册 ⇒
`spawn_teammate` 4/4 失败：`Error: prompt section "team:policy" is already registered in this scope`。

## 证据

- `dsh-experimental-tool-agent-team/lib/index.js:239` —— `register(scoped.systemPrompt.section({ name: "team:policy", ... }))`
- `dsh-experimental-agent-team-profile/cordis.patch.yml:26-27` —— `- id: tool-agent-team`
- `~/.dsh-trial-017/profiles/desktop/package.json` —— `dsh.profile.bundles` 含 `@deepseek-ai/dsh-experimental-agent-team-profile`
- **CTO 预设（可正常开团）**：`agent-team`/`tool-agent-team` 挂载数 = **0**（全靠 profile）

## 决定

三处（bundles 源 / 产品仓 docs / user_root）**删除 `tool-agent-team` 块**。
服务与工具均由 profile 的 `dsh-experimental-agent-team-profile` bundle 提供。

## 连带发现

1. **同一预设有两个载体**：bundle `@local/dsh-preset-synova-squad-lead`（link → docs/…）＋
   user_root `~/.dsh-trial-017/.agent-presets/synova-squad-lead/`。两者都含该插件 ⇒ 加剧重复。
2. L2 会话改的是 **`~/.dsh/`（死目录）** —— `$DSH_HOME = ~/.dsh-trial-017`，
   所以"改完再 spawn 仍报同一句"是必然的。

## 生效时点

bundle 类改动 ⇒ **需重启 DSH**。
