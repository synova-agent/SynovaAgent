---
north-star:
  服务用户: FDE（前线部署工程师）+ 创始人——"双平台安装包"必须被真实装到目标机证明可用，而不是 CI 绿灯 + 代码 verified 的自我安慰
  服务场景: 创始人/客户拿到 CI 安装包（Mac dmg / Win exe）→ 真实安装 → 双击启动 → 服务自启 → 首诊旅程跑通 → 数据不丢，全程有物理断言 evidence，任何人可照 founder-demo checklist 复现
  模块终态: `docs/synova/runbooks/founder-demo-mac.md` + `founder-demo-win.md` checklist 从"命令可执行"升级为"真实跑通过（安装/启动/首诊/数据四段物理断言 evidence 落盘）"——客户/创始人照着装就能用
  对齐北星: PRODUCT-BRIEF §二（直接用户=FDE，缺系统诊断工具）+ §六 P0（不能给 FDE 用的一切都不算数）；施工图 Track A 部署轨 L291（"客户A部署用现有代码跑通"——安装包真实可用是部署轨验收前提）
  完成标准: Mac 实测 evidence（dmg 安装→启动→服务自启→首诊→数据不丢，物理断言）+ Win 实测 evidence（NSIS 安装→双击→出窗）+ artifact md5 落盘 + founder-demo checklist 完成态——"装上了"必须有进程/窗口/healthz/数据四类物理证明，禁止"下载了 artifact"冒充
  当前进度: 切片 A/B/C 代码闭环（D517-528 全部 audited）——验证脚本（mac-install-verify/win-install-verify/upgrade-data-verify/first-diagnosis-timing）与 runbooks（founder-demo-mac/win 等）已入库；**但 CI 安装包从未被真实装到目标机验收过**——D519 是本地构建 dmg 实测，D523 的 Win 实测一直 waiting（无 .exe 产物）；本次=用 CI artifact（run 32870900391）真实安装验收，从"验证点 verified（代码）"到"实际部署可用"
---

<!--
  SYNOVA-IMPL-DSH-D536: 部署轨——桌面端实际部署验收（Track A 部署轨，slice: deploy-acceptance）
  状态: dev doc | 2026-08-26 | 优先级 P1（Track A 部署轨，永远不被阻塞）
  权威: 派单-部署轨-D536-20260826.md（5 必答题）+ 施工图 Track A 部署轨 L291 + D519/D523/D527/D528 先例
  依赖: 切片 A/B/C 产物（CI artifact run 32870900391: macOS 1040MB + Windows 215MB, expired:False——API 实测）+ 验证脚本 4 个（origin/main 实测存在）+ runbooks 6 个（origin/main 实测存在）
  并行: 无（部署轨串行；本单只消费产物，不碰 src//scripts/audit//build-synova.cjs）
  前置: Win 实测需 GUI dsh-ssh 配置一台 Windows 目标机（创始人已确认走此路）——未配置则 Win 侧如实 waiting（D523 先例，不伪造）
-->

# D536: 部署轨——桌面端实际部署验收（deploy-acceptance）

> 一句话问题: 切片 A/B/C 把"能装/能开/能用"的验证点做到了代码层 verified（mac-install-verify.sh 本机实测过、win-install-verify.ps1 因为无 .exe 一直 waiting、upgrade-data-verify.sh 因为无 dmg 只跑了 --dry-run）——但 **CI 打出的安装包（run 32870900391）从来没有被真实装到目标机验收过**。客户/创始人现在拿到的是一份"代码已验证、实际部署未验收"的双平台安装包。Track A 部署轨（施工图 L291）要求"客户A部署用现有代码跑通"，本任务就是把最后一段"实际部署可用"补上。

## 1. Authority Doc Verification

- **派单**: `docs/synova/coordination/派单-部署轨-D536-20260826.md`（5 必答题 + 验收 + 写集约束）
  > 「下载 CI 安装包 → 真实安装到目标机（Mac + Win）→ 启动 → 服务自启 → 首诊旅程 → 数据不丢——部署验收记录（founder-demo checklist），客户/创始人可直接照着装」「验收（物理可复现）：Mac + Win 实测 evidence（安装/启动/首诊/数据，物理断言）+ founder-demo checklist 可执行 + artifact md5 落盘——禁止'下载了 artifact'冒充'装上了'」
