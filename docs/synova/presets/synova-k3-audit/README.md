# synova-k3-audit 预设（入仓）

- 来源：本机 `~/.dsh/.agent-presets/synova-k3-audit/`（2026-09-24 入仓，**解 G3 缺口另一半**：原仅 squad-lead 与 dsh 入仓）
- 文件：`preset.yml`（元数据）、`persona-block.yml`（persona 源，key 与安装脚本替换口径一致）
- persona 已加**审计线红线段**：独立仓、maker 无写权、只出结论不写产品代码、报告须含 file:line + 复现命令 + 原始输出、**有条件通过=未通过**
- 用途：Win 侧"K3 在独立仓审计"的预设前提（Win 侧落位命令同 `install-dsh-preset.sh`）

> 🔒 **文档契约 v1.0**：`docs/synova/DOC-CONTRACT.md` —— 审计产物落点见 §10/§11；**CTO 不得豁免本契约**（§8）。审计范围含"被审对象是否符合契约"。
