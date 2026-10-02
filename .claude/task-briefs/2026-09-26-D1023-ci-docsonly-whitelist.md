# D1023 — CI docs-only 白名单补全（.gitignore 等配置文件）

#CRITERIA: C

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
治理/CI 层（非五层架构内）。改 .github/workflows/ci.yml 里 docs-only 早退的白名单正则。
### b) 文件审计
grep 该正则：ci.yml 里出现 10 处（10 个 job 各一处，复制粘贴）。
### c) 决策
统一替换 10 处；不新增 job、不删 job。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 实测证据：PR #860 变更含 .gitignore -> docs_only=false -> Windows 21:47 + ubuntu 2:43 约 24 分钟白烧
- 同批对照：同一 PR 若不含 .gitignore -> 应早退约 0 秒
- 参考：Anthropic 工程基线（早退条件应覆盖"不触发逻辑变更"的文件类型）

## Q2: 范围 — 正确的最简方案

做什么：
- .github/workflows/ci.yml — 10 处 docs-only 白名单正则统一加 .gitignore / .gitattributes / .gitmodules / LICENSE / .gitkeep
- docs/synova/product-lines/evidence/D1023-861-docsonly-guard.sh — P1 判别性夹具（改前红/改后绿）
- docs/synova/product-lines/evidence/D1023-861-夹具原始输出.md — 夹具原始输出证据
- docs/synova/product-lines/evidence/D1023-861-收尾与回执.md — 收尾三件与回执
- .claude/task-briefs/2026-09-26-D1023-ci-docsonly-whitelist.md — 本 brief
- .claude/bypass.log — post-commit hook 自动登记
- memory/notes/implemented/process/2026-09-27-ci-docsonly-whitelist.md — 决策 Note

不做什么：
- 不动 Control Tower Gate Tests 的 os matrix（涉及 D520 设计意图，须单独设计 + K3 意见）
- 不动任何 job/step 的判定语义（只放宽早退条件覆盖的文件类型）
- 不改 scripts/**、src/**

## Q3: 验收 — 入口 → 交互 → 结果
入口：git push 触发 CI
处理：Detect docs-only change (D515) 判定该 PR 是否纯文档
结果：含 .gitignore 的纯文档 PR -> docs_only=true -> 后续 steps 跳过

## 架构层: N/A（治理层）

## Done 标准
- [ ] ci.yml 里 10 处白名单都含 gitignore —— verify: grep -c gitignore .github/workflows/ci.yml 应 >=10
- [ ] 本 PR 自身仍触发全量（因它改了 ci.yml）—— 这是预期
- [ ] 后续任一纯文档 PR（含 .gitignore）-> Detect docs-only 输出 docs_only=true —— verify: 看该 PR 的 job log
