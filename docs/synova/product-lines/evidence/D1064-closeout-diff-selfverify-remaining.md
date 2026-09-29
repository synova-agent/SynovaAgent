# D1064 收尾三件（diff / 自验结论 / 遗留清单）

> 分支 fix/D1064-softfail-ledger-ci-parity（栈式，base = origin/fix/ct-flow-brief-ledger-20260927 = d718820f = PR #868 头）
> HEAD = d663ee22（= ls-remote 回执，2026-09-29）

## 一、diff（5 文件，169+/3-，全在派单写集内）

```
 .claude/bypass.log                                |  3 +
 .claude/task-briefs/2026-09-29-D1064-softfail-ledger-CI-parity.md | 80 +++++++++++
 scripts/hooks/post-commit.sh                      | 13 +++-
 task-state/D1064.json                             | 31 ++++++
 tests/control-tower/post-commit.test.sh           | 45 ++++++++++
```

提交序列（d718820f..HEAD）：
```
b0bbc76e fix(D1064): _mtime_sec GNU stat -c %Y 权威回退链 + 纯数字校验
8b5b0f7e test(D1064): CT-2b CI 等价夹具——GNU stat 方言注入 PATH
9195d2d3 chore(D1064): brief 认领字段 + task-state 登记（收尾）
d663ee22 chore: bypass COMMITTED 登记 (auto hook, D521)
```

根因：GNU coreutils stat 下 `stat -f %m FILE` 把 `%m` 当文件操作数（exit 1 + stdout 输出文件系统信息）→ `v` 捕获垃圾 → 回退链不触发 → `$((mm - lm))` 算术爆炸 → `|| return 0` → 账本记纯 PASS。修复 = 回退链反转（GNU `stat -c %Y` 权威 → BSD `-f %m` 兜底）+ 纯数字校验；判据文本 `DEGRADED-PASS (soft-fail allowed ts=… exit=…)` 零增删（diff grep 零匹配）。

## 二、自验结论（独立自验员，与编码非同一人）：**可提请独立审计**

1. HEAD=远端=d663ee22；diff 5 文件无越界（禁碰清单零触碰）✅
2. 判据文本冻结 ✅（diff 中 DEGRADED-PASS 零匹配）
3. 本机 `bash tests/control-tower/post-commit.test.sh` → `结果: 17 通过, 0 失败` ✅
4. 改前必红（自验员独立构造 GNU shim，git archive d718820f 沙箱）：`❌ 账本未记真实状态` / `❌ 软失败被记成纯 PASS`，stderr 实锤 `line 63: …Inode: …: syntax error in expression` → 等价 CI 的 13 通过 2 失败 ✅
5. 改坏即红（/tmp 副本注释 `_SOFT_STATE` 调用）：`结果: 13 通过, 4 失败`（CT-2+CT-2b 全红），仓库零残留 ✅
6. `GATE-INTEGRITY: OK` ✅
7. 邻居回归（串行）：post-commit-marker 18/0、bypass-ledger 22 项全过 ✅
8. diff 审读：BSD 腿回退正确（本机 17/0 即行为证明）、纯数字校验无误拒、夹具 hermetic ✅
9. `grep -c INJECTED` 全 0；工作树干净 ✅

## 三、遗留清单

1. CT-2b 夹具 `-c %Y` 委托硬编码 `/usr/bin/stat`（BSD 宿主假设）：若未来套件跑在 GNU/Linux 宿主可能误红。建议后续卡在夹具注释显式声明或按 uname 分派。非阻断。
2. `check-gate-integrity.sh` 报存量棘轮 STALE(bsd) pre-commit-check.sh:991（expires 2026-10-08，不阻断，禁碰清单内）。
3. 沙箱内 `_bypass_append` 委托 bypass-ledger.sh 恒走降级路径（改前既有，stderr 噪音源，非本卡面）。
4. 编码报告的「写集互斥险情」（开工时工作树有未提交并发改动）：队长核查 = 现工作树干净、提交序列自洽、diff 与派单写集一致，判定无残留写者；疑似首轮失联派单的残迹，未进入提交。

## 四、PR 正文素材（供 CTO session 开 PR）

标题：`fix(D1064): softfail 账本 CI-parity——_mtime_sec GNU stat 回退链修复（栈式 PR, base=fix/ct-flow-brief-ledger-20260927）`
正文五条原始输出见上「一/二」节；合并方式 merge（不 squash）；K3 复审通过前不得合并。
