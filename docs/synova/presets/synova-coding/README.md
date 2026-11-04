# synova-coding — 编码 session 预设（能力说明）

> **这份文件回答三个问题**：我们有什么？它解决什么？怎么用/怎么验？
> 读者：任何要写代码的 session（人或 agent）、要派编码活的 L1、要验收的 CTO/K3。

---

## 一句话

给**普通编码 session** 一个可加载的预设：**开工那一刻，纪律和标准就已经在上下文里** —— 不需要它自己去翻文档，也不需要门禁事后追着打。

---

## 解决什么问题（为什么有它）

**病根**：一周的返工不是因为门禁太少/太坏，而是**判定位置太靠后**——门禁只在提交之后判"事实"，
而 agent 在开工那一刻并不知道：文件该放哪、命名怎么起、证据怎么锚、什么算"不适用"。
于是同一个错误，被同一批门禁反复判了几百次。

**证据（实测）**：旧版 persona 只有「去读 6 个 skill」的指针，用四问去测：

| 问 | 旧版命中 |
|---|---|
| 给控制塔脚本加检查要同改哪些文件 | ❌ |
| 豁免件的文件名与每行格式 | ❌ |
| 怎么证明判据没被改坏 | ❌ |
| 新增一行 `2>/dev/null` 要注意什么 | ❌ |

⇒ **0/4**。所以这一版把**答案**写进了 persona（见下「里面有什么」）。

---

## 里面有什么（三件套 ＋ 一处指针）

### ① 预设本体（D0 层 · 零成本）

`docs/synova/presets/synova-coding/` —— 4 个文件：

| 文件 | 行数 | 作用 |
|---|---|---|
| `package.json` | 7 | 声明 `dsh.bundle.patch → ./cordis.patch.yml`，DSH 启动自动发现（不需要改任何注册表） |
| `cordis.patch.yml` | **203** | 插件面 ＋ 人格面：**开工必读 6 项**／**开工四问答案块**／任务 SOP ⓪–⑩／纪律红线／技能路由 |
| `preset.yml` | 2 | 选择器里的标签 `🛠 Synova 编码执行` |
| `README.md` | 本文件 | 能力说明（你在读的这个） |

**persona 里的「开工四问」是这版的重点**（+20 行，2026-11-03 加）—— 直接给答案，不让 agent 现查：

```
① 文件放哪：门禁脚本 scripts/control-tower/<name>.sh｜配对测试 tests/control-tower/<name>.test.sh（同名）
            豁免件 gate-exemptions/<日期>-<issue>-<slug>.md｜Note memory/notes/proposed/｜claim .claude/claims/<issue>.yaml
② 怎么命名：一律带 Issue 号；分支 ct/<issue>-<slug>；commit type(#issue): …；新豁免件同批登 DOCS-REGISTRY
③ 证据怎么锚：path:line@<sha>（7-9 位）｜三态 0/1/2（2=判不了≠通过）｜改坏必红贴原始输出｜降级必须 E_<CODE>+JSON 日志
④ 什么会红：新增 2>/dev/null 需同行 swallow-ok｜python3 探测行带 PYBIN｜改控制塔脚本须更新同名测试（CT-40）
```

### ② 两个 skill（D2 层 · 读一次的成本）

| skill | 作用（只放机检抓不到的语义） | 位置 |
|---|---|---|
| `squad-discipline` | 行为纪律：锚定三问／Done 标准／证据汇报／分支纪律（禁直推 main、禁 force push、禁 stash）／防跑偏 | `.dsh/skills/squad-discipline/`（镜像 `.synova/skills/`） |
| `dsh-code-standards` | 代码标准 8 项（typed error／schema／invariant／fail loud／explicit authority／JSDoc／design philosophy／测试配对）＋ 4 条必复用约定（三态／@降级＋degraded log／UTF-8／判别力自检），**每项带 DSH 源码 file:line** | 同上 |

> 🔴 设计原则：**skill 是唯一事实源，预设只放指针**，不复制正文（复制必然漂移）。

### ③ 一处指针（保险丝）

`AGENTS.md` 里有 3 行「编码任务开工必读」——**即使预设没被加载**（例如在别的预设里干活），也有一条路把它指向这两个 skill。