- **施工图**: `docs/synova/research/DSH迁移施工图-20260820/DSH迁移施工图-20260820.md` §6 Track A L291-292
  > 「**Track A — 部署轨（最高优先级，永远不被阻塞）**：客户A部署用**现有代码**跑通。迁移轨的任何阶段若与部署冲突，迁移轨让路。」+ L298「**部署验收前连低风险改动也不做——部署前只动文档与配置**」
- **产品北星**: `.claude/PRODUCT-BRIEF.md` §二（直接用户=FDE，缺系统诊断工具）+ §六 P0（"没有这些不能给 FDE 用"）
- **切片先例**（本单全部复用，禁止重造）:
  - D519 spec `docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D519-mac-install-test-20260824.md`（mac-install-verify.sh 契约 0/1/2 + evidence 落盘规范）
  - D523 spec `docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D523-win-double-click-20260825.md`（win-install-verify.ps1 契约 + waiting 不伪造先例）
  - D527 spec `docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D527-first-diagnosis-e2e-20260825.md`（first-diagnosis-timing.sh 30 分钟计时 + GS-01 LLM 门控）
  - D528 spec `docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D528-upgrade-data-retention-20260825.md`（upgrade-data-verify.sh 数据断言 + 临时 userData 零触碰）
- **D510 F1 红线**: 静态 grep/模拟冒充实测——本单全部验收 = 物理命令断言（同 D519 §2）
- **铁律**: AGENTS.md 铁律 0-2（入口→交互→结果三环节）/ 7（Done 标准）/ 24（不静默）/ 35（自动化优先，能脚本的不靠 review）/ 47/48（契约+非空壳测试）

## 2. Problem Statement

「桌面端实际部署可用」uncommitted。切片 A/B/C 闭环后剩最后一段——**CI 安装包的真实部署验收**。当前缺口四块:

1. **CI artifact 从未下载 + 指纹从未落盘**——D519 只验了本地构建的 dmg（`MD5 (release/SynovaAgent-0.1.0-arm64.dmg) = be55d9db...`），CI 的包（run 32870900391）只回填了 artifact URL（task-state/D519.json evidence 字段），下载 + md5 校验零执行。
2. **Mac 实测只用过本地构建包**——mac-install-verify.sh 的 `--skip-build` 从 `release/` 取 dmg，从未用 CI 下载的 dmg 装过；首诊旅程（D527）和升级数据（D528）在 prod 安装包路径下从未连跑（D528 因无 dmg 只跑了 --dry-run，evidence 里明确写 "⏸ 升级实测 evidence——本编码环境无 dmg 产物"）。
3. **Win 实测从未发生过**——D523 的 DS1（Win 本机 powershell 实跑 exit 0 + evidence 五类文件）一直 waiting，因为当时 release/ 无 .exe；现在 CI artifact（215MB exe）可下载，但**目标机接入是新的前置依赖**（本机 macOS 无 pwsh，需要 Windows 目标机经 GUI dsh-ssh 接入）。
4. **founder-demo checklist 无"完成态"**——founder-demo-mac/win.md 有命令有预期，但没有任何一次"照此清单真实跑通"的记录（安装/启动/首诊/数据四段证据），部署指引里的 Gatekeeper 绕过（未签名）只有一句提示没有实测路径。

> 一句话：**代码 verified ≠ 部署可用。** 本任务把最后一段用物理 evidence 补上。

## 3. Q0-Q4

