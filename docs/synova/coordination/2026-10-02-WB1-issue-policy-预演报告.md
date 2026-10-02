# W-B1 · Issue 政策门禁预演报告（D1125）

> 🔴 **本报告是 `informational`（非必过）状态下的预演** —— 它回答「**如果**开检会拦什么」，
> **不代表当前会阻断任何 PR**。本卡未修改 branch protection、未改必需集、未改 `ci.yml`；
> 新增的 `Issue policy` job **不在 12 条必需集内**（已逐条核对，见 §7）。
> 换句话说：即便本报告说「会拦 123 个 PR」，**今天一个都没被拦**。

---

## 0. 可核面与不可变锚（防「分支态被当成已落地」）

| 项 | 值 |
|---|---|
| 取数面 | **GitHub live API**（`synova-agent/SynovaAgent`）—— 与任何 commit 无关，是"当下在飞 PR"这一事实面 |
| `as_of` | `2026-10-02T09:33:33Z` |
| 取数命令 | `gh pr list --state open --limit 200 --json number,title,body,labels,isDraft,createdAt,headRefName,author,url` |
| 快照（分子/分母的原始输入） | `.tmp-wb1/open-prs.json`（617270 字节，**不入 git**，仅本地复算；sha256 `05a4e6f2191227cd0d2ff591c2db9d8e3bb195680c5f4ae5aa298e63f83ad3ff`） |
| **分母** | **open PR = 124**（号段 #567 … #948；`--limit 200` 未截断） |
| 政策实现面 | **分支 `feat/d1125-issue-policy` 工作树内容 —— ⚠️ 不在 `main`**（分支 HEAD 会动，故不当锚） |
| 策略件不可变锚（sha256，随内容定） | `policy.mjs` `90ca92ddc1218c9e43e5258c1fbfb1565ca89b70fa4b228fcf68712a0ec700e4`<br>`rules.mjs` `23795d99a24322d71b49a7e1afb8e094e7fae4d3c8d467d368d041c1a6e113bc`<br>`config.json` `15db41473f1a0b4ed87ec5a6d4c0f391ce6e5eea2ec4ab289e400401da2bb60a`<br>`issue-policy.yml` `de2424286ffab155f9a45df2134a0ae5a1fd5a518d713f66fe66a982b3635e82` |
| 复算命令 | §6（逐条可重放；`--stage N` 即复现表中任一行） |

---

## 1. 结论摘要：会拦多少

| 级别 | 启用规则 | **被拦 PR / 分母 124** | 占比 | finding 合计 | block | warn |
|---|---|---|---|---|---|---|
| **S1** | 仅「PR 未引用任何 Issue」 | **51 / 124** | 41.1% | 51 | 51 | 0 |
| **S2** | S1 + `kind/*` 分类标签 | **123 / 124** | 99.2% | 174 | 174 | 0 |
| **S3** | S2 + 优先级 `p0–p3` | **123 / 124** | 99.2% | 297 | 297 | 0 |
| **S4** | S3 + `area/*` + 正文段落 + 占位残留 | **123 / 124** | 99.2% | 543 | 297 | 246 |

**三条必须先看清的事实（否则会误读上表）**

1. **S2 的唯一"通过者"是假通过**：`#799` 之所以过，是因为它是 **draft**（draft 豁免标签类规则），
   而它的标签只有 `积压:疑似撞号`。**取消 draft 后它同样被拦** ⇒ 真实口径是
   **「非 draft PR：S2 下 0/123 通过」**。
2. **全仓 `kind/*` / `area/*` / `p0–p3` 实例数 = 0**（124 个 PR 的全部标签里，只有 `积压:*` 五类，共 82 个实例）。
   ⇒ 任何"要求分类/优先级标签"的级别，**首日命中率必然 ~100%**，这与 PR 质量无关，是"标签体系尚未启用"。
3. **S1 是唯一"现在就有一半以上能合规"的级别**（75/124 = 59.5% 已带 Issue 引用），
   所以**分级起点应当是 S1，而不是从 S2 起**。

---

## 2. 分级方案（可执行 + 每级实测命中数）

分级不是文字建议，而是**已落进配置的预设** `config.json → stages.N.enable`，
执行体 `--stage N` 只启用该级列出的规则（未列出者**显式 disabled**，不残留半开状态）。

