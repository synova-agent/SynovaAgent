---
状态: proposed
日期: 2026-10-06
决策: G12 认领判据从「只看文件名日期窗口」改为「与 resolve-commit-brief.sh 同源的认领池（窗口 ∪ D# 身份锚点 ∪ 本提交携带的唯一 brief）」，日期窗口保留不整体放宽
理由: ① 认领关系是 (brief, file) 的属性，与"今天"无关；日期窗口本是性能/陈旧护栏，被误用成认领语义；② 同仓库 resolve-commit-brief.sh 的 D718 锚点已解同型问题（其注释明确否决"窗口整体放宽"），G12 是漏打同款补丁的第二份副本；③ 统一到单一语义源，避免第二副本继续漂移
---

# Note: D1162 — G12 跨天分支假红：判据提案（送审件 · 未裁不落地）

- 作者: 治理线（deepseek-flash）｜派单: CTO 指令 A1（2026-10-06）｜相关 D#: D1162
- 触发: 两个总闸（#973 循环点火 + 进化回写）因 PR #1009 无法过闸，第 2 批开不了工
- tag: [governance, gate, g12, control-tower, claim, crossday, proposal]

## 〇、三句话结论

1. **缺陷成立**，且比派单描述更严重：同一天内 G12 会**两种失效态并存** —— CI 上"假红"（61 个在飞 PR、318 个文件被误判越界，2026-10-06T03:17 实测），本地/无窗口内 brief 的树上"fail-open"（整段跳过，静默放行）。
2. **但"修窗口 ⇒ 解锁第 2 批"不成立**：实测把窗口修好后，#1009 仍剩 **2 条真越界**（两个探针文件确实不在写集声明里）。主链是 A2（改名 + 写集补登 + 删探针）解的，可核。
3. **不建议新造判据**：仓库里 `resolve-commit-brief.sh` 的 **D718 身份锚点**已经把这事解过一遍（同一天另一份副本），G12 是漏打补丁的那份。推荐 **同源化**（方案 P，见 §3），而不是在 G12 里再加一套日期规则。

需要 CTO 裁的 3 点（其余我自决）：
- **裁点 1**：判据取 §3 的 **P**（同源 + 本提交携带 brief 入池），还是只取 (a)/(c)？
- **裁点 2**：若采纳 P，**是否允许**在 `resolve-commit-brief.sh` 上新增 `--pool` 只读模式（生产脚本改动 ⇒ 需 K3 过审；这是本提案唯一的接口新增）。
- **裁点 3**：`g12-day-window.test.sh`（既有夹具）**重写判定逻辑**而非提取原文，属"判据漂移抓不到"的同族隐患 —— 是否并入同一修复卡（我建议并，代价：多 1 个测试文件改动）。

## 一、缺陷物理证据（可复跑）

🔴 **断面 = `origin/main@74eb6c44cd05c6f172cd5ce8cc596336821cd9be`（2026-10-06 02:26:25 +0800）**。
本文**全部** file:line 均以 `git show origin/main:<path>` 逐条核对；核对命令见本表下方（V-01 可复跑）。
（更正自 v1：v1 误用了**治理线工作树**的行号却未标断面 —— 该工作树当时驻留在另一条分支上，
`pre-commit-check.sh` 是 1616 行版、main 是 1794 行版，两版行号不可混用。CTO 复核指出的 `:1272-1393` / `:770-775` 即此误（均为该 1616 行版的治理线编号；**main 断面真值见下表**）。）

