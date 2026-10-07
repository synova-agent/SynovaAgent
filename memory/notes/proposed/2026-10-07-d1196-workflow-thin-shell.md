# D1196 — workflow 薄壳化（project-coordinates startup failure 修复）

- 状态: proposed（2026-10-07，治理线）
- 来源: 自测发现——合并 #1212 后该项目 workflow 首跑 startup failure（run 37591189894: push 0 秒零 job）

## 决策
1. **逻辑全部移入 `scripts/control-tower/sync_project_coordinates.py`**：契约头块（铁律 47）、
   `--from-body` 离线注入缝、三态退出码（0 成功/无 token 跳过；2 自身失败）、缺字段 warning 点名。
2. **workflow 只做胶水**：checkout + 一条 `run: python3 scripts/...`；删除中文 output 键与内联 heredoc
   （判定为 GitHub 装载失败的成因面）。
3. **无 token 语义不变**：跳过且不红（卡 #991），notice 显式留痕；「无坐标系块」与「有块缺字段」
   两种情形分开报（测试暴露的顺序缺陷已修）。

## 上界
有 token 的挂板/写值路径**未实测**（token 未配）——配置后先建测试 Issue 实测一轮。

## 退出条件
若 GitHub 仍报装载失败 ⇒ 进一步最小化（去掉 concurrency 表达式，改静态 group）。