| 级别 | 标签 | 被拦 PR | 建议动作 |
|---|---|---|---|
| **S1** | 第 1 级 · 只报「PR 未引用任何 Issue」 | **51/124** | **建议从本级起步**：只要求可追溯性，一条 `Closes #N` 即可消解；不要求任何人补历史标签 |
| **S2** | 第 2 级 · + `kind/*` 分类 | **123/124**（非 draft 0/123 通过） | **前置条件**：先给 `kind/*` 标签体系做一次存量补齐（或先只对**新建** PR 生效），否则本级等于全量拦截 |
| **S3** | 第 3 级 · + 优先级 `p0–p3` | **123/124** | 同上；优先级还需与 `积压:*` 的既有三档（可合/可关/在制）做口径合并，否则两套标签并存 |
| **S4** | 第 4 级 · + `area/*` + 正文段落 + 占位 | 123 block + **246 warn** | warn 面同样值得先看：`requiredSections` 命中 **120**（正文缺 `## 变更说明` 段）、`placeholderLeft` 命中 **3** |

**推荐路线（供 CTO 裁）**：`S1 软上线观察 1~2 周` → 期间补 `kind/*` 存量标签 → `S2` → 补优先级 → `S3`。
**不建议**跳过 S1 直接 S2：那会把"未用标签"与"未引 Issue"两个不同性质的问题混成一堵 100% 的墙，
必然导致门禁被绕过（V3.9 教训：不可达的硬阻断 = 必然被 bypass）。

---

## 3. 拦的是哪一类（分类，不只给数）

### 3.1 S1 的 51 个（未引用任何 Issue）× 标题前缀

| 分类 | 数量 | 说明 |
|---|---|---|
| `docs` | **21** | 治理/派单/证据类文档件 —— 本仓 PR 的主体 |
| `feat` | 9 | 功能件 |
| `fix` | 7 | 修复件 |
| `chore` | 6 | 杂务/归档/依赖 |
| 无前缀 | 3 | `P0定位(D1018)…`、`D1024 条件③…`、`X30 v2 落地…` |
| `test` | 2 | 测试件 |
| `audit` / `tests` / `verify` | 各 1 | 审计与验证件 |
| **draft** | **0** | 51 个全部**不是** draft ⇒ 不存在"用 draft 拖着不修"的情形 |

### 3.2 S2 增量：**有引用但缺 `kind/*`** 的 72 个（= 123 − 51）

| 分类 | 数量 |
|---|---|
| `docs` | 34 |
| `feat` | 14 |
| `fix` | 13 |
| `chore` | 5 |
| 无前缀 | 4 |
| `ci` | 2 |

⇒ **这 72 个说明**：加一层"要求标签"的规则，代价并不落在"没写引用"的那批人身上，
而是**落在全仓所有人身上**（因为标签体系从未启用）。这正是必须分级的量化依据。

---

## 4. 每条被拦的具体原因 + 修复动作（规则级）

| 规则 | 级别 | 命中 PR 数 | 具体原因 | 修复动作（逐条可执行） |
|---|---|---|---|---|
| `linkedIssue` | block | **51** | PR `title + body` 中匹配不到任何 Issue 引用（接受 `#123` 与 `owner/repo#123`；**紧贴字母的 `abc#12` 不算**，见单测边界用例） | 在 PR 正文加一行 `Closes #<号>` 或 `Refs #<号>` |
| `typeLabel` | block | **123** | 缺 `kind/*` 标签（全仓 0 实例）；或 `kind/*` **数量 ≠ 1** | 加**恰好一个** `kind/feature` \| `kind/bug-fix` \| `kind/doc` \| `kind/testing` \| `kind/cleanup` |
| `priorityLabel` | block | **123** | 缺 `p0`–`p3` 标签（全仓 0 实例） | 加一个优先级标签 |
| `areaLabel` | warn | **123** | 缺 `area/*` 标签（全仓 0 实例） | 加一个 `area/ci` \| `area/docs` \| `area/dispatch` \| `area/runtime` \| `area/domain` |
| `requiredSections` | warn | **120** | 正文缺 `## 变更说明` 段（`.github/pull_request_template.md` 里有该段，实测绝大多数 PR 未保留标题） | 按模板补回 `## 变更说明` 并写实质内容 |
| `placeholderLeft` | warn | **3** | 正文残留模板 HTML 占位注释（`<!-- 简要描述此 PR 做了什么… -->` 等） | 删除占位注释，替换为实质内容 |

**draft 豁免**（已在配置里显式声明，非隐含）：draft PR 跳过 `typeLabel` / `priorityLabel` / `areaLabel` /
`requiredSections` / `placeholderLeft`，但 **`linkedIssue` 不豁免**（"可追溯性"对草稿同样成立）。
`#799` 即此豁免的唯一实例。

---

## 5. 🔴 专节：`ISSUE_TEMPLATE` 未在 `main` ⇒ 本门禁的**开发者入口缺失**

