# docs/synova/reviews/ — ③「已过独立复核」回执载体

> 归属：治理线 · **P7 交付自证与真值**｜批次 **#582 / P7-1**｜写入方：实现小队 W3
> 规格源（唯一，冻结）：handbook `派单件/2026-10-18-P7-582-四条件检查器-规格.md` @ `22f47c55a`（主仓 dev doc 已按文档契约迁出；原 blob `a22509208b08fa6a` 仍可从历史解析）§4bis ③／C1／C3／附录 B B3
> 本件同时是**目录非空载体**（git 不跟踪空目录）：目录里除本 README 外只放回执 JSON。

## Summary · 这目录是什么

四条件自合（① CI 全绿 pending=0 ② 零写集重叠 ③ 已过独立复核 ④ 串行）里，**③ 的物理凭据**放在本目录。

本批实现的是 **T1 `attested`（单轨）**：一次复核 = 一个 JSON 回执文件，随分支提交进树；
`check-merge-conditions.sh` 用 R1–R9 逐条**机器**判定它（不靠人转述、不看口头声明）。
`proven`（Gitea 原生 review，作者之外账号 APPROVED）**本批未启用** —— 见 §生成流程 路径一。

**一条命令看结论**：

```bash
bash scripts/control-tower/check-merge-conditions.sh --pr <N>     # <N> = 要判的 PR 号
# 末行 ∈ { CAN-自合并 | NO: <条件名> | degraded: <原因> }；退出码 0 / 1 / 2（见 §8）
```

## Design philosophy

**一个分离 ＋ 三条承诺**：

- **分离**：「复核结论说了什么」与「这条结论绑定在哪个补丁上」分开存 —— 补丁指纹由 git 内容寻址独立算出，回执只**携带**指纹、**不携带** diff。
- **承诺 1**：改码不重做复核 ⇒ 必红（R3 指纹不匹配）。
- **承诺 2**：回执提交之后再动任何文件（含文档）⇒ 必红（R7 时序）。
- **承诺 3**：回执自身的加入不改变指纹 ⇒ 无「回执改指纹、指纹要回执」的循环依赖（指纹排除本目录）。

## 1. 回执格式 `syno-review-receipt/v1`（逐字段**必填**）

每个字段都是**必填**（缺一 ⇒ R2 红）；字段名**照抄本表，不得自创**（规格 §4bis ③-2.1）。

| 字段 | 类型 | 含义 | 判它的规则 |
|---|---|---|---|
| `schema` | string | 固定 `"syno-review-receipt/v1"`（版本标识，防旧格式混入） | R2 |
| `pr` | number | 被复核的 PR 号，必须 == `--pr` 传入的 N | R2 |
| `patch_fingerprint` | string | `"sha256:<64 hex>"`，值见 §2 指纹定义 | R3 |
| `author` | string | **被复核**会话标识（写码方），与 `reviewer` 必须不同 | R2 / R6 |
| `reviewer` | string | **复核**会话标识（fresh，未参与实现） | R2 / R6 |
| `independence` | string | 固定 `"fresh-session"`（其它值一律红；两个 `fresh-session` 也不等于密码学独立，见 §6） | R2 |
| `verdict` | string | 固定 `"PASS"`；非 PASS ⇒ 红 | R4 |
| `checks` | array | 逐条物理检查，**≥5 条**，每条 `{id, cmd, result, evidence}`；`result` 全为 `"pass"` | R4 / R8 |
| `findings` | array | 发现清单 `{severity, where, what}`；`severity` 不允许 `"block"` | R5 |
| `issued_at` | string | ISO-8601，形如 `2026-10-18T22:00:00+08:00`（正则 `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}`） | R2 |
| `tool` | string | 产出回执的工具标识，非空（例：`pr-review@v1（.dsh/skills/pr-review/SKILL.md 五步）`） | R2 |

骨架（不要手写，用 §4 第二步生成）：