**Q0 拼图**: L1 桌面端部署验收（Track A 部署轨）。消费切片 A/B/C 产物（CI artifact + 验证脚本 + runbooks），**零产品代码改动**。本任务 = artifact 下载校验 + Mac/Win 真实安装实测 + 部署验收记录（evidence + checklist 完成态）。验证脚本全部复用（mac-install-verify / win-install-verify / upgrade-data-verify / first-diagnosis-timing），runbooks 补全（founder-demo-mac/win + 部署验收记录文档）。
**Q1 调研**: 业界 = CI 安装包分发验收标准做法：**artifact 下载 → 校验和（md5/sha256）→ 目标机安装 → 启动断言 → 证据留存**（GitHub Actions artifact + checksum + smoke test 是行业惯例）；Anthropic 基线 = 机器可验契约（物理断言，非口述）+ fail-closed（无目标机 → 如实 waiting，不伪造）；memory 教训 = D510 F1（禁静态 grep 冒充实测）+ D523 DS4（无 .exe 时 waiting 不伪造——**本单 Win 无目标机时同样处理**）+ D528 DS2（无 dmg 时 --dry-run 不伪造——**本单有 dmg，必须真实跑**）+ D519 实跑踩坑（ELECTRON_RUN_AS_NODE 显式 unset、dmg 卷名解析）。**参考: GitHub Actions artifact 分发 + checksum 校验（业界标准）+ Anthropic（物理断言/不伪造）+ 第一性原理（"装上了"= 进程+窗口+健康+数据四类物理事实）+ 结论：复用既有 4 脚本，只补"CI artifact 下载校验"与"部署验收记录"。**
**Q2 范围**: 做什么——①CI artifact 下载 + md5 落盘（D519 先例，evidence 落盘）；②Mac 实测全链（dmg 安装→启动→服务自启→首诊→数据不丢，复用 4 脚本）；③Win 实测（NSIS 安装→双击→出窗，复用 win-install-verify.ps1，经 GUI 配置的 dsh-ssh 主机远程执行）；④部署验收记录（evidence 落盘 + founder-demo checklist 完成态 + 部署验收 runbook）；⑤已知限制如实（签名/公证未做 → Gatekeeper 绕过写进指引）。不做什么——src/ 任何文件（派单红线）、scripts/audit/（K3 专属）、build-synova.cjs（构建链已闭环，本单只消费产物）、**不新建验证机制**（复用 4 脚本；只有实测暴露缺口才微调，且 spec §5 注明）、不解决签名/公证（切片 A descope，如实声明）。
**Q3 验收**: 入口=CI artifact（run 32870900391）下载 → md5 落盘；处理=Mac（mac-install-verify.sh --skip-build + CI dmg）→ 服务自启（D522 断言）→ 首诊旅程（first-diagnosis-timing.sh --mode prod + GS-01 LLM 门控）→ 数据不丢（upgrade-data-verify.sh --installer CI dmg）；Win（win-install-verify.ps1 远程执行）；结果=evidence 物理断言原文落盘 + founder-demo checklist 完成态 + task-state/D536.json 回填。
**Q4 契约与测试**: 见 §7。

## 4. Current State（2026-08-26 实测，origin/main @ f341c43d）

> 基线声明：本 spec 写于干净 worktree（docs/d536-deploy-spec，基于 origin/main）。以下全部 grep/API 实测。

### 4.1 CI artifact 可下载（API 实测，2026-08-26）

```
GET https://api.github.com/repos/tangbaobao520/SynovaAgent/actions/runs/32870900391/artifacts
  → total: 2
  → synova-desktop-macOS-37  | id: 9572118172 | size: 1091488348 | expired: False
  → synova-desktop-Windows-37| id: 9572059369 | size: 225950659  | expired: False
```

- token 来源：`~/.dsh/.credentials.yaml` → `refs.GITHUB_TOKEN`（0600，实测存在；**token 值禁止入 spec/evidence/commit**）
- 下载 API：`curl -L -H "Authorization: token $TOKEN" https://api.github.com/repos/tangbaobao520/SynovaAgent/actions/artifacts/<id>/zip`
- D519 先例 URL（task-state/D519.json evidence）：macOS artifacts/9572118172 / Windows artifacts/9572059369

### 4.2 验证脚本全部就位（origin/main 实测，blob 哈希确认）

| 脚本 | 行数 | 契约（exit） | evidence 落点 | 本单复用方式 |
|---|---|---|---|---|
| `scripts/desktop/mac-install-verify.sh` | 177 | 0=四断言全过 / 1=断言失败 / 2=前置缺失 | `evidence/D519-mac-<date>/`（dmg-ls/md5/mount/install/assertions/window/healthz/backend/process） | `--skip-build` + CI dmg 放 `release/`（脚本 :94 从 `release/*.dmg` 取最新） |
| `scripts/desktop/win-install-verify.ps1` | 96 | 0=四断言全过 / 1=断言失败 / 2=前置缺失（waiting） | `evidence/D523-win-<date>/`（exe-md5/process/window/healthz/backend） | Win 目标机远程执行；exe 放 `release/`（脚本 :33 从 `$EXE_DIR` 取） |
| `scripts/desktop/upgrade-data-verify.sh` | 187 | 0=数据保留 / 1=数据丢失 / 2=前置缺失 | `scripts/golden-scenarios/evidence/upgrade-data-<date>-<ts>/`（tables/rows/md5/integrity/summary） | `--installer <CI dmg>`（脚本 :50 支持） |
| `scripts/desktop/first-diagnosis-timing.sh` | 181 | 0=里程碑走完 / 1=探测失败 / 2=前置缺失 | `scripts/golden-scenarios/evidence/first-diagnosis-timing-<date>.json` | `--mode prod --installer <CI dmg>`（脚本 :59 支持） |

