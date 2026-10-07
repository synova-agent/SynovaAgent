> ⚠️ **锚点版本（2026-09-17 重锚）**：本文写作时锚定 DSH 历史版本（见文内引用，v0.1.0-rc.5 ~ 0.1.3-alpha.1 不等）；
> **现行安装 = `deepseek-harness-pkg 0.1.6-alpha.1`（2026-09-17 02:01）**。文中所有 `file:line` 均为**历史锚点，禁止照抄**——
> 一律用 `docs/synova/coordination/DSH锚点重锚审计-20260917.md` §三 的现验命令现查（包+文件+符号，行号现取）。
# DSH 源码锚点映射 — B-01~B-08 借鉴卡 × Mac node_modules 实测（0.1.2-rc.1）

> 产出: CTO（Mac 侧）| 2026-09-07 | 用途: Win Phase 0 前置——Win 台账 f9e97666 发现②（锚点 dsh-* 包名与源码目录未映射）的**Mac 侧解答**
> 核实源: Mac DSH 运行时依赖 `~/Library/Application Support/io.github.hairyf.deepseek-harness-desktop/dependencies/dsh/node_modules/@deepseek-ai/`（224 包）
> **版本结论: Mac = 0.1.2-rc.1（新于 Win 0.1.1-rc.2 与旧记 0.1.2-alpha.2）——锚点核验以此为准**

## 一、版本链厘清（回答 Phase 0 前置①）

| 来源 | 版本 | 说明 |
|---|---|---|
| Win D:\deepseek-harness | 0.1.1-rc.2 | Win spec 引用的锚点版本（D586 spec §1） |
| Mac DSH 运行时依赖 | **0.1.2-rc.1** | 本机 Desktop 实际运行的版本——**更新**，锚点核验以此为准 |
| npm registry @deepseek-ai/* | 0.1.2-alpha.2 等 | 历史发布（借鉴指引 v2 附录 A 的 224 包表出处） |

三处锚点抽查（B-01 四 canonical 码 / B-04 8192 阈值 / B-08 wx-lock）在 0.1.2-rc.1 全部命中 → **Win 0.1.1-rc.2 引用的锚点在 0.1.2-rc.1 未漂移，借鉴卡描述有效**。

## 二、包名 → 源码路径映射（回答 Phase 0 前置②）

`dsh-*` 是 npm 发布包名；Mac node_modules 的 `@deepseek-ai/<包名>/lib/` 就是**已构建的源码本体**（可读 lib/*.js + types/*.d.ts）——无需映射到 monorepo 目录，直接读构建产物即可（机制语义等价；如需原始 TS 源再向 Win 索取 D:\deepseek-harness 对应包目录）。

| 卡 | npm 包 | 关键文件（0.1.2-rc.1 实测） | 核验锚点 |
|---|---|---|---|
| B-01 LLM 错误码 | `dsh-llm` | `lib/types/error.js`（四 canonical 码 L22-42 + "route on this, never by parsing message" L13）；`lib/types/adapter-failure.js`（normalizeLlmFailure） | ✅ 逐字命中 |
| B-02 重试配置化 | `dsh-llm-retry` | `lib/index.js` + `lib/types/` | ✅ 存在 |
| B-03 token 四桶 | `dsh-token-meter` | `lib/index.js` L239 bucketsFrom（uncachedInput/output/cacheRead/cacheWrite 四桶 L245） | ✅ 命中 |
| B-04 工具结果修剪 | `dsh-compaction-tool-result-pruner` | `lib/index.js` L8 PRUNE_MARKER / L11 thresholdChars:8192 / L12 headChars:4096 | ✅ 逐字命中 |
| B-05 压缩四件套 | `dsh-compaction` | `lib/types/`（config/region/summarizer 等） | ✅ 存在 |
| B-06 协作式超时 | `dsh-agent-loop`（超时/abort 所在） | `lib/index.js` | ✅ 定位 |
| B-07 会话投影注册表 | `dsh-session` + `dsh-session-checkpoint-policy` | `lib/` | ✅ 定位（投影一词需读源码确认对应） |
| B-08 原子写+文件锁 | `dsh-atomic-write` | `lib/index.js`（wx-created lock L11 + rename commit atomic L13） | ✅ 逐字命中 |

## 三、对 Win 台账两个发现的回答

- **发现①（借鉴未读源码）**: 本映射 + Mac node_modules 就是「读源码」的 Mac 侧资源——Win 读 `D:\deepseek-harness`（0.1.1-rc.2）与 Mac 读 node_modules（0.1.2-rc.1）锚点一致，两机均可完成"读源码自研"。
- **发现②（包名未映射）**: `dsh-*` 包名 = npm 发布名；Mac 侧无需 monorepo 目录映射——**`node_modules/@deepseek-ai/<包名>/lib/` 直接可读**（本表第二列即路径）。

## 四、边界

- 本表只做**锚点定位**（借鉴卡描述的真实性核验），不规定借鉴实现方案（那是各卡 spec 的职责）。
- 0.1.2-rc.1 与 0.1.1-rc.2 之间如有个别机制差异，以 Win 本地源码为准读（D586 spec 引用 0.1.1-rc.2 行号）。
