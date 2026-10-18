# P1 · 能跑通（领域线）—— **包守则（纵向）**

> 🔴 本件随路径链自动注入（cwd 在本目录时）；**不是**域守则（域守则按"目录"切，见下「域守则指针」）

## 一、目的（一句话）

一条数据走完全程在**客户形态**下成立

## 二、内容

M1b 收口／M2 入口面／M3 领域链／M4 出口面／M9 验收件

## 三、完成判据

M6b probe：`growth==E(46)` ∧ `dev.total==bundle.total`（均 50）｜M4：界面真渲染「测量值＋趋势」

## 四、写集（**文件级；越界即停并上报 CTO**）

src/l4/**｜src/sentinel/**｜src/routes/{chat,conversations,diagnosis}.ts｜src/agent/conversation-engine.ts｜src/cycles/**｜src/store/migrations/**｜expert/**｜extensions/sentinels/**

## 五、依赖

M1（已合 44a30a572）｜M2/M3/M4 依赖 M1b（已合 3ab277c44）

## 六、不做什么

不碰 package.json/tsconfig（M1 域）｜不改 46 哨兵源码｜不碰 scripts/audit/**

## 七、🔴 域守则指针（**必须显式 read**，DSH 无法额外注入）

见本包 handbook `包/P1-能跑通/README.md` §「域守则必读」；全表 `包/交叉矩阵-12守则×10包.md`。

## 八、过程件（不写判据，防双真源）

在飞/回执/状态 → handbook `包/P1-能跑通/README.md`｜入口 → `CTO冷启动入口.md`

## 九、回执三信号

① 判据通过率（绿/红）② 例外清单 ③ 在飞数 —— **不写全文**