```json
{
  "schema": "syno-review-receipt/v1",
  "pr": 558,
  "patch_fingerprint": "sha256:<64 hex>",
  "author": "<被复核会话标识，与 reviewer 不同>",
  "reviewer": "<复核会话标识（fresh，未参与实现）>",
  "independence": "fresh-session",
  "verdict": "PASS",
  "checks": [ {"id":"铁律38","cmd":"grep -rn 'as any' <变更文件>","result":"pass","evidence":"<原始输出摘要或证据路径>"} ],
  "findings": [ {"severity":"warn","where":"path:line","what":"…"} ],
  "issued_at": "2026-10-18T22:00:00+08:00",
  "tool": "pr-review@v1（.dsh/skills/pr-review/SKILL.md 五步）"
}
```

`checks[]` **内容来源**：`.dsh/skills/pr-review/SKILL.md` 的五步（① 范围与撞车 ② 铁律逐项物理检查 ③ 声称 vs 事实 ④ 门禁自洽 ⑤ 结构化结论）—— 五步 ⇒ 至少 5 条，每条 `cmd` 必须**可复跑**、`evidence` 必须是**原始输出片段或可读路径**（禁"看起来没问题"）。

## 2. 文件命名与补丁指纹（**唯一，必须与实现一致**）

```
路径 = docs/synova/reviews/<pr>.<fp 前 12 位 hex>.json
例   = docs/synova/reviews/558.22c39c01ab34.json      （fp 取 sha256 前 12 位十六进制；禁大写、禁前缀模糊）
```

**指纹定义**（原样照规格 §4bis ③-2.0）：

```
mb  = git merge-base <tip> <head>
fp  = sha256( git diff --no-color -M --full-index --binary <mb> <head> -- . ':(exclude)docs/synova/reviews/**' )
```

两条设计要点（改动这两条 = 改口径，须 CTO 批）：

- **`--full-index`**：diff 里带 blob SHA ⇒ **内容寻址** ⇒ rebase 后同内容同指纹（不必重做复核）。
- **`:(exclude)docs/synova/reviews/**`**：回执自身的加入**不改变**指纹 ⇒ 无循环依赖（规格 F11 实测：排除前后同值）。

取指纹的命令见 §4 第一步（不要手算）。

## 3. 判据：R1–R9（**全绿才绿**）

| # | 规则 | 判法 | 不过时的输出文案（机器行点名） |
|---|---|---|---|
| R1 | 回执在 head 树 | `git cat-file -e <head>:docs/synova/reviews/<pr>.<fp12>.json` | `R1 缺回执 <path>` |
| R2 | schema 与必填字段（**逐字段**，不只 schema/pr） | JSON 可解析 ∧ `schema` 匹配 ∧ `pr==N` ∧ `author`/`reviewer`/`tool` 非空 ∧ `independence=="fresh-session"` ∧ `issued_at` 匹配 ISO-8601 | 逐项点名缺/不合规字段，例 `R2 independence 必须为 fresh-session` |
| R3 | 防重放（改一个字节即失效） | `patch_fingerprint == "sha256:"+fp`（**禁前缀匹配、禁模糊匹配**） | `R3 指纹不匹配（回执已被改码作废）` |
| R4 | 复核结论 | `verdict=="PASS"` ∧ `len(checks)>=5` ∧ 全部 `result=="pass"` ∧ `checks`/`findings` 是数组 | `R4 checks 未全 pass（<id> 失败）` |
| R5 | 无阻断发现 | `findings[]` 无 `severity=="block"` | `R5 存在 block 级发现` |
| R6 | 非自我复核 | `reviewer != author`（两者非空由 R2 保证） | `R6 reviewer 与 author 相同` |
| R7 | 时序（复核后不得再改码） | 回执引入提交 `C = git log --diff-filter=A --format=%H -1 <head> -- <path>` ⇒ `git diff --name-only C <head>` 只允许 `docs/synova/reviews/**` | `R7 回执之后仍有代码改动: <文件>` |
| R8 | 证据非空 | 每条 `checks[]` 的 `cmd` 与 `evidence` 非空 | `R8 checks[i] 缺 cmd/evidence` |
| R9 | **告警级**（恒打印，不因判定通过而省略） | 回执引入提交的 `%ae` ∈ 本 PR 代码提交的 `%ae` 集合 ⇒ 打 `warn: 身份未分离（本机 git 身份不可信）` | **必须出现** |