### 4.3 runbooks 全部就位（origin/main 实测）

- `docs/synova/runbooks/founder-demo-mac.md`（66 行）——4 步 checklist（打 dmg→安装→启动→首诊页可达）+ K3 复跑口径；**缺**：CI artifact 下载步骤、首诊旅程（D527）、数据不丢（D528）、checklist 完成态
- `docs/synova/runbooks/founder-demo-win.md`（42 行）——4 步 checklist（安装→启动→出窗→首诊页可达）+ 红线；**缺**：CI artifact 下载步骤、checklist 完成态
- `desktop-build.md` / `desktop-dev-prod.md` / `first-diagnosis-e2e.md` / `upgrade-data-retention.md`——本单只读引用（不修改）

### 4.4 本机环境（实测）

- macOS 26.3 arm64；`md5`/`md5sum` 均在（/sbin/md5 + /sbin/md5sum）；`hdiutil`/`osascript`/`pgrep` 均在（mac-install-verify.sh 前置检查可过）
- `ELECTRON_RUN_AS_NODE` 未设置（当前会话）；脚本已显式 unset（D519 踩坑固化）
- `release/` 目录不存在（需创建——CI dmg 下载落位）；`evidence/` 不存在（gitignore，D519 追加）
- `.env` 有 `LLM_API_KEY`（src/config.ts:72 优先读取）+ `LLM_BASE_URL` + `LLM_MODEL`——**首诊实测的 LLM 环境可用**；synova.json llm.provider=deepseek（key 走 env 不落文件）

### 4.5 LLM key 注入链路（首诊实测关键，grep 实测）

```
electron/backend-spawn.cjs:105  const env = { ...process.env }          ← spawn 继承 Electron 进程 env
electron/backend-spawn.cjs:174  env.SYNOVA_DB_PATH = dbPath            ← 仅注入 DB 路径
src/config.ts:72  const llmApiKey = process.env.LLM_API_KEY || ...     ← 后端读 env
```

> ⚠️ **执行约束（spec 声明，非缺陷）**：mac-install-verify.sh 用 `env -u ELECTRON_RUN_AS_NODE open "$INSTALLED_APP"` 启动（:142）——`open` 启动的 app **不继承 shell env**，LLM_API_KEY 不会进 Electron 进程 → 首诊 consult 拿不到 key。首诊实测路径必须**直接执行二进制**（`"$INSTALLED_APP/Contents/MacOS/SynovaAgent"`，继承 shell env）或 `launchctl setenv LLM_API_KEY <值>` 后 open（GUI 会话 env 注入）。两种方式都**不改代码**，编码 session 实测时选择其一并在 evidence 记录注入方式（详见 §7 L2a 用例）。

### 4.6 Win 目标机（创始人已裁决）

- 本机（macOS）无 pwsh/powershell（实测 `which pwsh powershell` 零结果）——win-install-verify.ps1 必须在一台 **Windows 目标机**上执行
- 创始人确认接入方式：**GUI dsh-ssh 插件配置 Windows 主机**（alias/IP/凭据）→ 编码 session 用 `ssh_exec`/`ssh_upload` 远程执行
- 当前 `~/.dsh/dsh-ssh.json` 不存在（无已配置主机）——**编码 session 启动前置**：确认 GUI 已配置 Win 主机（`ssh_list` 可见）；未配置 → Win 侧如实 waiting（D523 DS4 先例：不伪造），Mac 侧照常完成

## 5. What We Build

### 5.1 写集 (4 修改 + 2 新建)

