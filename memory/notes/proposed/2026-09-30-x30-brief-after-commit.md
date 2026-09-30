---
status: proposed
date: 2026-09-30
name: 先提交后补 brief
class: X30_BRIEF_AFTER_COMMIT
constraint: "提交前必须已有当日 brief 且 ## 写集 机器块含全部暂存文件路径；不得先提交后补"
expected: "S-4 回执件2「写集双向差」恒为 0"
severity: block
occurrences: 1
first_seen: 2026-09-30
description: 7 个文件先提交后补 brief，被 S-4 件2 双向差自查抓到（首次非零）→ 补 4 张 brief 闭合
---

# 产出先提交、brief 后补 → 认领制失效

- **现象**: D1071/D1074/D1076/D1077 的产出直接提交，未先建 brief；G12 因 .claude/ 与 docs/ 在 skip 列表而未拦
- **根因**: 把 brief 当过程仪式而非写集声明；docs/ 与 .claude/ 类路径恰好被门禁跳过，形成盲区
- **已做的补救**: 补 4 张 brief（含 D749 写集机器块）；把该缺陷写进 S-4 回执件2 留痕，不抹
- **固化（可机械化与否）**: 可机械化：G12 的 skip 列表对 docs/ 放行，可在 pre-commit 增加「新增 docs/ 文件必须有 brief 认领」的软检查
- **归属**: X30 工程线自我改善；如需机器执法，落点属控制塔域（另立卡）。
