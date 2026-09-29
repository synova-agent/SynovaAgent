# CT1 证据 — CT-C（D# 推断随机性根治，P0）+ CT-A2（声明源多命中 fail-closed）+ CT-D（豁免粒度）

> 成员: gate-fix ｜ 任务: task-1 ｜ 分支: `fix/ct-gate-inference-20260927`
> 工作树: `/Users/wane/SynovaAgent/.synova-wt-ct-gate`（唯一写入点；主树零写入）
> 被改文件（4）:
> - `scripts/control-tower/merge_writeset_gate.py`（改前 md5 `e81c12a6f8f094d2dda5766d77ad7e40` → 改后 `ce279f238cad94d7f91c7f3491880904`）
> - `tests/control-tower/merge_writeset_gate.test.sh`（改后 md5 `4cda817b7b3004b71f748d2c555ddb0d`）
> - `scripts/control-tower/check-pr-budget.sh`（改前 md5 `ad14acb17668624a80308dc4478b4d7f` → 改后 `9fa1f2b7ea0e85569246a0145e4c3ce5`）
> - `tests/control-tower/check-pr-budget.test.sh`（改前 md5 `a4b7edafcd50090615121ce512bd63df` → 改后 `df520ef32b6483b36ea5e2c6bb8f5448`）
> 所有数字/输出均为命令原始输出，未手写。

---

## 一、CT-C（P0）：合成 merge 主题里的 SHA 被当成任务号

### 1.1 根因（改前实测）

GitHub 对 `pull_request` 事件**合成**的 merge 提交，主题形如 `Merge <head_sha> into <base_sha>`
（两个载荷都是十六进制 SHA）。旧 `DID_RE = [Dd]\d+` 从整条主题贪婪取号 ⇒ 从 SHA 里抠出伪号。

改前 `parse_did()` 逐例原始输出（探针 `/tmp/ct1fixture/did_probe.py`，同一探针跑改前/改后）：

```
########## 改前 (HEAD 版 merge_writeset_gate.py, md5=e81c12a6f8f094d2dda5766d77ad7e40) ##########
C1-d54-head	'Merge 9e41414096fbfc45b2471a4d54e6244cb73b37db into 760923659e7e28889f7549aaf36458b502eee658'	-> 'D54'
C1b-d54	'Merge 9e41414096fbfc45b2471a4d54e6244cb73b37db into 1234567890abcdef'	-> 'D54'
C2-real-SHA-4afd4ce	'Merge 4afd4ce into 017bef55'	-> 'D4'
C2-real-SHA-5836e434	'Merge 5836e434 into 4afd4ce'	-> 'D4'
C2-real-SHA-d0f6c2f2	'Merge d0f6c2f2 into 1234567'	-> 'D0'
C3-lead-repro-a	'Merge e4dd3d9da1234567890 into 1234567890abcdef'	-> 'D3'
C3-lead-repro-b	'Merge d0f6c2f2efgh into 1234567890abcdef'	-> 'D0'
C3-lead-repro-c	'Merge 800724d8 into 1234567890abcdef'	-> 'D8'
C4-deadbeef	'Merge deadbeef into cafebabe'	-> None
C5-pull-request	'Merge pull request #123 from x/y'	-> None
C6-merge-branch	"Merge branch 'main' into feat/foo"	-> None
C7-real-subject	'docs(D814): 任务号推断修复'	-> 'D814'
C8-branch-lower	'feat/win-d702-write-op-no-swallow'	-> 'D702'
C9-branch-scope	'docs(d702): 补文档'	-> 'D702'
C10-registration	'chore: bypass COMMITTED 登记 (auto hook, D521)'	-> 'D521'
```

`d54` 用例的 head SHA 是**暴力构造的真实提交 SHA**（含 `d54` 且它是首个 `[Dd]\d+` 匹配）：

```
$ （暴力构造脚本原始输出）
tries: 875
clean	760923659e7e28889f7549aaf36458b502eee658
d54	9e41414096fbfc45b2471a4d54e6244cb73b37db
```

