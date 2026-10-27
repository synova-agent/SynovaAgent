# AGENTS.md · scripts/（控制塔与工作流脚本域）

> 归属：治理线（CTO）｜ as_of `6c85b1925`

## 是什么
控制塔三类：`control-tower/check-*`（门禁/校验）、`control-tower/probe-*`（探针）、`workflow/*`（流程）；以及 `doc-system/*`（文档登记）。门禁是最高风险面——改错＝全线误拦或漏拦。

## 谁改
治理线（CTO）。**门禁脚本变更须独立送审**；改判据（三态/退出码/阈值/作用域）属 **A 类**，须 CTO 批「提案」（一次）＋实现 PR 四条件自合＋K3 抽验。

## 怎么算完成（机器可判）
- 配对自测：`bash tests/control-tower/<同名>.test.sh` → 0 failed
- 三态退出码：**0 通过／1 真红／2 判不了**；**禁把 2 当 0**（fail-closed）
- 降级日志：`SYNO_GATE_DEGRADED_LOG` 恰 1 行 JSON（`time/component/code/phase/retryable`）
- **判别力**：改坏必红（仓外副本验证，还原后树干净）
- UTF-8 强制；跨平台路径用仓内既有 helper，不自造

## 红线
- 不改 `scripts/audit/**`（审计红线）；不自我审计
- 受保护路径变更须 `gate-exemptions/**` 豁免（含**自覆盖行**）
- 不 `--no-verify`；不改阈值而不走 A 类
- 新增门禁必须 fail-closed（缺参/缺数据 ⇒ exit 2，不是 0）

## 改本域涉及的包
P4（门禁）；跨线影响登记见 #1054（验收矩阵）、#998（D331 账本）。