| 元素 | 文件 | 断面行号 |
|---|---|---|
| 认领池 + 认领判定**完整段**（夹具提取范围） | `scripts/pre-commit-check.sh` | **:1432-1545** |
| `CUR_BRIEF_PATH` 段（session 专属优先 → 全局回退） | 同上 | :1432-1445 |
| 🔴 第二道同日门 `_cb_date != TODAY ⇒ 陈旧的 current-brief，忽略它` | 同上 | **:1440-1441**（⇒ 选项 (c) 按字面是 no-op） |
| `TODAY_DASH` | 同上 | :1451 |
| 窗口定义 `DAY_WINDOW_RE` = python3 `date.today()` ±1 天 ERE | 同上 | **:1461-1465** |
| `today_files_by_prefix()`（按文件名日期前缀过滤） | 同上 | :1466-1478 |
| 认领池 `ALL_TODAY_BRIEFS` + 兜底（**池空才**用 `CUR_BRIEF_PATH`） | 同上 | **:1479-1480** |
| 认领判定 `if` 块（生成 `SCOPE_VIOLATION`） | 同上 | :1483-1545（其中 python 段 :1505-1543） |
| 结论**消费面**（D1148 并入合并声明检查 `DECL2`，不再单独 `decl_check`） | 同上 | :1568（⇒ 判据本体不变、消费面变了，影响断言写法，见 §四） |
| 同脚本**第二份**认领实现 = resolver 调用点 | 同上 | **:869** |
| D718 身份锚点块（强/弱锚点定义；**「不做窗口整体放宽」否决语**） | `scripts/workflow/resolve-commit-brief.sh` | :68-104（否决语 :75；锚点 :77-104） |
| resolver 候选池 = 窗口 ∪ 强锚点 ∪ 弱锚点 | 同上 | :147-151 |
| `parse_q2()`（写集解析：:107-110 剥动词前缀 / :113-114 剥括号 / :115-118 剥行号） | `scripts/control-tower/brief_parser.py` | :74-126 |
| `match_path()` = `(^|/)pat$` | 同上 | :203-205 |

```bash
# 断面与逐条行号的自核命令（可复跑）
git show origin/main:scripts/pre-commit-check.sh | wc -l            # → 1794
git show origin/main:scripts/pre-commit-check.sh | grep -nE '^CUR_BRIEF_PATH=""$|_cb_date=|^DAY_WINDOW_RE=|^today_files_by_prefix\(\)|^ALL_TODAY_BRIEFS=|^if \[ -n "\$ALL_TODAY_BRIEFS" \]|resolve-commit-brief.sh'
git show origin/main:scripts/workflow/resolve-commit-brief.sh | grep -nE 'D718|^ALL_TODAY=\$\(today_files_by_prefix'
# 段尾 fi（配对）：awk -v b=<1483> 'NR>b && /^fi$/{print NR; exit}'
```

**复跑命令**（夹具 + 生产原文，见 §4）：

```bash
bash tests/control-tower/g12-crossday-claim.test.sh; echo "exit=$?"      # 修前: 3 通过 3 失败 (A/E/F 红)
```

**#1009 实测（A2 前后，同一份夹具、同一窗口）**：

```bash
# A2 之前的分支头 6c72beb85^（14 文件，brief 日期 10-04）
git diff --name-only origin/main...6c72beb85^ > /tmp/preA2.txt
# 生产脚本: 13 条违规（11 条假红 + 2 条真越界）
# 候选判据 P: 2 条违规 —— 恰好是那 2 个真越界探针
```

实测输出（生产）：`src/loops/loop-execution-wiring.test.ts (不在 Q2 范围内)` 等 11 条 +
`tests/loops/probes/d9-loop-ignition-probe.ts`、`.../feedback-key-write-probe.ts`；
实测输出（P）：**只剩那 2 个探针**。

## 二、对派单前提的两处更正（claim-verifier 复核结论）

| # | 派单原文 | 物理事实 | 证据 |
|---|---|---|---|
| 1 | §0「修好本缺陷 ⇒ 第 2 批开不了工的问题解决」 | **不成立**。修窗口后 #1009 仍红（2 条真越界：两探针不在 brief 写集内）。真解锁靠 A2 | `git show origin/fix/batch0a-gates-l1:.claude/task-briefs/2026-10-04-D1137-batch0a-gates-l1.md` 的 Q2 解析 = 11 条，**不含**两探针；`git diff` = 14 文件 ⇒ 2 条无人认领 |
| 2 | §1 引 CI 日志「loop-execution-wiring.test.ts 不在 Q2 范围内」当作本缺陷证据 | 该**字面量**来自 CTO 本地（今天）复现，方向正确；但 CI 上那条红日志（run 37230203641 / job 111518089746，`2026-10-04T19:58:58Z`）报的是**另 2 个文件**，且当时窗口**含** 10-04 brief ⇒ 那 2 条是**真越界**，不是假红 | 日志原文：`❌ G12: ... 2 处 [硬阻断]` + 两探针路径 |

