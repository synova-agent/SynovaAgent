# D1174 — ontology 边类型关键字段回归防线（#1015 G-1）

- 状态: proposed（2026-10-07，治理线）
- 来源: 卡 #1015 G-1（#987/#988 交付 110 个字段值无防线，可被静默改坏）
- 写面: 新增 `scripts/control-tower/check-ontology-fields.sh` + 夹具

## 决策
- 必查字段集（冻结）: `action_effect_lag`, `transfer_function`。判据 = 每件 edge-type
  JSON 两字段**存在且值非空串**。值内容（"unknown"/"TBD"）是数据质量，归产品线，不在本防线。
- 三态: 0 过 / 1 违规（缺字段、空串、JSON 坏、顶层非对象）/ 2 检查自身失败（目录不存在、零 json、python 不可用）。
- 注入缝 SYNO_EDGE_TYPES_DIR（沙箱隔离，生产不设 = 行为不变）。

## 待办（跟进小卡，非本卡范围）
CI 接线延后：`ci.yml` 两处密封清单 + control-tower job 注册本脚本与夹具——现被 #1198（在飞，同文件写集）阻塞，
#1198 合入后一步 sed 完成。接线前本防线为「手动可跑、CI 不跑」的过渡态（如实留档，不虚称已接线）。

## 退出条件
若产品线后续把两字段移位/改名 ⇒ 同步改冻结集（判据变更 ⇒ K3→CTO）。
