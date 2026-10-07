# D1195 — CI 提速实测项：Windows 顾问腿 nightly + audit 退役（D-E ⑤③）

- 状态: proposed（2026-10-07，治理线）
- 来源: 父卡 #1221（v2.0 方案七，创始人批准）；实测 run 37589330830

## 决策
1. **windows 顾问腿改 nightly 专属**：实测该腿 796s/809s 墙钟（98%），是非必需腿却支配全 CI。
   新语义：schedule/dispatch ⇒ run=true；PR/main push ⇒ run=false（显式留痕，非静默）。
   代价：PR 期即时 Windows 信号丢失（最迟下周日夜曝光）；需即时信号 ⇒ workflow_dispatch。
2. **audit job 退役**：continue-on-error + 双层豁免 = 50 天零消费；复活条件 = 上云/公网化。
3. **D-B（Vitest 分片）前提过时**：复测 153s/135s 已均衡（原 7m/46s 记录为旧样本）⇒ 该卡
   应关闭或改为「均衡度回归护栏」（新增夹具断言两片差 < 2×）。预算转投实测瓶颈（本项）。

## 退出条件
若 nightly Windows 回归导致平台缺陷积压（连续两次 nightly 红）⇒ 恢复 PR 路径触发或
改「脚本/测试路径 PR 触发 + 其余 nightly」混合模式。
