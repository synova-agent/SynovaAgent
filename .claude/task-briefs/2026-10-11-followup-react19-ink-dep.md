# Task Brief: #337 → 运行时依赖面 — react 19 与 ink 5.2.1 依赖契约冲突（净安装下 TUI 崩）

> 立卡依据：创始人 2026-10-11 裁「**按 A 案开依赖卡 + 改口径**」
> 前情：`2026-10-11-followup-chat-degradation-red.md` 追因完成 ⇒ **根因不在测试，在依赖**
> 性质：🔴 **产品级**（不只是测试红）
> issue：#337 ｜ 分支：`fix/337-react19-ink-dep` ｜ 机器真源：`.claude/claims/337.yaml`

#CRITERIA: D

## 〇、为什么要做这个（通俗版）
① 一句话：**净安装下 TUI 直接崩** —— 测试只是第一个报信人。
② 问题：`react@19.3.0` 与 `ink@5.2.1` 所带 `react-reconciler@0.29.2` 的 peer 契约 `react: ^18.3.1` **直接冲突**。
   react 19 移除了 `__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED`（改名 `__CLIENT_INTERNALS_…`），
   reconciler 在**模块加载期**读旧名 ⇒ `undefined.ReactCurrentOwner` ⇒ TUI 起不来。
③ 推动：TUI 是产品入口之一 ⇒ **净安装即不可用**。
④ 🔴 **不做行不行：不行。** 而且它一直在**伪装成"环境红"**被豁免（已累计 3 次）。
⑤ 基础：实测 react 消费者**只有 `src/tui-v2/`**（`grep src/ packages/` 零其他命中）。
⑥ ⑦ 见下。
⑧ 涉及文件：见 Q2。

## 🔴 附带发现（同样严重）：**判据本身是假绿陷阱**
`npx vitest run …` 取主仓**陈旧的** vitest 4.1.8 ＋ react 18.3.1 ⇒ **对 react 19 的坏环境照样绿**。
本地 `node_modules` 陈旧于 **Oct 2 18:31**；`package.json` 声明 `react: ^19.3.0`、lock 落 19.3.0。
⇒ **CI 是对的，本地是侥幸。** 卡面 Done 第 2 条用的正是这条命令。

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
TUI V2（代码层 L1）的运行时依赖面 ＋ **铁律 40 冻结路径**（`patches/ink+5.2.1.patch`）。
### b) 文件审计（as_of `local-main=68bf57598`）
| 件 | 现状 | 处置 |
|---|---|---|
| `package.json` | `react: ^19.3.0` | **改**（A 案回 18.3.1） |
| `package-lock.json` | 落 `react 19.3.0` | **改** |
| `patches/ink+5.2.1.patch` | 在库且 CI 已应用（实测 5 处命中） | **A 案不动**（B 案才须重做） |
| `node_modules/` | 陈旧（react 18.3.1） | 不入库；**但它是"本地绿"的根源** |

### c) 决策（已裁：A 案）
**A 案（保守，创始人已批）**：`react` 回 **18.3.1** ＋ `@types/react` 回 **18.3.31**。
理由：恢复 reconciler 的 peer 满足；react 消费者**只有 `src/tui-v2/`**；**不触碰冻结 patch**。
**B 案（未采纳）**：`ink` 升 ≥6.6.0 ⇒ **必须重做冻结 patch** ＋ 同步升 `ink-text-input` ＋ 重跑闪烁回归。

## Q1: 调研 — 依据（原始输出）
```
$ node_modules/ink/node_modules/react-reconciler = 0.29.2 | peer react: ^18.3.1
$ node_modules/react                              = 19.3.0
$ CI 原始日志: Caused by: TypeError: Cannot read properties of undefined (reading 'ReactCurrentOwner')
              ❯ node_modules/ink/node_modules/react-reconciler/cjs/react-reconciler.development.js:494:46
```
**单变量受控实测**（隔离树，只换 react，vitest 恒定 4.1.8）：
| react | reconciler 实测 | 结果 |
|---|---|---|
| **18.3.1** | `hasSecret= object` | **6/6 PASS, rc=0** |
| **19.3.0** | `hasSecret= undefined` | **6/6 FAIL, rc=1** @ `react-reconciler.development.js:491` |
**H1–H4 逐条**：H1 **证实（变体）= 根因**（vitest 版本无关，4.1.8/5.0.2 同红）｜H2 **排除**（工厂顶层已 `vi.hoisted`；改真实 `await import('ink')` ⇒ 6/6 PASS）｜H3 **排除**（`--no-isolate`/`--pool=forks`/`--no-file-parallelism` 三跑全红）｜H4 **排除**（CI 侧 patch 已应用 5 处；patch 件与 `postinstall` 均在库）
**铁律 40 冻结项现状**：patch ✅ 在库 ｜ `postinstall: patch-package` ✅ ｜ CI 实际应用 ✅ ｜ `React.memo` @ `message.tsx:106` / `streaming-text.tsx:17` ✅