### 1.2 改前端到端（真实 git 地形：HEAD = 合成 merge 提交）

地形脚本 `/tmp/ct1fixture/e2e.sh` 构造真仓：base 提交 + 分支提交 `feat(win-d712): declared file`
+ 顶层 `git merge --no-ff feature -m "Merge <SHA> into <BASE>"`（parents = base, feature，与 GitHub 同形）；
分支名 `fix/no-did-anywhere` 不含 D# ⇒ D# **只能**来自提交回退链。

```
########## 改前 ##########
BASE=1c140dca293d34ba15a00d04d7d89a49cb6ef20b
FEATURE=fa1a980313343c1a1f87437c1cf0686426597aa7
--- 改前: 同一份代码 / 3 个不同 SHA（合成 merge 主题不同）---
=== SHA_TEXT=9e41414096fbfc45b2471a4d54e6244cb73b37db  HEAD=3e6932a ===
  task_id=D54 source=commit-subject status=degraded rc-json
  exit=2
=== SHA_TEXT=4afd4ce1  HEAD=65e617d ===
  task_id=D4 source=commit-subject status=degraded rc-json
  exit=2
=== SHA_TEXT=d0f6c2f2  HEAD=8a443f1 ===
  task_id=D0 source=commit-subject status=degraded rc-json
  exit=2
=== SHA_TEXT=017bef55  HEAD=2c40b3f ===
  task_id=D34 source=commit-subject status=degraded rc-json
  exit=2
=== SHA_TEXT=5836e434  HEAD=b3d6d55 ===
  task_id=D34 source=commit-subject status=degraded rc-json
  exit=2
```

⇒ **同一份代码、5 个不同 SHA ⇒ 4 个不同 D#（D54/D4/D0/D34/D34）**。
（注 `017bef55`/`5836e434` 的伪号 `D34` 来自 **base SHA** `1c140dca293d34ba…` 的 `d34` 片段
—— 即 base 侧 SHA 同样会污染，不只是 head 侧。）

### 1.3 修法（三层，逐层单独可回红——见 §三）

| 层 | 落点 | 语义 |
|---|---|---|
| ① 合成 merge 整体不参与 | `is_synthetic_merge_subject()`（`^Merge <hex7-40> into <hex7-40>$` / `^Merge pull request #\d+ from \S+`） | 其载荷按定义是 VCS 元数据（SHA/PR 号），**永远不是**作者写的任务号；**锚定式**只吞这两种 VCS 合成主题，真业务主题不吞 |
| ② 正则加 hex 邻接边界 | `DID_RE = (?<![0-9a-fA-F])[Dd]\d+(?![0-9a-fA-F])` | 紧邻其它十六进制字符的 `d<数字>` 属于一个 hex blob，不是任务号 |
| ③ 裸 SHA 词元判无效 | `_inside_sha_token()` + `SHA_TOKEN_RE`（7–40 位 hex） | 候选**整词元**就是裸 SHA 时（② 对"整词元"两侧都是空格、放行），判无效并继续找下一个候选 |
| ④ 输出面脱敏 | `_redact_hex()` | 诊断行回显的合成 merge 主题里 SHA → `<sha>`（否则"决策一致"仍不满足判据②的**逐字**一致） |
| ⑤ `--first-parent` + merge-base 范围 + 第二父锚点 | `infer_did()` 回退链 | 见 §1.5（D814 落地） |

### 1.4 改后原始输出

