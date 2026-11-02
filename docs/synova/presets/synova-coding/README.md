# synova-coding — 编码 session 预设

## 用途

给**普通编码 session**（不是小队队长、不是 CTO、不是审计）一个可加载的预设：开工即读两份 skill，任务全程按 DSH 工程纪律与代码品味执行。

- 行为纪律：`.dsh/skills/squad-discipline/SKILL.md`
- 代码标准：`.dsh/skills/dsh-code-standards/SKILL.md`

## 安装

```bash
bash scripts/control-tower/install-dsh-preset.sh --install synova-coding
```

安装后**重启 DSH**，在预设选择器里选 `🛠 Synova 编码执行`。

## 校验

```bash
bash scripts/control-tower/check-preset-bundles.sh --repo
bash scripts/control-tower/check-preset-bundles.sh --consistency synova-coding
```

## 边界

- 本预设**只做实现**，不判“通过”；通过归 L1 收件 + K3。
- 不复制 skill 正文；skill 是唯一事实源，本件只放指针。
- 不新增门禁；纪律靠 persona + skill 自持，门禁仍归 pre-commit / CI。
