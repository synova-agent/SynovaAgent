# Task Brief: #344 → 控制塔CI语义 — 依赖安装步改 lock 哈希指纹（让依赖变更在 CI 真生效）

> 立卡依据：创始人 2026-10-11 「第 1 步 · CI 安装步（锁死所有依赖卡，最高优先）」，机制 = **裁定①**（原作者逐字给）
> 前情：本线第 4 轮上报的结构缺陷 —— `.gitea/workflows/local-gates.yml:30` 的安装判据与 lock 无关
> 性质：🔴 **跨卡阻塞**（不修则**所有依赖卡的 CI 都不可信**）
> issue：#344 ｜ 分支：`fix/344-ci-deps-fingerprint` ｜ 机器真源：`.claude/claims/344.yaml`

#CRITERIA: D

## 〇、为什么要做这个（通俗版 · 先读这一节）

① **一句话**：CI 判断"要不要装依赖"时**从不看依赖清单变没变** —— 只看"以前装过没有"。
   于是**改了依赖，CI 仍用旧依赖跑**。

② **解决什么问题（实测）**：
   ```
   CI 工作区 node_modules/react = 19.3.0（mtime Oct 10 16:48）
   #337 的 lock 已是 18.3.1
   CI 日志打印「依赖已存在」 ⇒ 该 PR 的 CI 从未跑过 npm ci
   ⇒ #338 的 CI 红是"旧树"所致，不是分支内容所致
   ```
   四个 PR（#338/#335/#340/#341）**全部**命中 ⇒ 依赖类 PR 的 CI 信号**恒为噪声**。

③ **做完对项目的推动**：**依赖变更（含安全修复）重新变得能在 CI 被验证**。
   这是"准度可测量"（宪章 §0.5 第三条）在**工程设施**上的同一条病。不修，任何依赖修复都只能靠人肉复跑。

④ 🔴 **不做行不行：不行。** 而且**越晚修代价越大**：每多一张依赖卡，就多一次"CI 说没事/有事都不可信"。

⑤ **现在有什么基础**：
   - ✅ 该 step 是**唯一**的依赖安装点（`.gitea/workflows/local-gates.yml`，3 步里的第 2 步）
   - ✅ CI 工作区路径硬编码、单一（`/Users/wane/.ci-work/SynovaAgent`）
   - ❌ 无任何缓存失效键；❌ 无"lock 变过"的记录载体

⑥ **还需要做什么**：见 Q2。

⑦ **DSH 借鉴方式：参考自研。**
   - **参考**：`package-lock.json` 作**内容寻址**的缓存键（生态通行做法，DSH 也以 lock/hash 定位依赖态）。
   - ❌ **不借**：DSH 是"一次装好、长期复用"的本地开发形态，**没有"CI 工作区是常驻克隆、要判要不要重装"这个问题**
     ⇒ **无对应物，诚实标注为自研**。

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
**不属宪章 ⓪–⑤/⑥/−1 任何架构块** —— 它是「−1 运行时」的**工程设施面**（CI 语义），
载体 = `.gitea/workflows/local-gates.yml`。

### b) 文件审计（as_of `local-main = 68bf57598`）

| 件 | 现状 | 处置 |
|---|---|---|
| `.gitea/workflows/local-gates.yml:27-30` | 安装步 = `if [ -d "$WS/node_modules/vitest" ]` | **改**（lock 哈希指纹） |
| `scripts/control-tower/ci-deps-step-sim.sh` | **不存在** | **新增**（复跑器：把该 step 正文抽出、沙箱 4 场景） |
| `scripts/control-tower/install-deps.sh` | 存在（`npm ci --ignore-scripts` ＋ 白名单） | **不动**（只被 `.github/**` 用；属安装**策略**，另裁） |
| `tests/control-tower/install-deps.test.sh` | 存在（"不得再有裸 npm ci"） | **不动**；已核它**不查 `.gitea/`**（零命中）⇒ 无撞车 |

### c) 决策
**改**（同一 step，改判据不改命令）＋ **新增**复跑器。不新建任何 workflow、不引入新依赖。

## Q1: 调研 — 业界最佳实践 / 依据 / memory 历史教训

### a) 业界最佳实践
CI 缓存的标准做法 = **内容寻址的缓存键**（锁文件哈希）。只有键变了才重装。"装过没有"从来不是缓存判据。

### b) 顶级团队怎么做
`actions/setup-node` 的 `cache-dependency-path` 即**显式指向 lock 文件**并由其哈希决定缓存命中 —— 判据载体就是 lock 内容。

### c) memory/ 里我们犯过的错（**点名**）
- **本线第 4 轮上报**：「CI 的『✅』在这两条修完之前一律不算证据」——创始人已采纳入纪律。
- **D782 D1**（文档真相防线）：同类病 —— **判据与真源脱钩**。
- **V3.9 教训**：硬阻断 100% 有效、软机制 0% 有效 ⇒ 本卡把"该不该重装"做成**可复跑判据**（4 场景），
  而不是在注释里写一句"请注意 lock 变更"。
- **本卡自身踩的坑（三处假反例）**：见 harness 头注释 ①②③ —— 全部属"判据与观测面脱钩"。

## Q2: 范围 — 正确的最简方案

**做什么**：
1. `.gitea/workflows/local-gates.yml` 的安装步：`package-lock.json` 哈希写入 `$WS/.deps-lock-hash`；
   与上次不同（或文件缺失、或哈希算不出）⇒ `npm ci`；相同 ⇒ 跳过