```
########## 改后 (md5=5fa42c5471785cb994a64d1c0f03ff02) ##########
C1-d54-head	'Merge 9e41414096fbfc45b2471a4d54e6244cb73b37db into 760923659e7e28889f7549aaf36458b502eee658'	-> None
C1b-d54	'Merge 9e41414096fbfc45b2471a4d54e6244cb73b37db into 1234567890abcdef'	-> None
C2-real-SHA-4afd4ce	'Merge 4afd4ce into 017bef55'	-> None
C2-real-SHA-5836e434	'Merge 5836e434 into 4afd4ce'	-> None
C2-real-SHA-d0f6c2f2	'Merge d0f6c2f2 into 1234567'	-> None
C3-lead-repro-a	'Merge e4dd3d9da1234567890 into 1234567890abcdef'	-> None
C3-lead-repro-b	'Merge d0f6c2f2efgh into 1234567890abcdef'	-> None
C3-lead-repro-c	'Merge 800724d8 into 1234567890abcdef'	-> None
C4-deadbeef	'Merge deadbeef into cafebabe'	-> None
C5-pull-request	'Merge pull request #123 from x/y'	-> None
C6-merge-branch	"Merge branch 'main' into feat/foo"	-> None
C7-real-subject	'docs(D814): 任务号推断修复'	-> 'D814'
C8-branch-lower	'feat/win-d702-write-op-no-swallow'	-> 'D702'
C9-branch-scope	'docs(d702): 补文档'	-> 'D702'
C10-registration	'chore: bypass COMMITTED 登记 (auto hook, D521)'	-> 'D521'
```

改后端到端：

```
########## 改后 ##########
--- 改后: 同一份代码 / 3 个不同 SHA（合成 merge 主题不同）---
=== SHA_TEXT=9e41414096fbfc45b2471a4d54e6244cb73b37db  HEAD=10b3f1c ===
  task_id=D712 source=commit-subject status=pass rc-json
  exit=0
=== SHA_TEXT=4afd4ce1  HEAD=f72fb0a ===
  task_id=D712 source=commit-subject status=pass rc-json
  exit=0
=== SHA_TEXT=d0f6c2f2  HEAD=895d381 ===
  task_id=D712 source=commit-subject status=pass rc-json
  exit=0
=== SHA_TEXT=017bef55  HEAD=e01b5a0 ===
  task_id=D712 source=commit-subject status=pass rc-json
  exit=0
=== SHA_TEXT=5836e434  HEAD=983b1c6 ===
  task_id=D712 source=commit-subject status=pass rc-json
  exit=0
```

⇒ 合成 merge 被识别并锚到**第二父**（PR 自身顶端），从 `feat(win-d712): declared file` 推出 D712。

### 1.5 `--first-parent` 判定结果：**已落地**（D814 落地）

三项一起落地，缺一层即有对应夹具回红：

| 项 | 实现 | 判别性夹具 | 去掉即红（§三） |
|---|---|---|---|
| `--first-parent` | `git log --first-parent …` 只沿第一父链 | 测试 ⑱（兄弟分支提交日期更晚，日期序排在分支自身提交之前） | M4 → `task_id=D999` |
| `merge-base..start` 范围 | `rev_spec = {merge_base}..{start}` | 测试 ⑲（主干祖先提交带 D800 且有声明，分支自身无 D#） | M5 → `task_id=D800` |
| 合成 merge 锚点 `HEAD^2` | HEAD 是合成 merge 时锚到第二父 | 测试 ⑯ | M1 → `task_id=None`（锚点与跳过同时失效） |

> ⚠️ 为何需要锚点：GitHub 合成 merge 的第一父是 **base**、PR 自身提交在**第二父**侧。
> 若直接对 HEAD 用 `--first-parent`，第一步就走进 main 历史（D814 型错锚）。
> 故 `infer_did()` 对合成 merge 先锚到 `HEAD^2` 再按第一父链扫。

### 1.6 硬判据②：同一份代码 × 5 个不同 SHA ⇒ 输出**逐字节一致**