**输出口径（裁 B3-1）**：③ 通过 ⇒ 机器行与逐条行都写 **`③=ok(attested)`**；🔴 **级别后缀不许省** ——
省略成「条件 ③ 等于 ok」即违规（"声明"不许显示成"证明"，教训 178-c 同族）。`proven` 级别待 B6-a 裁决后才可能出现。

## 4. 生成流程（复核会话执行）

**路径二（回退路径，本批唯一可用）——三步**：

```bash
# 第一步：取补丁指纹 fp（由 git 内容寻址算出，不手写）
bash scripts/control-tower/check-merge-conditions.sh --pr <N> --diff-fingerprint

# 第二步：生成回执骨架 JSON（只打印到 stdout，不写文件）
bash scripts/control-tower/check-merge-conditions.sh --pr <N> --print-receipt-template > /tmp/receipt-<N>.json

# 第三步：复核者按 .dsh/skills/pr-review/SKILL.md 五步跑**物理检查**，填 checks（≥5 条）/verdict/findings，
#        然后写入 docs/synova/reviews/<N>.<fp12>.json
#        🔴 这个提交必须是本分支的**最后一个提交** —— 之后不得再改任何文件（含文档），否则 R7 红
```

**路径一（原生 Gitea review）**：🔴 **本批未启用**（规范已写 §4bis ③-1，待创始人 B6-a 一句话裁决）。
未批前不许走；批了则 ③ 升级为 `proven`、本回执降为辅助（**不得两套并存**）。

## 5. 校验：怎么知道自己写对了

```bash
bash scripts/control-tower/check-merge-conditions.sh --pr <N> --json | python3 -m json.tool   # 机器可读，stdout 仅 JSON
bash scripts/control-tower/check-merge-conditions.sh --selfcheck                             # 判别力自检（12 判定点，零网络）
```

回执写坏了 ⇒ 输出**点名具体规则**（R1–R9 之一 ＋ 具体字段/文件），不是笼统 exit 1。

## 6. 🔴 Known Limitations（做不到什么 —— 裁 B3-2 硬要求，不许省略）

1. **`attested` 抓不到「作者冒用 reviewer 名」**：R6 只比 `author != reviewer` 两个**字符串**，
   本机 git 身份不可信 ⇒ 同一人换名即可"自证"。R9 只能**告警**（`warn: 身份未分离`），不能阻断。
   T1 能保证的是：**回执与补丁指纹绑定 ∧ 回执之后无代码改动**（改码不重做复核必红），**不是**密码学意义上的独立。
2. **② 只比「文件路径」，不比内容**：两个 PR 改同一文件的不同行仍判重叠（**有意 fail-closed**，减少误放行）。
3. **① 只认 CI 的最终态**：不判「这次红是不是存量红」（那属 `check-ci-stale-red.sh`）。
   `total_count==0`（"看不见"）⇒ **exit 2**，绝不当绿 —— 本件不引本地 CI 缓存做离线真值（裁 B5）。
4. **④ 的 S2（队首）依赖各 PR 的 ①②③ 可判**：**缺回执的 PR 不进就绪集** ⇒ 它不阻塞别人（有意，避免死锁）；
   因此「本 PR 是队首」不等于「本 PR 好」，只等于「同时刻没有更小的就绪者」。