| 文件 | 操作 | 说明 |
|------|:---:|------|
| docs/synova/runbooks/founder-demo-mac.md | 修改 | 补全为**部署验收 checklist**：①新增「第 0 步 CI artifact 下载 + md5」；②「第 1 步 打 dmg」标注可跳过（复用 CI 包）；③首诊旅程（first-diagnosis-timing.sh prod + GS-01 LLM 门控）；④数据不丢（upgrade-data-verify.sh）；⑤**checklist 完成态**（每步注明 evidence 落点 + D536 实测日期/结论，见 §10 DS4）；⑥Gatekeeper 绕过实测路径（右键打开 / launchctl） |
| docs/synova/runbooks/founder-demo-win.md | 修改 | 补全为**部署验收 checklist**：①新增「第 0 步 CI artifact 下载 + md5」；②远程执行路径（dsh-ssh 主机上跑 win-install-verify.ps1 的命令序列：ssh_upload exe + ssh_exec powershell）；③**checklist 完成态**（见 §10 DS5） |
| docs/synova/runbooks/desktop-deploy-acceptance.md | 新建 | **部署验收 runbook**（K3 独立复核路径）：验收四段（artifact 下载校验 / Mac 安装启动首诊数据 / Win 安装出窗 / checklist 完成态）逐步命令 + 预期产物 + evidence 落点 + 已知限制（签名/公证未做、Win 无目标机时 waiting 语义） |
| scripts/desktop/mac-install-verify.sh | 修改（仅实测暴露缺口时） | 默认**零改动**（`--skip-build` 消费 CI dmg 已满足）。仅当实测暴露缺口（如 CI dmg 卷名/架构与本地不同导致挂载解析失败）才微调，微调内容在 impl 提交说明 + 本 spec §5.2 回填 |
| scripts/desktop/win-install-verify.ps1 | 修改（仅实测暴露缺口时） | 默认**零改动**。仅当远程执行暴露缺口（如 SSH 会话非交互态下 MainWindowTitle 不可读）才微调，同上回填 |
| task-state/D536.json | 修改 | spec 段回填（doc=本 spec + commit）+ status=spec_done（D382 状态机，dev-doc 交付后）；impl 段由编码 session 回填 |

> **evidence 落盘（gitignore，不入库）**：`evidence/D536-artifacts-<date>/`（artifact zip 下载日志 + md5）、`evidence/D536-mac-<date>/`（mac 四段断言原文）、`evidence/D536-win-<date>/`（win 断言原文，由远程机回传）；关键摘录（md5、断言结果、verdict）回填 task-state/D536.json（D519 先例）。截图/日志原文可放 `docs/synova/product-lines/evidence/`（git 跟踪，D527 spec §5 先例）——**由编码 session 决定，K3 复核需要可复现路径**。

### 5.2 决策参考（S-12，本任务决策点）

| 决策点 | 选项 | 参考系 | 结论 |
|--------|------|--------|------|
| Win 目标机接入 | A 本机无 pwsh 硬跑（不可能）/ B GUI dsh-ssh 配置 Win 主机远程执行 / C Win 侧 waiting 不实测 | Anthropic（fail-closed：无目标机不伪造）+ 创始人已裁决 B | **B**——创始人确认走 GUI dsh-ssh；未配置则降级 C（waiting 如实标注） |
| artifact 校验 | A 仅下载不校验 / B md5 落盘（D519 先例）/ C sha256 | 业界（checksum 是分发标配）+ D519 先例（md5.txt） | **B**——md5 落盘 evidence（与 D519 同构，K3 可对账）；zip 与解压后 dmg/exe 各留 md5 |
| 首诊 LLM key 注入 | A open 启动（env 不继承，consult 无 key）/ B 直接执行二进制（继承 shell env）/ C launchctl setenv | 实测（backend-spawn env={...process.env} 只继承 Electron 进程 env）+ Anthropic（不静默失败） | **B（首选）/C（备选）**——实测时选一并在 evidence 记录注入方式；不改代码 |
| 验证机制 | A 新建部署验收脚本 / B 复用 4 脚本 + 只补 runbook 与记录 | 派单防膨胀（"不新建验证机制，实测暴露缺口才新增"） | **B**——脚本零改动优先，缺口才微调（§5.1 声明） |

> 收敛检查：B 是各决策点收敛答案（创始人裁决 + D519/D523 先例 + 派单约束），无分歧。**参考: Anthropic（fail-closed/不伪造）+ D519/D523 先例 + 派单防膨胀约束**。

### 5.2b 实测暴露缺口回填（D536 编码 session，2026-08-27，spec §5.1 回填义务）

> 写集默认零改动；以下微调为**实测暴露的脚本缺口**（非新增机制），契约（exit 0/1/2）均未变，逐项回填：

