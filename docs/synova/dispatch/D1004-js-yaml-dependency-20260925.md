# D1004 派单件 — `js-yaml` 未声明依赖收口（K3 D947 审计 🟡 Minor）

> 出件：Win-Codex-CTO ｜ 2026-09-25 ｜ 号段：Win 段 `D1000–D1099`
> 来源：**K3 D947 独立终审报告 §一.1 注 2**（新发现，先于 D947 存在、非回归）
> 域：`win` ｜ `owner_side`：`win`（写集全 win，无需跨域特批）

---

## 一、问题（K3 实测 + CTO 复算）

| 项 | 实测 |
|---|---|
| `package.json` 声明的 | 只有 **`@types/js-yaml`**（类型包） |
| 实际静态 import 的 | **`js-yaml`**（运行时包） |
| import 位置（**两处**，K3 只列了第一处） | `src/config/customer-config-package.ts:32`、**`src/playbook/playbook-loader.ts:17`** |
| 根 lockfile | `package-lock.json` |
| 现状为何没炸 | maker 侧**靠父仓 `node_modules` 解析**侥幸通过 |
| 何时会炸 | **任何全新 clone 的 CI 都会红**；D947 新夹具（`middleware-order` / `workspace-access-write-endpoint`）经 `createServer → routes/config.ts / routes/diagnosis.ts` **首次把该静态链拉进 vitest 收集面** |

**性质**：先于本卡存在（`git diff f25e61eb ef5c8caa -- src/config/customer-config-package.ts` 为空），**非 D947 回归**；但它是"新 clone 即红"的定时炸弹，且 K3 审计为它**在两侧工作树对称补装了 `js-yaml@4.1.0`** 才能跑完对照。

---

## 二、写集（3 件）

| 文件 | 动作 | 写者 |
|---|---|---|
| `package.json` | 改：`dependencies` 增 `"js-yaml": "4.1.0"`（保留 `@types/js-yaml`） | code-a |
| `package-lock.json` | 改：由 `npm install` 生成，**禁手改** | code-a |
| `task-state/D1004.json` | 卡片 | 队长 |

**不做**：不改任何 `src/**`（本卡**纯依赖声明**，零代码改动）；不碰 `scripts/**`、`scripts/audit/**`。

**版本取 `4.1.0` 的理由**：与 K3 审计期间两侧工作树**对称注入的版本逐字一致**，保证"审计环境 = 修复后环境"。

---

## 三、完成标准（可执行判据）

| # | 判据 | 反例（改坏即红） |
|---|---|---|
| J1 | `npm ls js-yaml` → 出现在 **dependencies**（**非** `extraneous` / 非 `missing`） | 从 `dependencies` 删掉该行 → 必红 |
| J2 | **不依赖父仓**的解析验证：在仓库根 `node -e "console.log(require.resolve('js-yaml'))"` 命中**本仓** `node_modules` | 同上 → `Cannot find module` |
| J3 | 两处 import 链都被覆盖：`src/config/customer-config-package.ts:32` 与 **`src/playbook/playbook-loader.ts:17`** | 只声明但漏跑 `playbook-loader` 链 → 该链仍红 |
| J4 | `@types/js-yaml` **保留**（删了会 tsc 红） | 删 `@types` → tsc 必红 |
| J5 | **零 `src/**` 改动**：`git diff --name-only <base>...HEAD -- src` → 空 | — |
| J6 | `npm ci`（干净安装）能过，且 `node_modules/js-yaml` 存在 | — |

**边界值枚举**（研究院《双 DSH 提升清单》P1 第 1 项）：**冷启动场景**必须实跑一次——把父仓 `node_modules` 排除在解析路径外（例如在一个只含本仓的临时目录 `npm ci` 后跑这两条 import 链），贴原始输出。只在"开发机已有 node_modules"下验证 = **空转**。

---

## 四、执行形态（硬字段）

- Agent Teams 组队；队长**不下场写码**；1 独立自验 + 1 独立复核（自验不得由编码兼任）
- 单域 win 单 PR；≤12 文件；重型验证串行 ≤1
- 工作目录钉死本卡 worktree；禁 `rm -rf`；临时产物只落 `/tmp`
- 回执含**团队成员运行记录**（成员名 · 运行状态 · token · 共享任务 id 与状态）

---

## 五、回执格式

1. J1–J6 逐条原始输出（含 J1/J2 的反例红态与还原）
2. **冷启动场景**原始输出（J2 的边界）
3. 团队成员运行记录
4. `git diff --stat` + `ls-remote`（基准写 `origin/main` 合后确切 SHA，**禁用本地 main**）
5. 未清项（诚实登记）
6. 派单件指纹对账（三条坐标 × 三方值）

---

## 六、红线与退回

- 禁 `--no-verify` / `git stash` / force push；不碰 `scripts/audit/**`
- 单 PR 单域：只许动 win 文件（含 `task-state/**` 豁免）
- **本卡不得夹带任何 `src/**` 改动**（J5 是硬判据）
- 执行方**不判通过**；终审归 K3

---

## 七、未清项预登记

| # | 项 | 处置 |
|---|---|---|
| 1 | 同类"只声明 `@types` 未声明运行时包"的依赖可能不止 `js-yaml` | 建议全仓扫一次（`package.json` 的 `@types/x` 与 `dependencies` 的 `x` 对账）——若发现同类，并入本卡或另立卡 |
| 2 | K3 审计期间为跑对照在两侧工作树**对称注入**了 `pnpm` 系列文件（`pnpm-workspace.yaml` / `pnpm-lock.yaml`） | 属审计环境改动，**不入本仓**；仅登记 |
