---
状态: proposed
日期: 2026-10-20
决策: 夹具工具链单一来源（scripts/control-tower/fixture-toolchain.txt）＋夹具 `# @requires <bin>` 声明＋check-fixture-requires.sh 核对（缺依赖 exit 2 且报名字；未声明使用静态可检，存量按基线棘轮）。CI 安装步改为从清单派生。
理由: 今天 tsx 缺失只在 ci.yml 单点补；换 jq/python3/yq 还会再补一次（判据纪律⑨：验证结论要能独立复核）。
---

# 决策 Note — #739 ④ 夹具统一工具链

## 九问（pre-plan-thinking，逐问有证据）

1. **问题**：夹具依赖无声明（@requires=0）；缺依赖只报"门禁判不了"不报名字；工具链在 ci.yml 硬编码单点。
2. **现状证据**：`grep -rn "@requires" tests/`=0；ci.yml:1183 硬编码 `tsx@4.23.13`；167 个 tests/control-tower/*.test.sh 中 42 个用 python3、3 个 npx、2 个 sqlite3、1 个 tsx。
3. **有没有现成**：无；一次性核对脚本是新件（判据纪律要求"能报名字"）。
4. **最小改动**：清单（1 文件）＋核对脚本（1 件）＋基线（1 文件）＋ci.yml 两处（安装从清单派生＋preflight）＋范本夹具加 @requires。
5. **最危险假设**：静态"使用"检测用词边界近似（可能漏报/误报）；本机 tsx 在 node_modules/.bin（非 PATH）⇒ 核对需同时查仓库/node_modules/.bin 与主工作区。
6. **失败路径**：清单外声明⇒1；缺依赖⇒2（报名字）；未声明使用（非基线）⇒1；基线内⇒放行。
7. **边界**：只核 *.test.sh/*.test.py；*.test.ts 由 vitest/node 统一承载；不改任何既有判据的"该红/该绿"。
8. **可观测**：`FIXTURE-REQUIRES: checked=… missing=… viol=… baselined=…`。
9. **拆步**：① 清单 ② 核对脚本 ③ 基线（存量 79）④ ci.yml 接线 ⑤ 配对夹具（10/0）⑥ 范本声明。

## 决定
- `fixture-toolchain.txt`：`bin | kind | spec | note`；kind=npm 由 CI 安装，kind=runner 由 runner 预装。
- `check-fixture-requires.sh`：声明→清单→可执行（PATH／仓库 node_modules/.bin／主工作区 node_modules/.bin）；未声明使用静态扫（非注释行、词边界）。
- 存量 79 个未声明夹具入 `fixture-requires-baseline.txt`（棘轮：新/改动必须声明，不得加基线）。
- CI：安装步 `awk` 派生 npm 规格；preflight 步跑核对。

## 依据
- 卡 #739 ④（三条判据＋反例）；本地实测：OK（174 夹具/0 缺/0 违规/79 基线）、配对夹具 10/0。

## 影响面
- 新增 4 件＋ci.yml 2 处＋范本夹具 1 行；不改任何门禁判据。