### 源头
dependabot **2026-09-21** 把 react 提到 19.3.0（commit `bc2ce01f5`）时**没同步升 ink**。

## Q2: 范围
做什么：
- package.json
- package-lock.json
不做什么：
- 不改 patches/ink+5.2.1.patch — A 案不触碰冻结路径（B 案才须重做）
- 不改 src/tui-v2/** — 本次是依赖面修复
- 不改 .gitea/workflows/** — CI 配置语义，归 CTO
- 不改 scripts/pre-commit-check.sh — 门禁语义，归 CTO

## Q3: 验收 — 入口 → 交互 → 结果
入口：**净安装**（`npm ci`）后的 TUI 与依赖树
处理：`npm ci` ⇒ react 解析回 18.3.1 ⇒ reconciler peer 满足
结果：
- V1 🔴 **判据必须带净安装**：`npm ci && npx vitest run tests/tui-v2/chat-degradation.test.ts` ⇒ **rc=0**
  （⚠️ **不许只用 `npx vitest run …`** —— 本地陈旧 `node_modules` 会给**假绿**）
- V2 `npm ls react` ⇒ 18.3.1（无 19.x）
- V3 **净安装下 TUI 能起**（`npm run tui` 不再因 reconciler 崩）
- V4 **铁律 40 冻结项四项逐条复核**（patch 在库 / postinstall 在库 / `React.memo` 两处 / 无回退 useStreaming）
- V5 反例：把 react 改回 19.3.0 ⇒ V1 **必红**（**含具体失败点**，不是笼统 exit 1）

## 架构层
不适用（依赖面）。若走 B 案则触铁律 40（冻结）⇒ 须 CTO 另批。

## 写集
- package.json
- package-lock.json

## Done 标准
- [x] verify: `npm ci && npx vitest run tests/tui-v2/chat-degradation.test.ts` ⇒ rc=0 —— 实测修前 `1 failed | 6 failed` / rc=1，修后 `1 passed | 6 passed` / rc=0
- [x] verify: `npm ls react` ⇒ 18.3.1（全树 deduped，无 19.x）
- [x] verify: 铁律 40 冻结项四项逐条在库（patch / postinstall / `React.memo` ×2 / 未回退 useStreaming；本卡写集不含签名，逐条复核非改）
- [x] verify: 反例（react 回 19.3.0 ⇒ 重新净安装）⇒ 必红且含**具体失败点**：`TypeError: Cannot read properties of undefined (reading 'ReactCurrentOwner') @ react-reconciler.development.js:491:46`，`1 failed | 6 failed`
- [ ] 🔴 **口径同步**（跨线待办，非本卡）：任何后续卡的 Done 若含 `npx vitest run …`（无 `npm ci`）⇒ 一律视为假绿口径，须改

## 实测回执（as_of 2026-10-11 · 净安装口径）
```
$ export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"
$ npm ci --cache .npm-cache                      # 832 packages, patch-package: ink@5.2.1 ✔
$ npm ls react                                   # 修前：react@19.3.0 deduped invalid: "^18.3.1"
                                                 # 修后：react@18.3.1 全树 deduped
$ npx vitest run tests/tui-v2/chat-degradation.test.ts
  修前 rc=1  Caused by: TypeError: ... reading 'ReactCurrentOwner'
             ❯ react-reconciler.development.js:491:46   Test Files 1 failed | Tests 6 failed (6)
  修后 rc=0  Test Files 1 passed (1) | Tests 6 passed (6)
$ npx tsx src/tui-v2/chat.tsx                    # 净安装下 TUI 真渲染出界面（标题栏+Composer+状态栏）
                                                 # 仅剩"Raw mode is not supported"= 本容器非 TTY，与本缺陷无关
```
**反例（改回 19.3.0 + 重新净安装）**：rc=1，`1 failed | 6 failed`，失败点逐条点名（①②③④a④b⑤），
根因行 `react-reconciler.development.js:491:46` —— **不是笼统 exit 1**，且**首跑即红**（非"永远绿"假反例）。
**lock 面收敛实测**：`git diff --stat` = 2 files / 21 insertions / 10 deletions，新增节点仅 `node_modules/@types/prop-types`（`@types/react@18` 的传递依赖）⇒ **无无关漂移**。
