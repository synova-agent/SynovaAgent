# synova-cto 预设（仓库侧源片段 ＋ 运行态 bundle）

## 仓库里有什么

| 文件 | 作用 |
|---|---|
| `persona-block.yml` | persona 插件的 `config.prefix` 正文（**人格唯一可读源；改人格改这里**） |
| `preset.yml` | 元数据（`name` / `description`），安装器与选择器展示用 |

## 运行态 bundle 在仓库外

CTO 预设的**运行载体**是 DSH profile 的 bundle 层，bundle 源不随产品仓跟踪：

- Win：`D:\dsh-preset-bundles\synova-cto\cordis.patch.yml`
- Mac：profile `dependencies["@local/dsh-preset-synova-cto"]` 的 `file:` 目录（实测 `/Users/wane/src/dsh-preset-bundles/synova-cto`）
- 已装副本：`<DSH_HOME>/profiles/<profile>/node_modules/@local/dsh-preset-synova-cto/cordis.patch.yml`

**为什么不直接做成仓库 bundle**：该 bundle 含 legacy 分组行 `- id: delegation`，仓库门禁
`check-preset-bundles.sh --repo` 与安装器 `install-dsh-preset.sh` 都把该行判 legacy 并拒绝落位；
按 CTO 方案 v1.0 §10.11「不改安装器通用机制」，本次继续维护运行副本，不把安装器判据一并改掉。

## 改人格后的落位步骤（Win/Mac 通用）

1. 改本目录 `persona-block.yml` 的 `prefix` 块 ＋ `preset.yml` 的 `description`；
2. 把 `prefix` 正文（去掉块缩进）替换 bundle 里 `              prefix: |-` 起的整块（缩进 16 空格）；
   把 `description` 写入 bundle 的 `        description:` 行；**其余行（插件行/注释）逐字节不动**；
3. 校验：YAML 可解析（PyYAML/js-yaml）；插件行数与改前一致（改前 16 个顶层插件行）；
4. 覆盖 bundle 源与 profile 副本两处，二者须逐字节相同；
5. 完全退出并重启 DSH，新开 CTO 会话验证（旧会话不能作为新预设生效的证据）。

> 一键跨机同步包（含已生成的 bundle 与 `apply-on-mac.sh`，**未入仓、随批次随包传输**）：
> `deliverables/1323-preset-skill-revamp/`（#1323 实施端同步包，2026-11-04）。

## 硬约束

- persona 模板**只能用 `{{model}}`，不能用 `{{cwd}}`**：DSH 只注册 `provider`/`model` 两个变量，
  未注册的 `{{cwd}}` 会在 prompt 装配时抛 `unknown prompt variable`，预设起不来
  （DSH 自带 README：「Custom persona templates must not depend on a built-in `{{cwd}}` variable」）。
- 人格只放定位与指针，不复制 skill 正文（skill 是唯一事实源）。
- 安装：本目录**没有 `package.json`**，不属于 `install-dsh-preset.sh` 的仓库 bundle 源；按上面步骤落位。
