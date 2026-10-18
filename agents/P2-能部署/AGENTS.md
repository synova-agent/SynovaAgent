# P2 · 能部署（平台线）—— **包守则（纵向）**

> 🔴 本件随路径链自动注入（cwd 在本目录时）；**不是**域守则（域守则按"目录"切，见下「域守则指针」）

## 一、目的（一句话）

内容面在 **bundle／桌面／容器** 形态都可装载

## 二、内容

C4 两段式／M5 接口层／构建·打包·容器／M1 维护（DSH 升级回归）／N1

## 三、完成判据

`growth==46` ∧ `dev.total==bundle.total`（均 50）｜反例：移走一个哨兵目录 ⇒ −1（**重启形态**）

## 四、写集（**文件级；越界即停并上报 CTO**）

scripts/desktop/{build-content.mjs,build-backend.sh}｜src/sentinel/{sentinel-loader,builtins}.ts｜build-synova.cjs｜Dockerfile｜tests/desktop/**

## 五、依赖

M1b（已合）｜U1 数据卫生（customer-config 只发模板骨架）

## 六、不做什么

🔴 不宣"运行期可卸"（U2）｜不宣"容器已修"（U4 无 docker）｜判据不用字节/sha

## 七、🔴 域守则指针（**必须显式 read**，DSH 无法额外注入）

见本包 handbook `包/P2-能部署/README.md` §「域守则必读」；全表 `包/交叉矩阵-12守则×10包.md`。

## 八、过程件（不写判据，防双真源）

在飞/回执/状态 → handbook `包/P2-能部署/README.md`｜入口 → `CTO冷启动入口.md`

## 九、回执三信号

① 判据通过率（绿/红）② 例外清单 ③ 在飞数 —— **不写全文**
