# Task Brief: #52 → K10/BS-5 — BS-5 交付打包卫生：Dockerfile 路径 + 三处版本号统一 + sourcemap 泄漏核查

> 卡面来源：CTO 2026-10-11 立卡（本件为**正卡** `#52` 的工卡）
> 架构基准：**产品宪章 v8.1**（§0.4 ＋ §4.1）｜机器真源：`docs/synova/coordination/施工项登记.ts`（K10 块 · `BS-5`）
> 批次：第1批 ｜ 登记件 status：`todo` ｜ 依赖：无

## 〇、为什么要做这个（通俗版 · 先读这一节）
**① 一句话**：交付包卫生三件：Dockerfile 路径正确、**版本号单一来源**、不泄漏 sourcemap。
**② 解决什么问题**：实测：Dockerfile COPY 路径错；版本号散在三处易漂移；`.map` 泄漏面未核。
**③ 做完对项目的推动**：交付面是客户的**第一接触面**；打包不卫生 = 客户镜像里带宿主绝对路径（`/Users/wane` 一类）⇒ 信息泄漏 ＋ 构建不可复现。
**④ 🔴 不做行不行**：**不行**：泄漏宿主路径是信息泄漏，且不可复现构建会让"客户装不上"无法定位。
**⑤ 现在有什么基础（代码盘点，as_of local-main）**：✅✅ **判据已绿**（本次实测 `bash scripts/control-tower/probe-packaging.sh` ⇒ exit 0，PASS=21 FAIL=0；含 C1/C2 宿主路径零命中、D1/D2/D3 `.map` 面核查）⇒ 本卡**只待状态收口**，不需新做代码。
**⑥ 还需要做什么**：无需再做什么；如需加固仅保持判据绿（写集不变）。
**⑦ DSH 借鉴方式**：**自研**：DSH 是桌面宿主 + npm 包形态，**不出客户镜像**，无"Dockerfile/版本号单一来源/交付包卫生"语义 ⇒ DSH 无对应物可借（诚实标注）。
**⑧ 涉及代码文件**：Dockerfile｜package.json｜scripts/build/｜scripts/control-tower/probe-packaging.sh

## Q0: 定位 — 项目拼图 + 文件审计
本卡属 **K10 平台交付与运行时（DSH）**，架构位置 = −1 运行时（交付面）。
文件审计（实测 `git ls-tree origin/local-main`，as_of `7c6315029`）：
- Dockerfile
- package.json
- scripts/build/
- scripts/control-tower/probe-packaging.sh
结论：**扩展/新建**（见 §〇 ⑤/⑥）。

## Q1: 调研
a) 业界：交付面与运行时面必须**单一入口 ＋ 可机器判**（Anthropic 工程基线：不可逆 / 对外可见的动作要有独立于执行者的判据）。
b) 顶级团队：DSH 的做法是**一能力一包 ＋ 按名声明、宿主满足**（见 ⑦ 的 file:line 证据）。
c) memory 教训：**铁律 0-2**（接线失败 4 次 —— 组件过了单测但从未被生产调用）；**判例 V-02**（grep 型不得作验收）；**判例 V-07**（假绿要用"拔掉实现照样通过"证伪）。

## Q2: 范围
做什么：
- Dockerfile
- package.json
- scripts/build/
- scripts/control-tower/probe-packaging.sh
- .claude/task-briefs/2026-10-11-52-K10-BS-5-交付打包卫生-Dockerfile-版本号-sourcemap.md
不做什么：
- 不改 scripts/control-tower/probe-egress.sh
- 不改 src/routes/healthz.ts
- 不改 src/deploy/data-directory.ts
- 不改 tests/sentinel/builtin-registration.test.ts
- 不改 src/deploy/content-registry.ts
- 不改 src/init/file-driven-loaders.ts
- 不改 extensions/llm-providers/manifest.json
- 不改 extensions/business-models/manifest.json
- 不改 extensions/engine/manifest.json
- 不改 extensions/tools/manifest.json
- 不改 extensions/context-strategies/manifest.json
- 不改 extensions/implementation-patterns/manifest.json
- 不改 extensions/policies/manifest.json
- 不改 extensions/security/manifest.json
- 不改 scripts/control-tower/probe-content-registry.ts
- 不改 .gitignore
- 不改 scripts/control-tower/probe-delivery-hygiene.sh
- 不改 src/security/pre-upload-validator.ts
- 不改 tests/security/pre-upload-validator.test.ts
- 不改 docs/synova/coordination/施工项登记.ts

## Q3: 验收 — 入口 → 交互 → 结果
入口：`bash scripts/control-tower/probe-packaging.sh`
处理：按 §〇 ⑥ 的缺口清单逐条落地。
结果：见 Done 标准逐条（判据逐字抄自登记件）。

## 架构层: −1 运行时（交付面）
#CRITERIA: D

## 写集
（单源 = 登记件 `paths`；glob 已折为**目录裸路径**，禁通配符与反引号 —— 见 skill brief-compose D1231/#1308）
- Dockerfile
- package.json
- scripts/build/
- scripts/control-tower/probe-packaging.sh
- .claude/task-briefs/2026-10-11-52-K10-BS-5-交付打包卫生-Dockerfile-版本号-sourcemap.md

## Done 标准
- [ ] verify: `bash scripts/control-tower/probe-packaging.sh`（expectExit 0）
- [ ] 反例（改坏即红）：按本卡 §〇 ⑥ 构造反例并留原始输出
- [ ] 三态：未实现必须 **exit 2**（0=通过／1=失败／2=未实现 —— 禁假绿）
- [ ] `npx tsc --noEmit` 零错误
