# #1125 写集门禁补删除项语义：变更集补 D ＋ 带状态判（不再对"声明删除"假红）

- **状态**: proposed（本批实现已落同一 commit；迁移 implemented/ 由 L1 收件闸 ＋ K3 追认决定）
- **任务**: #1125（分支 `fix/1125-dev-doc-writeset`，base `gitea/main` = 94ed76b2d）
- **日期**: 2026-10-29
- **#CRITERIA**: D
- **架构层**: 不属五层业务（治理脚本）

## 四态

| 态 | 内容 |
|---|---|
| **现状（改前）** | `scripts/workflow/check-dev-doc-write-set.sh` 取变更集用 `--diff-filter=ACMR`（不含 D），正向判据走 `--name-only`；`git mv` 在重命名检测下 `--name-only` 只报新路径 ⇒ 旧路径不可见 ⇒ 声明「删除」的写集条目被判「文件不存在」，**永远假红 exit 1**。反向对账（python 侧）同样不含 D ⇒ 删除类变更对"改了没登记"不可见。 |
| **决定** | ① 三处变更集补 `D`（doc 发现 / 状态表 / 反向对账）；② 正向判据改为**带状态**：`git diff --name-status --diff-filter=ACMRD --no-renames`（staged ∪ worktree-vs-HEAD），**D ⇒ 声明删除成立且免存在性检查**，A/C/M/R/T ⇒ 声明修改/新建成立；③ 既不命中变更集、也非 gitignore ⇒ 仍判「声明修改但零实际变更」（判别力保留）；④ git 不可用（非 git 仓 / `GIT_DIR` 损坏）⇒ **exit 2**（三态，判不了 ≠ 通过）。 |
| **依据** | 实测（本支 base）：`git mv a.md b.md` 下 `--name-only --diff-filter=ACMR` 只输出 `b.md`；`--name-only --diff-filter=ACMRD` 仍只输出 `b.md`（重命名检测把旧路径吞了）；只有 `--name-status --no-renames` 才得到 `D a.md` / `A b.md` 两行。**⇒ 只补 D 不换取数形态 = 假修**，故本卡同时把正向判据换成带状态取数（这一条是承重项，测试用「去掉 D 的改坏版」钉住）。非 git 目录 / 坏 `GIT_DIR` 下 `git diff` rc=129、`git rev-parse --git-dir` rc=128 ⇒ 旧实现静默当"无变更"。 |
| **生效时点** | 本 commit 起。语义修复无逃生开关（判据本身即修复，回滚 = revert）；不改门禁组数、不改 pre-commit 接线。 |

## 为什么不是"只补 D 一行"

- 只把 `ACMR` 改 `ACMRD`：`--name-only` 在 `git mv` 下**依旧看不到旧路径** ⇒ 夹具A 仍红。
  实测三形态（本卡证据）：

  | 取数 | `git mv a.md b.md` 的输出 |
  |---|---|
  | `--name-only --diff-filter=ACMR` | `b.md` |
  | `--name-only --diff-filter=ACMRD` | `b.md` |
  | `--name-status --diff-filter=ACMRD --no-renames` | `D  a.md` ＋ `A  b.md` |

- 且 `--name-only` 不带状态 ⇒ 无法区分「D 删除声明成立」与「A/C/M/R 修改声明成立」，
  只能复刻旧口径（"出现过就算命中"），无法实现本卡要求的语义。

## 判别力（改坏即红，测试钉住）

| 夹具 | 场景 | 期望 | 实测 |
|---|---|---|---|
| A | 声明 `a.md`(删除) ＋ 实际 `git mv a.md b.md` | exit 0 | **0** |
| A-改坏 | 同上，跑「三处去掉 D」的副本 | exit 1 点名 a.md | **1** |
| D | 纯删除（`rm` ＋ add）声明 `d.md`(删除) | exit 0 | **0** |
| B | 声明 `c.md`(修改) ＋ 零变更 | exit 1（零实际变更） | **1** |
| B2 | 真改 `c.md` ＋ 声明(修改) | exit 0 | **0** |
| C1 | 非 git 目录 | exit 2 | **2** |
| C2 | `GIT_DIR` 指向不存在 | exit 2 | **2** |

既有 4 件引用本门禁的测试（`check-dev-doc-write-set` / `write-set-check` / `writeset-c6-gatekeeper` /
`doc-commit-exempt`）全部 0 失败；本测试件 6 例 → **15 例**。

## 已知限制（禁读成"已判操作类型"）

1. **不消费写集表的「操作」列**：该列是人读散文（存量实测含 `修改：真实暴露缺失时…` 这类带说明的取值），
   机器单源解析器 `devdoc_writeset.py` 只输出路径。⇒ 判据是「路径 × 变更状态」，**不区分**
   「声明修改」与「声明删除」：同一路径以 D 出现即算命中。要按操作严格判，须先让解析器输出操作列（另卡）。
   **代价如实写**：改前"声明修改但文件被删（staged D）"会经存在性检查判红；改后该路径以 D 命中 ⇒ 不再判红。
2. 反向对账只覆盖代码类扩展名（`.ts/.tsx/.js/.jsx/.py/.sh/.json`）＋既有豁免前缀（本卡未改其覆盖面）。
3. 正向匹配沿用改前的 `grep -F` **子串**口径（避免误伤"写集只写裸文件名"的历史 doc），
   不是严格路径相等 —— 该口径不在本卡范围。
4. 既有 cosmetic：`声明 N 条 | 漂移 M 条` 一行在漂移为 0 时会多打印一个 `0`（`grep -c` 的 0 与 exit 1
   叠加），属改前既有、本卡未动。

## 失效条件

- 当 `devdoc_writeset.py` 输出「操作」列并成为单一事实源时，本条「不区分操作」的限制失效，
  届时把正向判据升级为「声明删除 ⇔ D；声明修改 ⇔ A/C/M/R」严格配对。
- 当写集表格式废弃（改用机器生成写集，如 `declare-write-set.sh`）时，本判据整体退役。