---

## 怎么装（唯一入口，别手拷）

```bash
bash scripts/control-tower/install-dsh-preset.sh --install synova-coding
# 然后重启 DSH —— bundle 是启动时叠加进 cordis 树的，只对新会话生效
```

安装器会做三件事（**三处都写才叫装上**）：
1. 包目录放进 `<DSH_HOME>/profiles/<profile>/node_modules/@local/dsh-preset-synova-coding/`
2. profile `package.json` 的 **`dependencies`**（`file:` 指向本仓源目录）
3. profile `package.json` 的 **`dsh.profile.bundles`** 追加一行

> ⚠️ 只写 `bundles` 不写 `dependencies` 的后果：profile 重装/prune 时包被当"多余"清掉，**选择器里消失且没有诊断**（2026-11-03 实际踩过，已修在安装器里）。

---

## 怎么验（四步，全可复制）

```bash
# ① 仓源形态合规
bash scripts/control-tower/check-preset-bundles.sh --repo
#   期望：REPO-OK: synova-coding package.json + ./cordis.patch.yml 形态合规

# ② 已装且两处登记都齐
bash scripts/control-tower/install-dsh-preset.sh --check synova-coding
#   期望：SYNC-OK（无 INSTALL-DRIFT）

# ③ 已装件 vs 仓源逐字节一致
bash scripts/control-tower/check-preset-bundles.sh --consistency synova-coding
#   期望：CONSISTENT: synova-coding bundle 层与仓库源逐字节一致
```

**④ 内容验收（只能在新会话里做，这是"目的达成"的唯一判据）**
重启 DSH → 新开会话 → 选择器选 `🛠 Synova 编码执行` → 连问四句：
> ① 给控制塔脚本加一个检查，要同时改哪些文件？
> ② 豁免件的文件名和每行格式？
> ③ 怎么证明你的判据没被改坏？
> ④ 新增一行 `2>/dev/null` 要注意什么？

**四问全答对（带路径/字段名）⇒ 这个预设才有存在价值**；答不全 ⇒ 说明 persona 内容不够，回去补。

---

## 它不做什么（边界，别误会）

- ❌ **它不是门禁**：不阻断任何提交、不进 pre-commit、不占 45 配额。
- ❌ **它不减少门禁数量**：它是"退门禁"的**前置条件**——先把「做对」的路铺好，退 D3 才不会退成事故。
- ❌ **它只做实现**：不判"通过"（通过归 L1 收件 ＋ K3）、不写规格、不做审计、不带队。
- ❌ **它不管别的 session**：只对新开的、选了它的会话生效；已开会话保留启动时的插件修订。
- ⚠️ **它会漂移**：persona 里那 20 行答案是"快照"，门禁语义一改它就可能过期 ⇒ 改门禁判据的 PR 有责任顺手看一眼这块。

---

## 出处与变更（谁改了什么）

| 时间 | 内容 | 卡/PR |
|---|---|---|
| 2026-11-03 | 预设四件首次入库（persona 183 行）＋ `AGENTS.md` 指针 ＋ 两个 skill 证据锚点校准到 v2.0.1-rc.2 真实路径 | #1311 |
| 2026-11-03 | **persona +20 行（「开工四问」答案块，183→203）**；安装器补 `dependencies`；豁免件与登记 | #1311 / PR #1316 |

**相关但独立的交付**（同一夜，供参考别混淆）：
- 门禁侧改动（K3 阻断级 3 条：逐组耗时／`L_FIELDS`／`measured_at` 漂移）—— #1296 / PR #1297
- D734 判据改版（件数软提示／跨域硬阻断／分段计划表）—— #1299 / PR #1308

---

## 已知限制

1. **只对新会话生效** —— 装完必须重启 DSH；老会话里看不到。
2. **`dependencies` 的 `file:` 指向本仓路径** —— 仓库换位置/换机器后需重跑一次 `--install`。
3. **persona 是快照** —— 不进机检，靠 PR 评审兜漂移。
4. **四问验收靠人** —— 没有自动判据能证明"它真的让 agent 少返工了"；只能靠新会话实测 + 事后统计返工率。