```
########## 改前 ##########
run1  SHA_TEXT=9e41414096fbfc45b2471a4d54e6244cb73b37db   head=7febde4  md5=7dc83772c1aab5021aee81615ff11060
run2  SHA_TEXT=4afd4ce1                                   head=69c68b7  md5=5a23b280fd609395d1e25b90efb2e3cf
run3  SHA_TEXT=5836e434                                   head=ad1f92f  md5=2ce5d5a2873a7b200b5106aef8458bbc
run4  SHA_TEXT=d0f6c2f2                                   head=44ab7b3  md5=b7586b8dc8cdb9de80be9866be88edbc
run5  SHA_TEXT=017bef55                                   head=f4ddbd3  md5=c56093c02c93d46f7e1f776702bb1bcf
--- 逐字节 diff ---
❌ 输出不一致
1c1
< {"component": "merge-writeset-gate", ... "task_id": "D54", ...}
---
> {"component": "merge-writeset-gate", ... "task_id": "D4", ...}

########## 改后 ##########
run1  SHA_TEXT=9e41414096fbfc45b2471a4d54e6244cb73b37db   head=c325cee  md5=4249ee6f119c7f26d1353eddf90d68fb
run2  SHA_TEXT=4afd4ce1                                   head=de6687e  md5=4249ee6f119c7f26d1353eddf90d68fb
run3  SHA_TEXT=5836e434                                   head=d5ee78a  md5=4249ee6f119c7f26d1353eddf90d68fb
run4  SHA_TEXT=d0f6c2f2                                   head=37cf4a4  md5=4249ee6f119c7f26d1353eddf90d68fb
run5  SHA_TEXT=017bef55                                   head=1e243cd  md5=4249ee6f119c7f26d1353eddf90d68fb
--- 规范化对比（去 head 无关字段后 md5）---
458f4453a18d617e1d9fd705853fcfe5
458f4453a18d617e1d9fd705853fcfe5
458f4453a18d617e1d9fd705853fcfe5
458f4453a18d617e1d9fd705853fcfe5
458f4453a18d617e1d9fd705853fcfe5
--- 逐字节 diff ---
✅ 5 份输出逐字节一致（diff -q 全静默）
```

输出原文（5 份中任一份，含锚点/范围/命中三条诊断；SHA 已脱敏为 `<sha>`）：

```json
{"component": "merge-writeset-gate", "status": "pass", "branch": "fix/no-did-anywhere", "base": "ff6af37719c5e76b3bf36b2d7b08c53aff9510c1", "head": "HEAD", "declared": [{"entry": "src/a.ts", "source": "S3:brief.Q2-include"}], "smuggled": [], "exempt": [], "warns": ["PR 正文不可用（--pr-body 未给且无 GITHUB_EVENT_PATH）—— 仅文件声明源生效"], "reason": "提交文件集 ⊆ 声明写集（无夹带）", "merge_base": "ff6af37719c5e76b3bf36b2d7b08c53aff9510c1", "changed_count": 1, "task_id": "D712", "task_id_source": "commit-subject", "task_id_diag": ["源 explicit: 未提供 --did", "源 branch: 分支名 'fix/no-did-anywhere' 不含 D#", "源 commit-subject: HEAD 是合成 merge 提交（主题 'Merge <sha> into <sha>'）→ 锚到第二父 HEAD^2（PR 自身顶端）后再扫，避免走进 base 历史", "源 commit-subject: 扫描范围 `git log --first-parent ff6af37719c5e76b3bf36b2d7b08c53aff9510c1..HEAD^2`（只沿第一父链 = 分支自身提交；base 侧历史不提供 D#）", "源 commit-subject: 扫过 1 条非登记提交后命中 'feat(win-d712): declared file' → D712（已跳过 0 条自动登记影子提交 / 0 条合成 merge 提交）"], "sources": {"task_state": null, "dev_doc": null, "brief": "/tmp/ct1fixture/id-hP3mBf/.claude/task-briefs/2026-09-12-D712-sandbox.md"}}
```

---

## 二、CT-A2：声明源多命中 ⇒ fail-closed + 逐条点名

`find_declaration_files()` 原先 `dd = str(hits[-1])` / `bf = str(hits[-1])` —— **多命中静默取末位**。
改后：多命中抛 `AmbiguousDeclaration`（`GateError` 子类）⇒ `main()` 捕获 ⇒ `exit 2` + `_emit` 逐条点名
+ JSON 输出 `ambiguous{kind,pattern,candidates}`。

