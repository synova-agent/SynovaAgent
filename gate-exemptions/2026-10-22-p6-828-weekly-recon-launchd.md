# 豁免 · #828 周对账 launchd 定时接线（安装器 ＋ 配对测试 ＋ 报备/登记）

> 受保护路径变更的唯一豁免通道（格式见 `gate-exemptions/README.md`）。裁定依据：**Issue #828**
> （P6 周对账定时接线批；唯一契约 `.handbook/派单件/2026-10-22-规格-828-周对账定时接线.md` §4，
> 判据 1/2/3/4/5/6）。逐行三段式（`- <路径> — <理由> — #828`），不整文件生效；理由内不含破折号。
> 本件覆盖本卡 diff 命中的**全部**受保护路径（scripts/control-tower/**、tests/control-tower/**、
> docs/authority/DOCS-REGISTRY.yaml、gate-exemptions/**），含本文件自身的自覆盖行。

- scripts/control-tower/weekly-recon-launchd.sh — 新建：launchd 安装器（install/verify/uninstall 三态；幂等 cmp 判定＋plist 必需键值校验＋日志新鲜度判别；测试不触系统 launchd） — #828
- tests/control-tower/weekly-recon-launchd.test.sh — 新建：配对判据测试 T1~T9（HOME 重定向＋PATH 注入假 launchctl；反例 a/b/c 与 launchctl 不可用/非 Darwin 两种 exit 2） — #828
- tests/control-tower/AGENTS.md — 修改：加 1 行报备（新测试文件＋WIRE 口径），域件「新增 probe 须在测试域报备」要求 — #828
- docs/authority/DOCS-REGISTRY.yaml — 修改：登记本豁免件（DOC-0240），D782 登记门禁要求新文档入台账 — #828
- gate-exemptions/2026-10-22-p6-828-weekly-recon-launchd.md — 本豁免文件自身（受保护目录自我保护，需自覆盖） — #828