**第三态（派单未提，我补）**：`ALL_TODAY_BRIEFS` 为空时整个 G12 块被跳过 ⇒ **fail-open**（`soft_pass`，静默放行）。
今天 03:0x 实测：本线工作树 brief 最新 10-04、主仓同 ⇒ **本地 G12 什么都不判**；CI 有 10-05/10-06 brief ⇒ **假红**。同一门禁、同一天、两个相反结果。

**同类错误第 3 次（触发 U5）**：D718 `resolve-commit-brief.sh:68-104`（D664 处置语在 **:71**）已记载 D664 两次「处置 = 把 brief 改名到执行日」；
2026-10-06 02:55 提交 `6c72beb85`「为过 G12 窗口改 brief 名 10-04→10-06」= 第 3 次同款手工绕行。
（附带更正：该提交信息称"非内容变更"，实测写集**新增了 2 行**（两探针的"删除"归属行）+ `loop-execution-wiring.test.ts` 改 1 行 ⇒ "非内容变更"不准确。）

## 三、判据提案：四选项与代价

| 选项 | 语义 | 覆盖 | 代价 / 否决理由 |
|---|---|---|---|
| **(a) 分支名可解析的 brief** | 池 ∪ {分支名中 D# 对应的 brief} | 分支名带 D# 的本地跨天分支 | **成本极低**：`resolve-commit-brief.sh:68-104,147-151` 已实现（D718）。**但覆盖不了 #1009 型**（`fix/batch0a-gates-l1` 无 D#、无 `task-state/D#.json`） |
| **(b) 放宽窗口到最近 N 天** | 池 = 今天±N | 最广 | **否决**：N 无第一性原理依据；`resolve-commit-brief.sh:75` 明确"不做窗口整体放宽（会把**他人**陈旧 brief 拉回池 → D291/D296 跨 session 误伤复发）"；且本卡夹具案例 D 把"30 天前非本分支 brief 不得认领"钉死（N 必须 ≤29，等于把"跨天多久算跨天"变成魔法数） |
| **(c) `CUR_BRIEF_PATH` 优先于今日列表** | current-brief 直通 | ≈0 | **按字面是 no-op**：`pre-commit-check.sh:1440-1441` 对 `_cb_date != TODAY` 的 current-brief 直接丢弃；CI 树上无该文件。若要 (c) 生效必须先拆这道同日门 ⇒ 等于顺手把 (a) 的弱锚点补上（resolver 的弱锚点**不**受同日门限制） |
| **(d) 本提交携带的唯一 brief 入池**（本卡新增） | 池 ∪ {staged `.claude/task-briefs/*.md`，恰 1 份} | **CI/PR 场景**（brief 随提交走） | 低。弱化风险已收窄：只认"**恰 1 份**"，避免一次批量搬动 brief 的 PR 导入多份他人写集 |

### 推荐：方案 P = (a) ∪ (c 的弱锚点形态) ∪ (d)，且**日期窗口保留**

```
认领池 ALL_TODAY_BRIEFS ← 日期窗口(今±1)
                        ∪ 强锚点{分支名 D# 的 brief, 暂存 task-state/D#.json 的 brief}
                        ∪ 弱锚点{current-brief 文件名 D# 的 brief}
                        ∪ (d) 本提交携带的唯一 brief
```
- **不新增判据语义**：前三项与 `resolve-commit-brief.sh:147-151` **逐字同源**，只是 G12 也读它（消灭第二副本）。
- **红线遵守**：日期窗口**不整体去掉**（§4 案例 D 钉死）；越界仍红（案例 B）。
- **接口新增仅 1 处**：分支名来源 `${SYNO_BRANCH:-$(git branch --show-current)}`（沙箱可注入，与既有 `SYNO_*` 注入缝同惯例）。

**预演件与预演结果**（未落地、未送审；仅用于让 CTO/K3 在裁之前就能核判据）：

```bash
# 夹具 × 候选判据 P → 6 通过 0 失败（生产脚本同样跑 → 3 通过 3 失败）
G12_PCC_OVERRIDE=<候选修复脚本> bash tests/control-tower/g12-crossday-claim.test.sh
```

## 四、夹具（改坏即红）与预演口

`tests/control-tower/g12-crossday-claim.test.sh` —— **段提取**生产原文执行（不重写判定逻辑；
既有 `g12-day-window.test.sh` 是重写式，判据改了它不会红）。

| 案例 | 场景 | 期望 | 修前实测 |
|---|---|---|---|
| A | 跨天 brief（今天−2）认领自己写集内的文件 | 无违规 | ❌ 假红 |
| B | 文件不在**任何** brief 写集内（真越界） | 有违规 | ✅ 仍红（反向证明"放宽的是日期，不是范围"） |
| C | 文件被窗口内 brief 认领、又被同一 brief 显式排除 | 有违规 | ✅ 仍红 |
| D | 30 天前、且非本分支可解析的 brief 认领该文件 | 有违规（防"窗口整个去掉"⇒ 旧 brief 永久有效） | ✅ 仍红 |
| E | 目录内零窗口内 brief + 跨天 brief 认领 | 认领池非空且文件被认领（**不许静默跳过**） | ❌ fail-open |
| F | **#1009 主链实景**：分支名无 D# + 唯一 staged brief | 无违规 | ❌ 假红 |

- 断言是**判别性**的：E 不满足于"无违规"，而断言 `ALL_TODAY_BRIEFS` 含该 brief（否则"整段跳过"会假过）。
- 三态退出码：段锚点缺失 / 提取段语法错 ⇒ `exit 2`（检查自身失败，禁 `|| true` 吞掉）。
  **实测生效一次**：首版把终锚写成 `soft_pass "G12: 所有文件均在 Q2 范围内"`（治理线工作树版本存在），
  而在 `origin/main` 上该行已随 **D1148 结论合并**消失 ⇒ 夹具立刻 `exit 2` 并打印 `FATAL: G12 段锚点未命中（S='1432' E=''）`，
  **没有**静默变成"全绿"。改锚「认领判定 if 块的配对 `fi`」后两版皆可跑（断面 main **:1432-1545**）。
  ⇒ 若当初夹具沿用既有 `g12-day-window.test.sh` 的"重写判定逻辑"写法，这次结构变更**零感知**。
- `G12_PCC_OVERRIDE=<脚本>` = 判据预演口（K3/CTO 可在落地前核候选判据）。
- ⚠️ **接入纪律**：夹具**随修复 PR** 落地。修复未落地前它按设计为红 ⇒ **不得单独进 main**（否则 main 恒红）。
  注册点 = `.github/workflows/ci.yml` 的 `for t in \` 密封清单（实测该清单是**显式列表**而非 glob ⇒ 未注册不会被执行，
  只会被 `check-canary-drift.sh` 报一条**非阻断** ::warning）。

## 五、影响面（实数 + 取数命令）

```bash
git fetch --all && python3 tests/control-tower/g12-window-impact-scan.py --json /tmp/g12-impact.json
```

实测（**2026-10-06T03:17:26+0800**，窗口 10-05/06/07，base=origin/main，108 个 open 非草稿 PR）：

> 🔴 **本表 = D1162 定稿口径**（CTO 裁决 §2②）。所有回执、PR 正文、上报件**一律引本表**，不引重跑值。
> 理由：本指标是**活体面**——在飞 PR 被修复/新开会让重跑值漂移（同日 22 分钟后重跑即 60 PR / 307 文件，
> 因 #1009 类被 A2 式处置）。**多引一次 = 多一个口径**（AGENTS.md 引用纪律）。需要新数时：重跑 → 换时间戳 → 作为**新快照**登记，不覆盖本表。

| 口径 | 数 |
|---|---|
| 受假红影响 PR | **61** |
| 假红文件总数（下界，未计排除项违规） | **318** |
| 含真越界 PR（改窗口后**仍应红**） | 8（28 文件） |
| fail-open PR（窗口内零 brief） | 0（CI 实测：main 有 10-05/10-06 brief ⇒ 非空） |

TOP 假红面：`#803 feat/d962-2a-merge`（65 代码文件 / 61 假红）、`#665 team/win-batch14`（20/20）、
`#892 feat/D1066-dashboard-truth`（15/15）、`#881 feat/D1060-synova-workbench`（13/13）。
口径边界（诚实声明）：静态复算 + 本地 ref 快照（非 GitHub 重算）、不计排除项 ⇒ 数字是**下界**。

## 六、送审面（K3 必审清单）

1. 判据 P 的**完备性**：是否仍存在"跨天但无任何 D# 锚点、brief 也不随提交走"的合法场景被误拦？（我认为存在 ⇒ 那是 P 的**已知边界**，须保留 A2 式兜底，不是缺陷）
2. **弱化面**：(d) 让"本提交携带的唯一 brief"获得认领权 ⇒ 构造反例：一个 PR 若同时改 A 文件 + 顺带 restage 一份**他人**旧 brief，是否可借此让 A 文件"被认领"？（建议 K3 专门造此反例）
3. **棘轮**：判据放宽后，"越界仍红"是否真的只靠案例 B/C/D 三条兜住？
4. 是否应把 (a)(d) 与 `resolve-commit-brief.sh` 合并为**同一实现**（`--pool` 模式）而非 G12 内联复制 —— 复制即第二副本，正是本缺陷的成因。

## 七、落地清单（若 CTO 裁 P）

| # | 文件 | 动作 | 责任 |
|---|---|---|---|
| 1 | `scripts/workflow/resolve-commit-brief.sh` | 新增只读 `--pool` 模式（输出候选池）+ (d) | 治理线实施 → K3 过审 |
| 2 | `scripts/pre-commit-check.sh` 组 12（候选池构造段） | 改为消费 `--pool`；保留日期窗口；`SYNO_BRANCH` 注入缝 | 同上 |
| 3 | `tests/control-tower/g12-crossday-claim.test.sh` | 随修复落地 + 注册进 `ci.yml` 密封清单 | 同上 |
| 4 | `tests/control-tower/g12-day-window.test.sh` | 建议同步改为段提取式（裁点 3） | 待裁 |
| 5 | `memory/notes/proposed/*` | 本 Note → `implemented/`（`git mv`） | 落地后 |

**回退条件**：修复后若 CI 出现"真越界被放行"（案例 B 型漏拦）或 `--pool` 输出异常 ⇒ 立即回退组 12 到原实现（改动是**单段替换**，回退成本 = 1 段 revert）。

## 八、未决 / 我不做的事

- **不改任何 `scripts/**` 生产文件**（红线①：门禁语义变更须 提案 → K3 → CTO 裁）。本卡交付 = 提案 + 夹具 + 取数工具 + 实数。
- 不碰 `scripts/audit/**`（K3 域）、不改 `ci.yml` 的 job `name:`（12 必需 context 唯一产出者）。
- 附带发现（**不在本卡范围**，另立卡建议）：`brief_parser.match_path` 对 glob（如 `scripts/**`）做 `re.escape` ⇒
  **glob 声明实际不生效**（`resolve-commit-brief.sh` 一侧同款）。这会让"声明了 `scripts/**` 的 brief"看起来受保护、实际零覆盖 ⇒ 假绿方向。

## 九、本卡执行中**亲身踩到**的两处同族缺陷（新增实证，非推演）

缺陷家族不是"日期窗口"一条，而是「**声明写法 ↔ 判据解析 不匹配 ⇒ 认领失效**」。本卡在提交自己的件时连着踩到两条，
两条都**物理可复跑**，且都不在 CTO 派单范围内：

| # | 形态 | 复跑 | 后果 |
|---|---|---|---|
| ① | Q2 写集行用**反引号**包路径（`` - `tests/x.test.sh` ``）⇒ `brief_parser.parse_q2:74-126`（剥壳段 :107-118）不剥反引号 ⇒ 返回带反引号的"路径" ⇒ `match_path` 恒不匹配 | `python3 scripts/control-tower/brief_parser.py --q2-include <brief>` 看输出是否带 `` ` `` | 认领恒失效 ⇒ **假红**（本卡真实发生：`bash scripts/pre-commit-check.sh` 报 `tests/control-tower/g12-crossday-claim.test.sh (不在 Q2 范围内)`，改裸路径后 `✅ 所有文件均在 Q2 范围内`） |
| ② | 路径自身含**全角括号**（本卡 brief 名 `...（提案）.md`）⇒ `parse_q2:113-114` 的 `re.split(r"[（(]")` 把声明**截断**在该括号处 | 同上，看输出是否为被截断的前缀 | 该行声明**部分失效**；`.claude/` 恰被 `skip_re` 跳过故本卡无害，但同样写法放在 `src/`/`tests/` 上即假红 |

⇒ 支撑 §3 主张：G12 的"声明→认领"链路需要**判别性夹具**（不是"有断言"）+ **单一语义源**；
反引号/括号/glob 这类"写法细节"每一个都是静默失效点，靠人工看文档守不住。

## 十、夹具自证的两处非判别性断言（过程留痕，防"绿得不明不白"）

| 时刻 | 现象 | 处置 |
|---|---|---|
| 首版夹具 | 案例 A/C/D/E 的 brief 用反引号写路径（同 §九①）⇒ 所有 brief 的认领集恒空 ⇒ A 红、C/D "红得对但理由错"（实为"无人认领"而非"排除项生效"/"陈旧未入池"） | 改裸路径后重测：C/D 仍红**且理由正确** |
| 第二版案例 E | 断言仅"无违规" ⇒ "整段跳过(fail-open)" 与 "被正确认领" **同分** = 非判别性 | 加断言 `ALL_TODAY_BRIEFS` 必须含该跨天 brief ⇒ 修前 E 红、预演后 E 绿 |

| 第三处 | 夹具结果回显写 `行 $S..$E）` —— `$E）` 被 bash 解析成变量名 `E）` ⇒ `unbound variable`（**全角标点紧贴变量**，ctrl-tower-change 模式 2；本卡内**第二次**踩到，首跑夹具时同类） | 改 `${E}`，并对全文件做"`$VAR` 紧贴全角标点"批量加固；回显口径同时修为实际提取范围 `S..E`（原 `$((E+1))` 是 off-by-one，与正文 1432-1545 对不上） |

（同类错误第二次 ⇒ 触发 U5：本条属**我自己的**失误，已在夹具内做机械化加固（不只改这一处），不再靠记性。）

（这两处都是"断言存在但不可判别"的 V-02 类问题 —— 与"日期窗口判错"同源：**判据的输入定义错了，断言再全也测不出**。）

## 十一、本卡执行中撞到的第三处同族：门禁自身失败 ≠ 检查未过（三态退出码）

**现象（可复跑）**：`synova-commit` 提交本卡时 pre-push 被 golden-case F1 门禁拒绝，文案为
`❌ 黄金案例 F1 门禁失败 — 诊断质量退化解冻` + `修复 golden-case fixture 或诊断管线后重试`。
**真因**：非交互 shell 的 `PATH` 里没有 nvm 的 `npx`（`bash: npx: command not found`）⇒
`scripts/pre-push-check.sh:276` 的 `if ! npx tsx scripts/ci/golden-case-checker.ts` 把 **127（检查无法执行）** 与
**1（检查发现问题）** 混同 ⇒ 报"诊断质量退化"这一**完全错误的原因**，并把"请修 gate 的运行环境"指向"请修诊断管线"。

```bash
# 复跑（对照）
bash scripts/pre-push-check.sh origin fix/D1162-g12-crossday-claim   # PATH 无 node → 报 golden-case 失败
PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH" npx tsx scripts/ci/golden-case-checker.ts  # → 11/11 全通过
```

**为什么算同族**：A1 的病根是"判据输入（认领者来源）定义错 ⇒ 判错对象"；本条是"判据输入（工具可用性）未区分 ⇒ 报错原因"。
二者都属门禁**三态退出码**纪律（`0=通过 / 1=违规 / 2=检查自身失败（同样阻断但**必须报自己的原因**）`，ctrl-tower-change 模式 1）。
**建议（另立卡，不属 A1）**：`pre-push-check.sh` 对 `npx`/`tsx` 缺失走 `exit 2` 分支并显式打印"检查环境缺失（PATH/node）"，
禁把 127 当"质量退化"上报。**本卡不实施**（改门禁 ⇒ 提案 → K3 → CTO 裁）。