夹具（测试 ⑳-1 / ⑳-2）与改后原始输出节选：

```
  ✅ ⑳-1 dev doc 多命中 → exit 2 + 两条候选路径全点名
  ✅ ⑳-1 --json 契约: ambiguous.candidates 恰 2 条
  ✅ ⑳-2 brief 多命中 → exit 2 + 两条候选路径全点名
  ✅ ⑳-2 点名多命中的源（S3 brief）
```

人工跑一次的真实输出（`--json` 原文节选，两条候选路径均在）：

```
"reason": "声明源多命中（S2 dev doc，匹配 SYNOVA-IMPL-*D945*.md）: 2 个候选 → fail-closed，拒绝静默取一个；候选: /tmp/dbg10/docs/plans/codex/implementation/SYNOVA-IMPL-D945-a.md | /tmp/dbg10/docs/plans/codex/implementation/SYNOVA-IMPL-D945-b.md",
"ambiguous": {"kind": "S2 dev doc", "pattern": "SYNOVA-IMPL-*D945*.md", "candidates": ["/tmp/dbg10/docs/plans/codex/implementation/SYNOVA-IMPL-D945-a.md", "/tmp/dbg10/docs/plans/codex/implementation/SYNOVA-IMPL-D945-b.md"]}
```

---

## 三、"改坏即红"判别性夹具（红证原始输出）

方法：`tests/control-tower/merge_writeset_gate.test.sh` 提供注入点
`SYNO_GATE_SRC=<变异副本>`（ctrl-tower-change 模式 5），对 `/tmp` 副本做**定点清除**后跑同一套测试
——**真实仓库文件零改动**。变异脚本 `/tmp/ct1fixture/mutate.sh`。

| 变异 | 定点清除的修复 | 失败断言（原始输出节选） | 结果 |
|---|---|---|---|
| **M0** | 全部（= HEAD 原实现） | `❌ ⑮ BAD: NEG 'Merge 9e4141…d54…'->'D54' ; …`<br>`❌ ⑯ 合成 merge 地形推断错: task_id='D54'`<br>`❌ ⑰ 输出随 SHA 变化（唯一 sha256=5，应为 1）`<br>`❌ ⑲ 主干历史提供了 D#（task_id=D4，期望 None）`<br>`❌ ⑳-1/⑳-2 多命中未 fail-closed` | **10 条红** |
| **M1** | ① 合成 merge 跳过 | `❌ ⑯ 合成 merge 地形推断错: task_id='None' source='none'（期望 D712 commit-subject）` | 1 条红 ✅ |
| **M2** | ② hex 邻接边界 | `❌ ⑮ BAD: NEG 'feat/d54abc-rename'->'D54' ; NEG 'fix: revert d54abcz'->'D54'` | 1 条红 ✅ |
| **M3** | ③ 裸 SHA 词元 | `❌ ⑮ BAD: NEG 'fix: revert d5412345'->'D5412345' ; POS 'fix: revert d5412345 for D999'->'D5412345'（期望 'D999'）` | 1 条红 ✅ |
| **M4** | `--first-parent` | `❌ ⑱ 并入侧 D# 获胜（task_id=D999，期望 D712）` | 1 条红 ✅ |
| **M5** | `merge-base..start` 范围 | `❌ ⑲ 主干历史提供了 D#（task_id=D800，期望 None）` | 1 条红 ✅ |
| **M6** | CT-A2 dev doc 侧 | `❌ ⑳-1 dev doc 多命中未 fail-closed: rc=2`；`❌ ⑳-1 candidates 计数错: 0` | 2 条红 ✅ |
| **M7** | CT-A2 brief 侧 | `❌ ⑳-2 brief 多命中未 fail-closed: rc=0`；`❌ ⑳-2 未点名来源` | 2 条红 ✅ |

