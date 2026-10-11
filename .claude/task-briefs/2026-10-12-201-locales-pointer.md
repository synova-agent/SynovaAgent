#CRITERIA: A

# K12-18（#201）— locales 死指针修复（按 CTO 裁定 046 的「准 A ＋ 附加」走法）

> 卡面：Gitea issue **#201**（`[K12-18] locales 死指针修复`）
> 判据源：施工项登记件 `1-13`
> 🔴 **口径来源**：CTO 裁定 **046**（第 7 批收尾指令）
> 本件 = 该卡载体的**第 5 版**（前 4 版承载的分支 #414/#415/#417 已按纪律作废，作废原因见各 PR 正文；**本版与它们无关**）

---

## 坐标系

```
总闸: 不适用
承重件: 不适用
批次: 第0批-止血
命名空间: 不适用
执行态: 未开工
验证级别: L2-真跑通
阻塞源: 无阻塞
```

---

## 〇、裁定 046 定的走法（本卡照此执行）

```
① 准确定性（**不是"死锁"**）：门禁 A 要求 manifest 必填 entryPoint｜门禁 B 要求该字段目标文件必须存在，
   而 extensions/locales/ 下无任何 loader 文件 ⇒ **"现状下无现成解"**。
   🔴 但 `entryPoint = "./manifest.json"` 时**两条同时 rc=0**（check-integrity-startup.sh:10 有显式跳过分支）
   ⇒ 有解 ⇒ 不是"不可能同时满足"。
② 裁定：entryPoint 口径改「**有则必须可解析**」（locales 是**内容**，不是"需要 loader 的可执行扩展"）
   ⇒ 本卡按此把值从死指针 `./locale-loader.ts` 改为 `./manifest.json`（本 schema 下唯一"恒存在"的合法取值）＋
      加 `entryPointNote` 写清"占位"性质 ＋ 保留 `loaderRef` 指向真加载器。
③ 🔴 **附加（不属本卡写集，属治理线）**：门禁 A 的取值面须由 `git diff --cached` 改为**取 tree**
   —— 否则在 CI（`git checkout -f` ⇒ 索引恒空）里门禁 A **空转**。
④ 落：治理线改 `scripts/check-file-driven.sh` 字段表（1 行）＋ 修取值面 ＋ 重跑判别力自检。
```

**第五事实（复核挖的，本卡回执原先没有，现写入）**：
```
· 门禁 A 取 git diff --cached，CI 用 git checkout -f ⇒ 索引空 ⇒ 空集空过绿
· 实证：.ci-work 的 `git diff --cached --name-only | wc -l` = 0；`grep -rn "check-integrity-startup" .gitea/ .github/` = 命中 0
⇒ 「夹死」**解释不了**「#201 从未被这两条拦下」；真拦它的是**本地提交时的 pre-commit**（CI 里 A 空转、B 根本没跑）
```

---

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
内容面（宪章 §5.6）**声明一致性**：`extensions/locales/manifest.json` 声明了一个**两种口径皆不存在**的加载器
⇒ "文档即配置"（院方曾据此**撤回** v0 的一条结论）。本卡只修这一处声明，不碰真加载器、不碰门禁。

### b) 文件审计（开工实测 · ref 口径）
```
$ git ls-tree -r <trunk> extensions/locales/
  ⇒ 7 个 json（zh-CN/ en-US/ 各若干）＋ manifest.json；**无任何 .ts**
$ git grep -n "entryPoint" <trunk> -- src/locale/ src/deploy/content-registry.ts
  ⇒ locales 装配路径**不解析** entryPoint（真加载器 = src/locale/locale-loader.ts，由 content-registry 的 locale 项装配）
$ git show <trunk>:src/locale/locale-loader.ts | grep -n manifest
  ⇒ :33-40 只读 manifest.languages
$ bash scripts/check-integrity-startup.sh   ⇒ 修前 ❌ 1 项失败（死指针）rc=1
$ git add extensions/locales/manifest.json && bash scripts/check-file-driven.sh   ⇒ 修前（旧值）✅（因它只查"字段在不在"）
```