| 脚本 | 行 | 微调 | 缺口（实测暴露） | 契约影响 |
|---|---|---|---|---|
| `scripts/desktop/first-diagnosis-timing.sh` | :73 `now_ms()` | `date +%s%3N` → python3 优先 | macOS BSD date 不支持 `%3N`（输出字面 N 且 exit 0，GNU 语法）→ 里程碑全 null → verdict=INCOMPLETE | 无（0/1/2 不变） |
| 同上 | :152 verdict 比较 | `TARGET_SEC` → `$((TARGET_SEC * 1000))` | TOTAL 是毫秒、TARGET_SEC 是秒——单位不一致导致 1.8s 误判 OVER_TARGET | 无 |
| `scripts/golden-scenarios/GS-01-first-diagnosis/run.sh` | :145 `step_ms()` | 同上 python3 优先 | 同 `%3N` bug → LLM 组计时崩溃（GS01_LLM=1 路径） | 无 |

> 环境注意（非脚本缺口，运行环境事实）: 主工作区 `better-sqlite3` 编译于 Node 24（NODE_MODULE_VERSION 137，v22 加载失败）→ GS-01/upgrade-data 需 `PATH=~/.nvm/versions/node/v24.19.0/bin:$PATH`；LLM key 注入走 **shell env**（dev 服务读 process.env；launchctl setenv 只对 GUI app 生效）——首诊实测两种注入方式均验证。

## 6. What We Don't Do

| 不做 | 原因 |
|------|------|
| 改 src/ 任何文件 | 派单红线——本单只消费产物，零产品代码需求 |
| 改 scripts/audit/ | K3 专属（审计红线，违反=事故） |
| 改 build-synova.cjs / 触发新构建 | 构建链已闭环（D517/D529），本单用既有 CI artifact |
| 新建验证机制（新脚本/新断言框架） | 派单防膨胀——复用 mac-install-verify/win-install-verify/upgrade-data-verify/first-diagnosis-timing；实测暴露缺口才微调（§5.1 声明） |
| 签名 / 公证 / notarize | 切片 A descope（无 Apple 证书）；如实写进部署指引（Gatekeeper 绕过路径） |
| Win 无目标机时伪造实测 | D523 DS4 教训——未配置 dsh-ssh 主机 → Win 侧如实 waiting + evidence 标注，不伪造 |
| 无 LLM key 时伪造首诊全链路绿 | D527 GS-01 诚实 RED 先例——consult 六阶段依赖 LLM，无 key 如实 RED |
| 改 D522/D523/D527/D528 已交付的验证点代码 | 已 audited 闭环；本单只消费其产物与脚本 |

## 7. Test Requirements

**契约（铁律 47）**: 复用脚本契约不变（mac-install-verify 0/1/2、win-install-verify 0/1/2、upgrade-data-verify 0/1/2、first-diagnosis-timing 0/1/2）；**本单新增契约 = 部署验收四段流程**：`artifact 下载+md5 → Mac 安装启动（+服务自启+首诊+数据）→ Win 安装出窗 → checklist 完成态`——每段物理断言，任一失败如实记录（铁律 24），无目标机/无 key 如实 waiting/RED（不伪造）。

| 层 | 用例 | 覆盖（red 前提） |
|:---|------|------|
| L1 单元 | 复用脚本契约回归：`npx vitest run tests/electron/`（D519/D522/D523/D527/D528 存量测试全绿）——**防复用脚本被改坏** | 脚本被误改时红 |
| L2a 接线 | **CI artifact 下载 + md5 落盘**：curl Actions API 拉 zip（HTTP 200）+ 解压取 dmg/exe + `md5 <zip>`/`md5 <dmg>` 落 evidence（与 D519 同构）——curl 401/404/expired → 如实失败 evidence（不静默） | 无 token/expired 时红 |
| L2a 接线 | **Mac 全链实测**（真实安装，非模拟）：CI dmg → `mac-install-verify.sh --skip-build`（A1 进程/A2 窗口/A3 healthz/A4 日志四断言 exit 0）→ `first-diagnosis-timing.sh --mode prod --installer <dmg>`（install_start→install_done→app_launch→healthz_200→first_diagnosis_ready，verdict 落 JSON）→ `upgrade-data-verify.sh --installer <dmg>`（verdict: DATA_RETAINED）——**首诊 LLM 注入**（§4.5 执行约束：直接执行二进制或 launchctl setenv，evidence 记录注入方式）；无 LLM key → GS-01 如实 RED | 装不上/启动失败/数据丢失时红 |
| L2b 降级 | **无 Win 目标机**（dsh-ssh 未配置）→ Win 侧 evidence 标注 `waiting: 无 Windows 目标机（GUI 未配置）` + Mac 侧照常完成——不伪造（D523 DS4） | 伪造时红 |
| L2b 降级 | **无 LLM key** → 首诊段如实 RED（GS-01 CONSULT_LLM_RED），安装/启动/数据段仍必须绿 | 伪造全链路绿时红 |
| L2c 边界 | **幂等复跑**：Mac 全链连跑两次 exit 0（第二次清理残留 /Applications/SynovaAgent.app + userData）；**中途失败**：任一断言失败 → 脚本 exit 1 + evidence fail.txt 记录失败步（不静默早退） | 残留污染/静默失败时红 |