变异矩阵汇总（脚本原始输出）：

```
  M1_rule1_off → 失败断言 1 条 ✅变红
  M2_hexboundary_off → 失败断言 1 条 ✅变红
  M3_shatoken_off → 失败断言 1 条 ✅变红
  M4_firstparent_off → 失败断言 1 条 ✅变红
  M5_range_off → 失败断言 1 条 ✅变红
  M6_cta2_off → 失败断言 2 条 ✅变红
  M7_cta2_brief_off → 失败断言 2 条 ✅变红
```

自纠留痕（诚实记录）：⑱ 首版地形未给显式提交日期，同秒提交在 `git log` 里次序不定 ⇒
**去掉 `--first-parent` 竟偶然仍取到 D712（假绿）**。已改为显式
`GIT_AUTHOR_DATE/GIT_COMMITTER_DATE`（10:00 / 11:00 / 12:00），并加"前提守卫"断言
（`⑱ 前提: 日期序把并入侧 d999 排在分支自身提交之前（夹具可判别）`）。

---

## 四、回归与门禁自过

```
$ python3 -c "import py_compile; py_compile.compile('scripts/control-tower/merge_writeset_gate.py', cfile='/tmp/ct1fixture/gate_after.pyc', doraise=True); print('py_compile OK')"
py_compile OK
$ bash tests/control-tower/merge_writeset_gate.test.sh
  结果: 59 通过, 0 失败
$ bash tests/control-tower/check-pr-budget.test.sh
  ✅ 全部通过: 45 项
```

既有 D708/D954 回归面（46 条既有断言）全绿，含 ⑩（`parse_did` 大小写不敏感）、
⑪（回退链跳过登记影子提交 → D712 非 D521）、⑬/⑭（`--did` 覆盖与全空诊断）；
`check-pr-budget.test.sh` 既有 37 条全绿（含 D860 豁免与反例、D758 证据域豁免）。

```
$ bash scripts/workflow/check-silent-swallow.sh --utf8 | grep -E 'merge_writeset_gate'
（无输出 —— 我改的两个文件不在 UTF-8 告警面内）
$ bash scripts/workflow/check-silent-swallow.sh --diff
[silent-swallow] ✅ 无新增 .sh — 跳过
```

```
$ git diff --stat
 scripts/control-tower/check-pr-budget.sh        |  54 ++++-
 scripts/control-tower/merge_writeset_gate.py    | 234 +++++++++++++++++++---
 tests/control-tower/check-pr-budget.test.sh     |  29 ++-
 tests/control-tower/merge_writeset_gate.test.sh | 249 +++++++++++++++++++++++-
 4 files changed, 529 insertions(+), 37 deletions(-)
```

> 注: 本 gate 是 `scripts/control-tower/*.py`，不涉 `.sh` 头块；`--utf8` 报的 17 个 `.sh` 缺头块
> 是**存量**（与本次改动无关，未触碰任何 `.sh`）。

---

## 六、CT-D（task-1 交付 3）：evidence 目录级豁免**粒度**评估

### 6.1 评估对象与结论

| 门禁 | 现有豁免形态 | 结论 |
|---|---|---|
| `merge_writeset_gate.py`（授权口径: 该文件是否属本 PR 写集） | `BUILTIN_EXEMPT` 只有 `.claude/bypass.log` **一条路径级**；`DOC_SCOPE_RE` 含 `docs/` | **不改**（结论 + 三条理由已写进模块头 docstring `CT-D（2026-09-27）评估结论` 段） |
| `check-pr-budget.sh`（计数口径: 是否占 ≤12 文件预算） | `GOV_PREFIX_RE:104` 含 `docs/synova/product-lines/evidence/`（**目录级**） | **改**：保留目录级豁免（不退化路径级白名单）+ 补两条粒度约束 |

