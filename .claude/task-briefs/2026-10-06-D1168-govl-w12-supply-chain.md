# Task Brief: D1168 govl-w12-supply-chain

> 生成: 2026-10-06 | 任务: D1168 | 认领: 治理线(deepseek-flash)
> 参考: D333 决策四步（第一性原理→Anthropic→开源实证→收敛）
> 坐标系: 执行态=进行中 ｜ 施工批次=第0批-止血 ｜ 服务承重件=不适用 ｜ 总闸=不适用
>          命名空间=不适用 ｜ 验证级别=L2-真跑通 ｜ 阻塞源=无阻塞
> 派单源: CTO 2026-10-06《开发计划 v2》A 槽 **W12**（依赖安装脚本白名单 + 默认拒）
> 叠加: 本分支基于 `feat/govl-w-group`（#1165 G0 解冻件）⇒ **stacked PR**

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
治理/供应链面（`scripts/control-tower/` + `.github/workflows/`），非产品五层。
治的是「**安装期脚本 = 任意代码执行，且无白名单**」。
### b) 文件审计
- `package.json:12` `"postinstall": "patch-package"` —— 全文件唯一生命周期钩子（**铁律 40 冻结项**）
- 无 `.npmrc`；无 pnpm 配置（`pnpm-workspace.yaml` / `pnpm-lock.yaml` 均不存在）
- npm **无 per-package 白名单字段**（实测：只有全局 `ignore-scripts`）⇒ DSH 的 `onlyBuiltDependencies` 无原生等价物
- `package-lock.json` 的 `hasInstallScript=true` 共 **6** 条：`<ROOT>` / bcrypt / better-sqlite3 / electron / esbuild / fsevents
- 安装点：`ci.yml` **8** 处 + `desktop-build.yml` 3 处 + `product-progress.yml` 1 处
### c) 决策
自建等价语义：`npm ci --ignore-scripts`（默认拒）+ 仅白名单包 `npm rebuild --foreground-scripts`（显式放行）。
**不用 `.npmrc ignore-scripts=true`**：那会让**本地 `npm install` 也默认不跑脚本** ⇒ 开发者拿不到原生模块（DX/正确性风险），
而本线只能保证"受控路径默认拒"。代价与替代已写进 note。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 铁律 11（静默降级禁止）/ 铁律 24+31 / 铁律 47+48；判例 **V-08**（改坏即红 ⇒ 反例夹具）、**V-02**（真跑，不 grep 作验收）、**M-02**（三态）。
- **实测三连（不是推断）**：① 裸 `npm ci` ⇒ 832 包 / exit 0；② `npm ci --ignore-scripts` ⇒ 832 包 / exit 0 且
  `better-sqlite3/build/Release/better_sqlite3.node` **缺失**（默认拒生效）；
  ③ `npm rebuild better-sqlite3 --foreground-scripts` ⇒ 该产物**出现**（显式放行生效）。
- 决策参考：**第一性原理**（安装期脚本是攻击面，默认必须拒）+ **开源实证**（pnpm `onlyBuiltDependencies` 语义）
  ⇒ 结论 = 拒 + 白名单，而不是"全放"或"全禁"。

## Q2: 范围 — 正确的最简方案
做什么：
- scripts/control-tower/build-allowlist.txt — 新建（6 条 + 逐条理由 + 「新增一行的代价」）
- scripts/control-tower/install-deps.sh — 新建（默认拒 + 白名单放行 + 根 postinstall；三态 0/1/2）
- tests/control-tower/install-deps.test.sh — 新建（判别夹具，含反例「未列白名单的包零 rebuild」）
- .github/workflows/ci.yml — 8 处 `npm ci` → 安装器 + 登记夹具进两处密封清单
- .github/workflows/product-progress.yml — 1 处 `npm ci` → 安装器
- .github/workflows/desktop-build.yml — 2 处 `npm ci` → 安装器
- .claude/task-briefs/2026-10-06-D1168-govl-w12-supply-chain.md
- memory/notes/proposed/2026-10-06-d1168-w12-supply-chain.md
- task-state/D1168.json
不做什么：
- 不新增 .github/../.npmrc 根级配置（本地 DX 风险，见 Q0c；本卡刻意不加）
- 不改 docs/synova/product-lines/evidence/D1023-861-docsonly-guard.sh
- 不改 scripts/control-tower/check-pr-budget.sh（阈值归 #1017）
- 不改 scripts/pre-commit-check.sh（W6 归 D1167 / PR #1175）
- 不改 .github/workflows/desktop-build.yml 第 80 行的 `npm i --no-save node-gyp@12`（未锁安装点，另卡登记）
- 不碰 scripts/audit/check-audit-consistency.sh（K3 红线）

## Q3: 验收 — 入口 → 交互 → 结果
入口：CI 任一 job 的安装步骤（`.github/workflows/**` 调用安装器）
处理：`npm ci --ignore-scripts`（拒）→ 逐白名单包 `npm rebuild --foreground-scripts`（放行）→ 根 `patch-package`
结果：
- `bash tests/control-tower/install-deps.test.sh` ⇒ `RESULT: 14 PASS / 0 FAIL`
- 实测三连见 Q1（832 包 / 产物缺失 / 产物出现）
- `grep -rnE '^\s*(npm ci|run: npm ci)\s*$' .github/workflows/` ⇒ 0 命中（默认拒必须走安装器）

## 架构层:
scripts（控制塔/供应链面）+ `.github/workflows/`（非产品五层）

## Done 标准
- [ ] verify: `bash tests/control-tower/install-deps.test.sh` ⇒ 含 `RESULT: 14 PASS / 0 FAIL`
- [ ] verify: `bash -n scripts/control-tower/install-deps.sh` ⇒ exit 0
- [ ] verify: `bash scripts/control-tower/install-deps.sh --dry-plan` ⇒ 含 `INSTALL-DEPS: OK`
- [ ] verify: `bash scripts/control-tower/install-deps.sh --allowlist /tmp/nope.txt; echo $?` ⇒ 2
- [ ] verify: `grep -c install-deps.sh .github/workflows/ci.yml` ⇒ 9