**verify 命令（物理实测，唯一权威）**：
```bash
# ① artifact 下载 + md5（token 从 ~/.dsh/.credentials.yaml 读，值不落盘）
curl -L -H "Authorization: token $TOKEN" -o /tmp/synova-macos.zip https://api.github.com/repos/tangbaobao520/SynovaAgent/actions/artifacts/9572118172/zip
curl -L -H "Authorization: token $TOKEN" -o /tmp/synova-win.zip https://api.github.com/repos/tangbaobao520/SynovaAgent/actions/artifacts/9572059369/zip
md5 /tmp/synova-macos.zip /tmp/synova-win.zip          # 落 evidence/D536-artifacts-<date>/md5.txt
unzip -l /tmp/synova-macos.zip | grep -i dmg            # 解压确认 dmg/exe 存在
# ② Mac 全链（release/ 放 CI dmg）
bash scripts/desktop/mac-install-verify.sh --skip-build; echo "exit=$?"
bash scripts/desktop/first-diagnosis-timing.sh --mode prod --installer release/<CI dmg>; echo "exit=$?"
bash scripts/desktop/upgrade-data-verify.sh --installer release/<CI dmg>; echo "exit=$?"
# ③ Win（GUI 配置 Win 主机后，ssh_exec 远程）
powershell -File scripts/desktop/win-install-verify.ps1; echo "exit=$LASTEXITCODE"   # Win 目标机上
# ④ 回归
npx vitest run tests/electron/
```

## 8. Wiring Verification

| 新产物 | 生产调用点（实测方法） |
|--------|------|
| founder-demo-mac.md（补全） | 创始人/客户部署路径的唯一指引——第 0 步下载/校验 → 第 2-4 步安装/启动/首诊 → 第 5 步数据不丢；checklist 完成态记录 D536 实测结论（§10 DS4） |
| founder-demo-win.md（补全） | Win 侧部署唯一指引——第 0 步下载/校验 + 远程执行命令序列（dsh-ssh）；checklist 完成态（§10 DS5） |
| desktop-deploy-acceptance.md（新建） | K3 独立复核路径（§10 DS6 判据引用）；编码 session 实测执行手册 |
| 复用脚本（mac-install-verify 等 4 个） | 生产调用点 = founder-demo checklist 各步 + desktop-deploy-acceptance.md 各段——**测试调用不计**（D381 S-3） |
| task-state/D536.json | 部署验收记录汇总（md5/断言/verdict 摘录）；K3 审计入口（同 D519 task-state 先例） |

> 本单无新 export/新函数——"接线"= 复用脚本被 founder-demo checklist + 部署验收 runbook 真实引用（grep 引用确认），验收记录回填 task-state（同 D519 §8 先例）。

## 9. Architecture Layer

L1 交互层部署验收基建（同 D519/D523/D527/D528——不进运行时链路）。脚本只消费安装包产物 + HTTP 探活 + 文件断言，零跨层；不 import 任何 L2-L5 层。**部署轨原则（施工图 L298）**：部署前只动文档与配置，本单符合（写集全为 runbook/记录/脚本复用，零产品代码）。

## 10. Completion Standard（DS 与派单必答题一一对应，S-10）