### c) 决策
`entryPoint: "./manifest.json"`（裁定 046 的"准 A"）＋ `entryPointNote`（写清占位性质）＋ `loaderRef`（真加载器指针，纯文档）。
**删 vs 改的值权衡**：删（原走法）在门禁 A 下**硬阻断**（该字段是必填）⇒ 按裁定 046 改为取"恒存在"的合法值。

---

## Q1: 调研
- **裁定 046**（CTO 本批收尾指令）＝ 本卡的直接依据（准 A ＋ 附加）。
- **DSH 依据**：`@deepseek-ai/dsh-invariants/lib/index.js:6-13`「不生效就报错」⇒ 声明必须与真实消费者一致；本卡把"死"改成"占位＋说明"，让**读者能判**该字段无解析者。
- **本仓约束**：`scripts/**` 门禁语义属治理线（裁定 033）⇒ 本卡**只改内容件**，附加③④**不在此写集**。

---

## Q2: 范围

**做什么**（＝ Q2 写集；每行一条 `- <裸路径>`）

做什么

- extensions/locales/manifest.json
- .claude/task-briefs/2026-10-12-201-locales-pointer.md
- .claude/claims/201.yaml

不做什么（含文件路径 · 每行一条，紧跟本行为清单）

- 不改 src/locale/locale-loader.ts
- 不改 src/init/file-driven-loaders.ts
- 不改 src/deploy/content-registry.ts
- 不改 scripts/check-file-driven.sh
- 不改 scripts/check-integrity-startup.sh
- 不改 extensions/locales/zh-CN/ui-strings.json

---

## Q3: 验收（入口 → 交互 → 结果）

- **入口**：`bash scripts/check-integrity-startup.sh`（门禁 B）｜`git add … && bash scripts/check-file-driven.sh`（门禁 A）｜真加载器 `loadLocale('en-US')`
- **交互**：门禁 B 逐 manifest 判"entryPoint 目标是否存在"｜门禁 A 判"必填字段是否齐"
- **结果**：**两条门禁同批 rc=0**（裁定 046 的关键判据）＋ 真加载器不回归

**判据（全部可复跑，原始输出见 PR 正文）**
```
V1 bash scripts/check-integrity-startup.sh                                  ⇒ rc=0（修前 rc=1）
V2 git add extensions/locales/manifest.json && bash scripts/check-file-driven.sh ⇒ rc=0（必填字段齐全）
V3 npx tsx -e "…loadLocale('en-US')…"                                       ⇒ language=en-US degraded=false uiKeys=39（与修前同值）
V4 python3 -c "json.load(open('extensions/locales/manifest.json'))"          ⇒ 合法 JSON
V5 **改坏即红**：把 entryPoint 注回 ./locale-loader.ts（真件）⇒ 门禁 B rc=1 且点名该 manifest；还原 ⇒ rc=0
```

---

## 架构层: 内容面声明（宪章 §5.6；代码层落点 `extensions/`）

## Done 标准

- [x] verify: bash scripts/check-integrity-startup.sh
- [x] verify: bash scripts/check-file-driven.sh
- [x] verify: npx tsx -e "import { loadLocale } from './src/locale/locale-loader'; const r=loadLocale('en-US'); if(r.degraded) process.exit(1); console.log('uiKeys='+Object.keys(r.locale.ui||{}).length)"
- 说明：两条门禁同批 rc=0（裁定 046 关键判据）＋ 真加载器不回归

## 自检 5 问
1. **接线检查**：不新增 export（只改内容面数据文件 + 流程件）⇒ 无新符号。
2. **异常处理**：无新增 catch（未改代码）。
3. **类型安全**：未改 `.ts`（本卡写集内无 TS 文件）。
4. **测试质量**：判据 = **既有两条真门禁** ＋ 真加载器真跑（非空壳、非词法扫描）。
5. **残留清理**：`git grep -n "locale-loader.ts" <trunk> -- extensions/` ⇒ 修后仅剩 `entryPointNote`/`loaderRef` 中的**文档串**；旧死指针值 `./` 于 extensions/ 下零命中。