**为何两 gate 口径不同不是"不一致"**：一个是**授权**（写集对账要防"静默夹带/改写他人证据"，
故 `evidence/` 目录级豁免 = 开一条任何 PR 可静默改写他人证据的通道 → 不能加）；一个是**计数**
（预算只关心体量，`evidence/` 是 M5 必备产物 → 该豁免）。把计数口径搬到授权口径是语义挪用。

**为何 `check-pr-budget.sh` 不改成路径级白名单**：evidence 文件名按任务定制
（`CT1-*` / `D940-*` / `D716-win-*/...`），白名单必然漏 → 每个新任务都要改门禁脚本
（把"运行期产物"变成"改门禁"），违背 D860 本意。

**为何必须补粒度**：目录级豁免若不设界 = **无界通道**；且原实现只打印一个**计数**，
豁免了哪些文件**不可核**（与 `merge_writeset_gate.py` 自称的"豁免必须显式、逐条打印理由"冲突）。
故补 ① **逐条列举** + ② **数量阈值**（上限 = `--max-files`，复用同一旋钮，不引入新魔数；
超出部分计入预算；阈值本身不单独判红）。

### 6.2 改前 / 改后行为对照（原始输出）

**（a）目录级豁免的"无界通道"实证** —— 13 件 evidence + 12 件代码：

```
───── 改前（HEAD 版）: 13 evidence + 12 代码 ─────
── PR 预算门禁（D734）: 基线=origin/main 上限=12 文件 / 落后阈值=20 ──
  ℹ️  D860 治理产物豁免: 13 件不计预算（brief/卡/Note/规格/自验证据，代码文件仍计数）
  ✅ ① 变更文件数 12 ≤ 上限 12
  ✅ ② 变更单域: ✅ PASS 12 个文件同域: mac（无归属 0，域判定豁免 0）
  ✅ ③ 落后检查跳过（--files 注入模式无 git 上下文）
✅ PASS PR 预算内（12 文件）
exit=0                       ← ⚠️ 13 件证据被目录级豁免**整口吞掉**，预算恒绿

───── 改后: 13 evidence + 12 代码 ─────
── PR 预算门禁（D734）: 基线=origin/main 上限=12 文件 / 落后阈值=20 ──
  ℹ️  D860 治理产物豁免: 12 件不计预算（brief/卡/Note/规格/自验证据，代码文件仍计数）
       · [目录级豁免 docs/synova/product-lines/evidence/] 12/12 件:
         - docs/synova/product-lines/evidence/x1.txt
         ...
         - docs/synova/product-lines/evidence/x12.txt
  ⚠️  CT-D evidence 目录级豁免超阈值: 目录内共 13 件 > 上限 12 件
      ⇒ 超出 1 件**计入预算**（阈值不单独判红；判红仍由 ① 文件数决定）:
         - docs/synova/product-lines/evidence/x9.txt
  ❌ ① 变更文件数 13 > 上限 12 —— 拆 PR（禁调高上限）
  ✅ ② 变更单域: ✅ PASS 12 个文件同域: mac（无归属 0，域判定豁免 1）
exit=1                       ← 无界通道被收口
```

**（b）粒度① 逐条列举**（3 件治理 + 1 脚本）：

```
───── 改前: 只有计数 ─────
  ℹ️  D860 治理产物豁免: 3 件不计预算（brief/卡/Note/规格/自验证据，代码文件仍计数）
  ✅ ① 变更文件数 1 ≤ 上限 12
✅ PASS PR 预算内（1 文件）

───── 改后: 逐条可核 ─────
  ℹ️  D860 治理产物豁免: 3 件不计预算（brief/卡/Note/规格/自验证据，代码文件仍计数）
       · task-state/D999.json
       · .claude/task-briefs/b.md
       · memory/notes/proposed/n.md
  ✅ ① 变更文件数 1 ≤ 上限 12
✅ PASS PR 预算内（1 文件）
```

### 6.3 "改坏即红"

把实现换成**基线副本**（`/tmp/ct1fixture/budget_base/repo/…`，含同构符号链接树以保持
`check-ownership.py` 的相对路径解析），跑同一套测试文件：

