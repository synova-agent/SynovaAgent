# AGENTS.md · scripts/control-tower/（门禁/控制塔脚本域）

> 归属：**治理线** ｜ 承载包：**K2/K3/K4/K5/K8/K9/K10/K12**（与根件 §0 表逐字一致）｜ as_of `38d77034b`（PR2/4）｜ probe-* 按卡号散布各块：冲突=块归属优先，骨架归治理线

## 是什么
控制塔探针与治理脚本域（锚下 111 文件，30 天 237 commits）。`probe-*.ts` 是各块可观测面：probe-sentinel→K3、probe-cycle-edges→K4、probe-compute-registry→K5、probe-tool-policy→K2、probe-diagnosis→K8、probe-skills→K9、probe-role-config/rbac/onboarding 系→K12、probe-content-registry/egress/packaging→K10。

## 谁改
- 脚本骨架/新增 probe＝治理线；某 probe 的**判据语义**＝对应块（改判据先引该块卡号）。
- 🔴 `scripts/audit/**` 是 K3 审计专属，任何人禁碰（含本目录会话）。

## 怎么算完成
- 每个 probe：三态退出码（0 通过｜1 真红｜**2 检查自身失败**，信号量==0 ⇒ exit 2）＋失败给具体失败点＋"改坏确实红"原始输出留档。
- 接进 CI 的条件：复现器 <1s 或条件跳过。

## 红线
判据不许"数表全绿"式空转（长青块分型：回归锁＋缺口面板）｜ 与根件零重复｜ 禁 `as any`。

## 🔗 改本域涉及的包（双向清单 · 2026-10-18）

P4（主）｜P7（写探针）｜P3👁｜P9👁

> 口径：与 `handbook 包/交叉矩阵-12守则×10包.md` 一致；`👁`=只读不改