1. **DS1（必答 1）**: CI artifact 下载 + md5 校验落盘——`evidence/D536-artifacts-<date>/` 含 zip 下载日志 + md5.txt（macOS zip + Windows zip + 解压后 dmg/exe 指纹）；task-state 回填 md5 摘录
2. **DS2（必答 2，Mac）**: CI dmg 真实安装 → 启动 → 服务自启 → 首诊 → 数据不丢——`mac-install-verify.sh --skip-build` exit 0（A1-A4 四断言）+ `first-diagnosis-timing.sh --mode prod` verdict JSON（WITHIN_TARGET/OVER_TARGET 如实）+ `upgrade-data-verify.sh` verdict: DATA_RETAINED；evidence 落盘（断言/日志原文）
3. **DS3（必答 3，Win）**: NSIS 安装 → 双击 → 出窗——win-install-verify.ps1 在 GUI 配置的 Win 目标机（dsh-ssh）远程执行 exit 0 + evidence 五类文件回传；**未配置 Win 主机 → 如实 waiting + evidence 标注（D523 DS4），Mac 侧不受影响**
4. **DS4（必答 4）**: founder-demo-mac checklist 完成态——4 段（下载/安装启动/首诊/数据）每段标注 evidence 落点 + 实测日期 + 结论；founder-demo-win checklist 同（或标注 waiting 原因）
5. **DS5（必答 5）**: 已知限制如实——部署指引明确：未签名未公证（dmg 首次打开被 Gatekeeper 拦 → 右键打开/launchctl 绕过路径已实测记录）；Win 无目标机 waiting 语义；LLM key 注入方式记录
6. **DS6**: 部署验收 runbook（desktop-deploy-acceptance.md）K3 可独立复核——每段命令 + 预期产物 + evidence 落点；`npx vitest run tests/electron/` 全绿（复用脚本未被改坏）
7. **DS7**: 写集外零触碰 + scripts/audit/ 零触碰 + git diff --name-only 与写集一致（check-dev-doc-write-set 对账）；task-state/D536.json 回填（spec 段已填，impl 段编码后填，slice=deploy-acceptance 保留）

> DS1-DS7 逐项标注（✅/⏸/❌+理由），禁止重编号/跳号/静默缺项（S-10）。

## 11. Auth Doc References

- `docs/synova/coordination/派单-部署轨-D536-20260826.md`（5 必答题 + 验收 + 写集约束）
- `docs/synova/research/DSH迁移施工图-20260820/DSH迁移施工图-20260820.md`（§6 Track A L291-292 + L298 部署前只动文档与配置）
- `.claude/PRODUCT-BRIEF.md`（§二 FDE / §六 P0）
- `docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D519-mac-install-test-20260824.md`（mac 实测先例 + md5 落盘）
- `docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D523-win-double-click-20260825.md`（win 契约 + waiting 先例）
- `docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D527-first-diagnosis-e2e-20260825.md`（首诊 + 计时 + GS-01 LLM 门控）
- `docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D528-upgrade-data-retention-20260825.md`（数据不丢 + 临时 userData）
- `scripts/desktop/mac-install-verify.sh` / `win-install-verify.ps1` / `upgrade-data-verify.sh` / `first-diagnosis-timing.sh`（复用脚本契约，origin/main 实测）
- `docs/synova/runbooks/founder-demo-mac.md` / `founder-demo-win.md` / `desktop-build.md` / `desktop-dev-prod.md` / `first-diagnosis-e2e.md` / `upgrade-data-retention.md`
- AGENTS.md（铁律 0-2/7/24/35/47/48）+ task-state/README.md（D382 状态机）

## 12. 自检清单（dev-doc 侧，K3 可核）

- [x] 派单 5 必答题逐条覆盖（①artifact 下载+md5=DS1 ②Mac 实测=DS2 ③Win 实测=DS3 ④部署验收记录=DS4+DS6 ⑤已知限制=DS5）
- [x] artifact 可下载已 API 实测（run 32870900391 / id 9572118172+9572059369 / expired:False）——非凭派单描述
- [x] 4 个验证脚本存在已 grep 确认（origin/main blob 哈希 + 行数 + 契约）——复用声明真实
- [x] 首诊 LLM key 注入链路已 grep 实测（backend-spawn env 继承 + config.ts 读 env + open 不继承 env 的执行约束写入 §4.5/§7）
- [x] Win 目标机约束已实测（本机无 pwsh）+ 创始人裁决记录（GUI dsh-ssh）+ waiting 不伪造（D523 DS4）
- [x] 复用脚本默认零改动；微调仅在实测暴露缺口时（§5.1 声明 + 回填义务）
- [x] evidence 落盘规范对齐 D519 先例（gitignore 本地 + task-state 摘录 + product-lines/evidence 可复现路径）
- [x] 写集 6 条目（4 修改 + 2 新建），不碰 src/、scripts/audit/、build-synova.cjs
- [x] 决策参考已记录（§5.2，S-12）：四决策点均收敛
- [x] DS 与必答题一一对应（DS1-7，S-10）；无 phantom 声称（S-11）
- [x] gatekeeper exit 0（C1-C6，D381 格式：写集表标题 + 表头行 + §8 Wiring Verification）