2. 新增 `scripts/control-tower/ci-deps-step-sim.sh` 复跑器（4 场景，含**改坏即红**）

**不做什么（裸路径、独立成行 —— 门禁 D1231/#1308 口径，反引号包裹会恒不中）**：
- 不改 scripts/control-tower/install-deps.sh
- 不改 tests/control-tower/install-deps.test.sh
- 不改 .github/workflows/ci.yml
- 不改 .github/workflows/desktop-build.yml
- 不改 .github/workflows/product-progress.yml
- 不改 scripts/pre-commit-check.sh
- 不改 package.json
- 不改 package-lock.json
- 不删 /Users/wane/.ci-work/SynovaAgent/node_modules

理由（**独立成行，不粘在路径后** —— 门禁口径要求"裸路径、独立成行"，粘说明会触发 `Q2-PARSE-WARN`）：
`install-deps.sh` 是**安装策略**变更（脚本硬化），另裁；`/Users/wane/.ci-work/...` 是创始人明令**不许删**
（删了会让 CI 假绿，把结构缺陷抹掉一次）。
⚠️ 另有一条**不是文件**的排除，故不列入上表：**本卡不动 `.gitea/workflows/local-gates.yml` 的增量测试步**
（CI 空绿属创始人分步计划的**第 2 步**）。

## Q3: 验收 — 入口 → 交互 → 结果

**入口**：CI 运行（`push` / `pull_request`）触发 `local-gates` job 的「依赖」步。
**交互**：读 `$WS/package-lock.json` 哈希 → 与 `$WS/.deps-lock-hash` 比 → 相同则跳过、否则 `npm ci` 并回写指纹。
**结果**：日志出现 `⇒ lock 已变更 ⇒ 重装` ＋ `已重装并更新指纹`（或 `⇒ lock 未变…跳过 npm ci`）。

| # | 判据 | 期望 |
|---|---|---|
| V1 | `SYNO_DEPS_WS=/tmp/ci-deps-sim bash scripts/control-tower/ci-deps-step-sim.sh` | **rc=0** ＋ `CI-DEPS-STEP-SIM: OK（4 场景全 PASS）` |
| V2 | **改坏即红②**：把该 step 正文换回修复前的旧逻辑（步名保留）⇒ 复跑器 | **rc=1** ＋ `VIOLATION failures=3`，甲/乙/丙 逐条点名 |
| V3 | 沙箱 `YAML` 解析：`python3 -c "import yaml…"` 能解析该 workflow | 无异常 |
| V4 | 复跑器**不碰真 CI 工作区** | `git status` 不因它变化；`/Users/wane/.ci-work/**` 未被写 |

🔴 **反例必红本身也要被验**（纪律④）：V2 必须给"改坏后确实红"的原始输出 ＋ **具体失败点**。
若 V2 首跑就 PASS ⇒ 判为"永远绿的假反例"，**退回重做**。

## 架构层
**不适用（工程设施面，不属宪章 ⓪–⑤/⑥/−1 任一块）**。

## 写集（精确路径，逐条；不用 glob）

| 文件 | 类型 |
|---|---|
| .claude/claims/344.yaml | task |
| .claude/task-briefs/2026-10-11-344-ci-deps-fingerprint.md | task |
| .gitea/workflows/local-gates.yml | task |
| scripts/control-tower/ci-deps-step-sim.sh | task |
| tests/control-tower/ci-deps-step-sim.test.sh | task |
| memory/notes/implemented/2026-10-11-ci-deps-lock-fingerprint.md | task |

## Done 标准
- [ ] verify: `bash scripts/control-tower/ci-deps-step-sim.sh` ⇒ rc=0（4 场景全 PASS）
- [ ] verify（改坏即红②）: 把该 step 正文换回旧逻辑 ⇒ 复跑器 rc=1 且 `failures=3`，甲/乙/丙 逐条点名
- [ ] verify: `node -e "require('js-yaml').load(require('fs').readFileSync('.gitea/workflows/local-gates.yml','utf8'))"` ⇒ 无异常
      （⚠️ 本机 `python3` **无 yaml 模块**（`ModuleNotFoundError`）⇒ 不能用 python 版，已换成 `js-yaml`，实测 OK：jobs=gates / steps=5）
- [ ] verify: 复跑器只写 `$SYNO_DEPS_WS`；`/Users/wane/.ci-work/SynovaAgent/node_modules` 未被删（`-d` 成立）
- [ ] verify: `bash tests/control-tower/ci-deps-step-sim.test.sh` ⇒ `RESULT: 11 PASS / 0 FAIL`（含反例②与边界③）
- [ ] verify: 该 step 仍是**唯一**依赖安装点 —— 🔴 这条判据我**改了三次才做成可判的**，记在这里防复踩：
      ① `grep -c "npm ci"` ⇒ **6**（把 2 处注释 ＋ 3 处 `echo` 文本全数进去）
      ② `grep -E '^[[:space:]]*[^#].*npm ci' | grep -v echo` ⇒ **3**（`#` 判定对**缩进注释**无效）
      ③ ✅ **可判口径**：`grep -E 'npm ci' … | grep -vE '^[[:space:]]*#' | grep -vE '^[[:space:]]*echo' | grep -c .` ⇒ **恰 1 行**
         实测真身 = `/usr/bin/env PATH="$NODE_BIN:$PATH" npm ci --silent`（`:54`）
      ⇒ 教训：**判据要针对"真调用形态"下刀**，而不是对"字符串出现过"下刀 —— 与「注释即可满足 = 假绿」同型。
