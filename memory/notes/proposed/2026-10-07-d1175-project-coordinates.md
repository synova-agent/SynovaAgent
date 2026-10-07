# D1175 — GitHub 坐标系自动化（#991）

- 状态: proposed（2026-10-07，治理线）
- 来源: 卡 #991（阻塞源 = 等创始人裁 PROJECT_TOKEN）
- 写面: 新增 workflow + 校验器 + 夹具（与全部在飞 PR 零文件重叠）

## 决策
1. workflow「未配 token ⇒ notice 跳过不红」（卡面明令）⇒ 未配 token 时零行为变化，
   token 配置后自动生效——把创始人决策点从「批方案」缩到「配 secret」。
2. 解析源 = issue 正文【坐标系】块（人写啥灌啥，缺字段 warning 点名不猜值）。
3. 校验器三态禁降级：gh 缺失/未登录/api 失败 ⇒ exit 2（工具坏 ≠ 全齐全）。
4. 预演先行：live 报告实测 **135 open 中 131 无坐标系块、4 缺字段** ⇒ 自动化只救增量，
   存量灌值需另卡（或 #948 的 sync-project-coordinates.sh 合入后批跑）。

## 已知上界
- workflow 的 GraphQL 灌值路径未实测（无 token）——token 配置后须先建测试 Issue 实测一轮再谈 enforce 进 CI。
- 板侧字段值回读对账（issue 正文 vs Project 字段双向）不在本卡。

## 退出条件
token 配置后实测若 GraphQL 变体不符（字段类型非 text）⇒ 按 Project 实际字段类型改 update 变体。