5. **身份矩阵是 `as_of` 快照，以现场复跑为准**：规格 §3 F2／§4bis ③-0 记的是 `synova`(id 1) 与 `win-push`(id 3) 两账号；
   🔴 **现场已变**：`git remote get-url gitea` 内嵌 token **当前身份 = `win-push`(id 3)**，不是 `synova`(1)（本件撰写时实测）。
   复跑：`SYNO_TOK=$(git remote get-url gitea | sed -E "s#.*x-access-token:([^@]+)@.*#\1#")`，`curl -s -H "Authorization: token $SYNO_TOK" ${SYNO_GITEA_API:-http://127.0.0.1:3000/api/v1}/user`。矩阵一变，③ 的升级前提（B6-a）须重核。
6. **本目录未登记 `docs/authority/DOCS-REGISTRY.yaml`**：`docs/AGENTS.md` 要求新文件登记台账，但该写集扩条（W3b）**待 B6-b 裁决，本批跳过** ⇒ 台账里暂无本目录条目（已知差额，不是漏做）。

## 7. 成功 / 失败长什么样

| 形态 | 退出码 | 末行 | 说明 |
|---|---|---|---|
| 四条件全绿 | **0** | `CAN-自合并` | 机器行 `MERGE-COND: can ①=ok ②=ok ③=ok(attested) ④=ok` |
| 至少一条红 | **1** | `NO: <条件名[, 条件名]>` | 逐条给失败点（哪个 context pending／哪个文件撞哪个 PR／哪条 R 规则不过／落后几 commits） |
| 检查自身失败 | **2** | `degraded: <原因>`（stderr） | API 不可达／HTTP≠200／refs 取不到／**CI 信号量==0**／`--offline`／参数非法。**2 不是"通过"，也不是"红"** |

**`--offline`**：① 恒 exit 2（`degraded: --offline 无 CI 真值`）—— 无网络就没 CI 真值，不产假绿。

## 8. Source map

本目录只有本 README（其余是回执数据文件，一件一 PR 复核）。被说明的两件在别处：

| File | Role |
|---|---|
| `docs/synova/reviews/README.md` | 本件：③ 回执格式／指纹／R1–R9／生成流程／Known Limitations |
| `scripts/control-tower/check-merge-conditions.sh` | 检查器（W1）：四条件编排 ＋ `--selfcheck` ＋ 回执相关参数（`--diff-fingerprint`／`--print-receipt-template`） |
| `tests/control-tower/check-merge-conditions.test.sh` | 配对测试（W2）：CT-40 强制件，12 个判定点 ＋ 三态断言 |
| handbook `派单件/2026-10-18-P7-582-四条件检查器-规格.md` @ `22f47c55a` | 规格源（**已迁 handbook**；原主仓副本已删）—— 本件一切口径以它为准 |

## 9. 无裸数字（引用纪律）

本件**不写任何"有多少"手写数**。需要数字时跑枚举命令，现场取：

```bash
# 本目录现有回执数
git ls-tree -r --name-only HEAD -- docs/synova/reviews | grep -c '\.json$'
# 当前 open PR 数（② 的对手集大小）
API=${SYNO_GITEA_API:-http://127.0.0.1:3000/api/v1}
TOK=$(git remote get-url gitea | sed -E "s#.*x-access-token:([^@]+)@.*#\1#")
curl -s -H "Authorization: token $TOK" "$API/repos/synova-agent/SynovaAgent/pulls?state=open" \
  | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))'
# 原生 review 通道是否被用过（③ T0 前提）
curl -s -H "Authorization: token $TOK" "$API/repos/synova-agent/SynovaAgent/pulls/<N>/reviews"
```

理由：本仓任何手写数量都会变成第二口径（`docs/AGENTS.md` 引用纪律 2026-09-26）。本件出现的一切数字都是**常量和判据**（`>=5` 条 checks、`fp` 前 12 位、`R1`–`R9` 九条），不是"现状统计"。