```
$ SYNO_BUDGET_SRC=/tmp/ct1fixture/budget_base/repo/scripts/control-tower/check-pr-budget.sh \
    bash tests/control-tower/check-pr-budget.test.sh
  ❌ CT-D① 未逐条打印豁免路径
  ❌ CT-D① 未打印 evidence 豁免路径
  ❌ CT-D① 未明示目录级豁免来源
  ❌ CT-D② 超阈值未点名
  ❌ CT-D② 未点名被计入的文件
  ❌ CT-D② 计数不符:   ✅ ① 变更文件数 1 ≤ 上限 12
  ❌ CT-D② 13 evidence + 12 代码 → 超出件计入后 13 > 上限 12 判红 — 期望 exit=1 实际 exit=0
  ❌ CT-D② 判红口径未点名
  ❌ 8 项失败 / 37 项通过
```

⇒ 只有**新增的 8 条** CT-D 断言回红，**既有 37 条**全绿 ⇒ 判别性干净、无连带回归。

自纠留痕：注入路径最初把基线脚本单独拷到 `/tmp/ct1fixture/`，其兄弟依赖
`check-ownership.py` 用 `Path(__file__).resolve()` 反推 `REPO_ROOT` → 全线 `exit=2`
（**看起来"红"但不是判别性红**）。已改为在 `/tmp` 建**同构符号链接树**（除被测脚本外全部
symlink 回真实仓），基线副本自检 `exit=0` 后才做对照。

---

## 七、自验结论

- 判据①（head SHA 含 `d54` ⇒ 不得推断出 `D54`）：**成立**。暴力构造真实 SHA
  `9e41414096fbfc45b2471a4d54e6244cb73b37db`（首个 `[Dd]\d+` 即 `d54`），改前 → `D54`，改后 → `None`。
- 判据②（同一份代码 × ≥3 个不同 SHA ⇒ 结果逐字一致）：**成立**。5 个不同 SHA
  （含 `4afd4ce`/`5836e434`/`d0f6c2f2`/`017bef55`）输出**逐字节一致**（唯一 md5 `4249ee6f…`）；
  改前为 5 个互不相同的 md5。
- 判据③（改前/改后原始输出逐条对照）：**成立**（§1.1 vs §1.4；§1.2 vs §1.4；§1.6 两侧；§6.2）。
- 每条修复有"改坏即红"判别性夹具：**成立**（§三，7 个定点变异各自至少 1 条断言回红；
  全清基线 M0 → 10 条红；CT-D → §6.3 的 8 条新断言回红）。
- 既有断言零回归：`merge_writeset_gate.test.sh` 既有 46 条 / `check-pr-budget.test.sh` 既有 37 条全绿；
  `bash -n` / `py_compile` 通过；`--diff` 无新增吞错。

**自验结论: 可提请独立审计**（不构成审计通过；审计权归 K3，合并闸归 CTO）。

---

## 八、遗留清单（不属本卡 / 未做）

1. **`merge_writeset_gate.py` 的 `BUILTIN_EXEMPT` 仍只有 `.claude/bypass.log`**（有意，见 §6.1）。
2. **并入的 base 历史严格性上限**：本卡落地 `--first-parent` + `merge_base..start`；
   D911 切片 A2「声明从被检查的 head 树读（`git show <head>:<path>`）」原样未动
   —— 属 `task-state/D911.json` 的写集，本卡不越界。
3. **`check-pr-budget.sh` 的阈值语义**：超阈值只"计入预算"，不单独判红——这是有意选择
   （避免凭一个新魔数误拦正常 PR）；若 CTO 认为 evidence 超量本身就该红，需另立卡。
4. 上游只读依赖未改：`.github/workflows/ci.yml:119-120` 的调用行零改动 —— 本卡不含该文件写集。
5. `docs/authority/DOCS-REGISTRY.yaml` 未登记 `evidence/`（属 task-5/CT-D2 的范围，本卡不动）。
