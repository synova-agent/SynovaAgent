---
状态: proposed
日期: 2026-09-28
决策: 门禁的输入一旦含"VCS 自动生成的标识符"（GitHub 合成 merge 提交主题里的 head/base SHA），判据必须**整体不依赖它**——`merge_writeset_gate.py` 的 D# 推断改为：合成 merge 主题不参与推断 + 正则加 hex 邻接边界 + 裸 SHA 词元判无效 + 输出面 SHA 脱敏；回退链落 `--first-parent` + `merge_base..HEAD` 范围 + 合成 merge 时锚 `HEAD^2`；声明源多命中改 fail-closed 逐条点名。
理由: 旧 `DID_RE = [Dd]\d+` 从 `Merge <head_sha> into <base_sha>` 里抠出伪任务号 ⇒ **同一份代码在不同 SHA 上得出不同 D#**（实测 5 个 SHA → D54 / D4 / D0 / D34 / D34），门禁结论不可复现；且伪号会把声明源对到别的任务上，夹带判定整体失真。
---

# 决策 Note — D1030（CT 系列）门禁推断随机性根治

- 相关 D#: D1030（承接 D708 / D814 / D911 / D954 / D964）
- 分支: `fix/ct-gate-inference-20260927`｜工作树 `.synova-wt-ct-gate`
- 实现者: gate-fix（SynovaAgent 专职小队编码成员）｜独立复核: 待 K3

## 触发场景（实测，非推断）

1. **CT-C（P0，随机性）**：GitHub 对 `pull_request` 事件合成的 merge 提交，主题形如
   `Merge <head_sha> into <base_sha>`，两个载荷**都是十六进制 SHA**。旧 `DID_RE` 从整条主题贪婪取号：
   - 改前 `parse_did("Merge 9e41414096fbfc45b2471a4d54e6244cb73b37db into …")` → **D54**
     （head SHA 的真实片段 `d54`；该 SHA 为暴力构造的真实提交）
   - 端到端（真 git 地形，HEAD = 合成 merge）：5 个不同 SHA → `D54/D4/D0/D34/D34`，**输出逐字节不同**
     （5 个互异 md5）；其中 `D34` 来自 **base SHA** 的 `d34` 片段 —— base 侧同样污染。
2. **CT-A2（静默取一）**：`find_declaration_files()` 用 `hits[-1]` 从多个同名命中里静默取末位
   ⇒ 声明源可能指向**别人的任务**，写集对账整体失真且失败点不可见。
3. **CT-D（粒度）**：`check-pr-budget.sh` 对 `docs/synova/product-lines/evidence/` 是**目录级豁免**，
   实测"13 件 evidence + 12 件代码"在改前 **PASS（exit 0）** ⇒ 目录级豁免成了无界通道；
   且豁免只打印一个**计数**，豁免了哪些文件不可核。
4. **CT-D2（fail-open）**：`doc-registry-gate.sh` 在 git 仓库里只扫 untracked + staged-new，
   CI checkout 后两者皆空 ⇒ 「检查 0 个文档」⇒ 放行（该门禁在 CI 里**从未真正行使**）。

## 关键设计决定

1. **三层收口，逐层可单独回红**：① 合成 merge 主题整体不参与（`is_synthetic_merge_subject`，锚定式，
   只吞 `^Merge <hex> into <hex>$` 与 `^Merge pull request #\d+ from …`，不吞真业务主题）；
   ② `DID_RE` 加 hex 邻接边界 `(?<![0-9a-fA-F])[Dd]\d+(?![0-9a-fA-F])`；
   ③ 候选若**整词元**是 7–40 位裸 SHA → 判无效并继续找下一个候选。
   7 个定点变异各自至少 1 条断言回红（M0 全清 → 10 条红），证明三层都在链上而非装饰。
2. **`--first-parent` 落地（D814 关闭）并补范围**：只沿第一父链 + `git merge-base(base,head)..head`
   两件一起才成立 —— 前者管"走哪条链"，后者管"链走到哪里为止"。
   ⚠️ 合成 merge 的**第一父是 base**，直接对 HEAD 用 `--first-parent` 会走进 main 历史 → 故先锚 `HEAD^2`（PR 自身顶端）。
3. **输出面也脱敏**：诊断行回显的合成 merge 主题里 SHA → `<sha>`。否则"决策一致"不满足判据的**逐字**一致
   （且下游若有工具从 gate 输出抠 `[Dd]\d+`，会再把伪号捡回去）。
   ⇒ 结果：5 个不同 SHA 输出**同一 sha256**。
4. **多命中 fail-closed，不取一个**：新增 `AmbiguousDeclaration` → exit 2 + 逐条点名全部候选 +
   JSON `ambiguous{kind,pattern,candidates}`。理由：多命中时"取一个"等于把声明源随机化，与 CT-C 同族病根。
5. **豁免粒度按语义分流，不搞口径统一**：`merge_writeset_gate.py`（**授权**口径：该文件是否属本 PR 写集）
   **不加** evidence 目录级豁免 —— 否则任何 PR 可静默改写**他人证据**；`check-pr-budget.sh`（**计数**口径）
   **保留**目录级豁免但补 ① 逐条列举 ② 数量阈值（上限 = `--max-files`，复用同一旋钮，不引入新魔数；
   超出只"计入预算"、不单独判红）。

## 参考系

第一性原理（判据必须对"非作者意图的输入"不敏感，否则不可复现）＋ Anthropic 工程基线（判据可证伪 +
判别性夹具必须有反例侧）＋ 开源实证（git 把合成 merge 主题的载荷定义为 object name；`--first-parent`
是标准"只看主干侧"语义）＋ 仓内先例（D814 未落地 / D911-A1 并入历史不得供号 / D954 推断回退 / D964 豁免口径）
→ 结论：合成主题不参与 + hex 边界 + 裸 SHA 判无效 + `--first-parent` + merge-base 范围 + 输出脱敏 + 多命中 fail-closed。

## 自纠留痕（防"夹具假绿"）

CT-C 的 ⑱（`--first-parent` 判别夹具）**首版未给显式提交日期**，同一秒的提交在 `git log` 里次序不定
⇒ **去掉 `--first-parent` 竟偶然仍取到正确 D712（假绿）**。已改为显式
`GIT_AUTHOR_DATE/GIT_COMMITTER_DATE`（10:00 / 11:00 / 12:00）并加"前提守卫"断言（先断言日期序确实把并入侧排在前面）。
同理 CT-D 的基线副本最初缺兄弟依赖 `check-ownership.py`（用 `Path(__file__).resolve()` 反推 REPO_ROOT）
→ 全线 exit 2，**看起来"红"但不是判别性红**；已改为在 /tmp 建同构符号链接树后才做对照。

## 生命周期

`proposed/`（本 Note）→ 待 K3 独立审计通过后 `git mv` 到 `implemented/` 并更新头「状态」；
`task-state/D1030.json` 的 status 同步 `claimed → impl_done`（README 四态迁移规则）。