**实测**：`git ls-tree -r --name-only origin/main -- .github/ISSUE_TEMPLATE/` → **0 个文件**（复核一致）。
建 issue 模板目前只在**未合并分支**上。这会造成三层后果：

1. **入口缺失 = 政策注定打补丁而非被满足**。规则要 `kind/*` / `p0–p3`，但新建 Issue/PR 的表单**不提示**
   该选什么、可选值有哪些（闭集在哪）⇒ 开发者只能靠 PR 被挂红后反推 ⇒ 学习成本从"填表单"变成"试错"。
2. **S1 的 51 个命中会持续再生**。缺 `Closes #N` 不是能力问题而是**提示问题**：模板若含
   "本 PR 关闭/引用哪个 Issue？"一栏，填写率会立刻上升；没有模板，这条规则就在跟"默认行为"对抗。
3. **与本卡的软上线叠加风险**：S1 命中 41% 且都是"本可避免"的，若同时缺模板提示，
   观察期数据会被"提示缺失"污染，**无法区分"政策不合理"与"入口没给"** ⇒ 分级决策会失真。

**建议（不属本卡写集，转 CTO/相应卡）**：`ISSUE_TEMPLATE` 与该门禁**同批上线**，
或在模板落地前**不要**把任何标签类规则（S2+）转必过。

---

## 6. 复算方法（逐条可重放）

```bash
# ① 取数（分母）
gh pr list --state open --limit 200 \
  --json number,title,body,labels,isDraft,createdAt,headRefName,author,url > prs.json

# ② 单级复算（把 N 换成 1/2/3/4，即复现 §1 表中任一行）
node .github/issue-management/policy.mjs --batch prs.json --stage N --json
#   → 关注两行: POLICY_SUMMARY: … block=… prs=… mode=informational stage=N
#                POLICY_JSON={…}   （逐 PR findings，用于 §3 分类与点名）

# ③ 单 PR 复算（把某个 PR 的 JSON 单独喂进去）
node .github/issue-management/policy.mjs --payload one-pr.json

# ④ 单测（25 用例，含 informational 恒 exit 0 / blocking exit 1 / 缺输入 exit 2 三条进程级契约）
node --test tests/issue-management/*.test.mjs
```

**判定口径说明**：`--batch` 输出的 `block=` 是 **finding 条数**；§1 表的"被拦 PR"是
**含 ≥1 条 block 级 finding 的 PR 数**（同一 PR 可命中多条规则，故 finding 数 > PR 数）。

---

## 7. 本卡的已知边界与未接线项（如实登记，不掩饰）

1. **本检查当前非必过**：`Issue policy` 不在 12 条必需集内（`scripts/control-tower/required-checks-baseline.txt`
   逐条比对，无同名项）；`config.json → enforcement.mode = "informational"` ⇒ **有 block 级违规也 exit 0**。
2. **单测未进 CI 密封面**：`tests/issue-management/*.test.mjs` 的扩展名不在
   `check-gate-integrity.sh` 的密封面正则 `\.test\.(sh|py)$` 内 ⇒ 棘轮不会要求登记，**但也意味着它不在 CI 自动跑**。
   本卡 `ci.yml` 冻结（单写者序列）⇒ **登记进 CI 属另卡**。这条是**已知缺口**，不是"已接线"。
3. **阶段 2 规则 `linkedIssueLabels` 当前 disabled**：启用需读 Issue 标签（`issues: read` 权限）
   与一份 issue 元数据输入；代码路径与单测已就位，**配置关闭** ⇒ 故本 workflow 的 `permissions` 只需 `contents: read`。
4. **`requiredSections` 只校验 `## 变更说明`**：模板里的 `## 受影响的铁律` 等未纳入必查（避免首日 warn 噪音叠加）；
   纳入与否见 §2 S4 行。
5. **本报告与策略件都不在 `main`**：见 §0 —— 分支 HEAD 不是锚，锚是 §0 的 sha256 与 `as_of`。

---

## 8. 附：51 个 S1 命中 PR 逐一点名（供逐条核查）

`#611 #615 #623 #657 #662 #693 #722 #723 #724 #738 #742 #756 #764 #766 #792 #793 #794 #798 #807 #808`
`#809 #811 #837 #842 #844 #845 #852 #854 #855 #857 #858 #862 #863 #868 #870 #873 #877 #885 #888 #889`
`#890 #891 #893 #899 #903 #906 #919 #931 #945 #946 #947`

（共 51 个；与 §3.1 分类同源。`#946` 为本线 D1122 卡自身的 PR —— 门禁对自己同样生效，未做任何自豁免。）
