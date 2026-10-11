# K4-07 / #1056 · 独立复核报告（四项 a/b/c/d）
> 复核席：**verifier-k4**（独立成员，非实施员）｜出具：2026-10-11 23:4x
> 被测：分支 `feat/1056-l15-profession-layer` @ **`2cf60dfc16f8268b14f3ce842abdc5932562c9c7`**（队长钉）
> 基线：`merge-base = dc5ce093c37f6cf8ef069431b3192a390637f88d`（= 队长给的基线，我取到的 local-main 当刻值）
> 我的克隆：`D:\synova-wt-b2-verify`（唯一；**未在实施员任何工作树跑过一个命令**）

---

## 0. 取件与钉定
```
LSREMOTE_EXIT=0
TOTAL_REMOTE_HEADS=942
---- 命中行原文 ----
2cf60dfc16f8268b14f3ce842abdc5932562c9c7	refs/heads/feat/1056-l15-profession-layer
---- local-main 行 ----
dc5ce093c37f6cf8ef069431b3192a390637f88d	refs/heads/local-main
TOKEN_IN_OUTPUT=0
```
```
PINNED=2cf60dfc…  ACTUAL=2cf60dfc…  MATCH=YES
MERGE_BASE=dc5ce093…               MERGE_BASE == dc5ce093? YES
rev-list --left-right --count origin/local-main...HEAD = 0	2
```
> ✅ **与本批前一张卡（K4-01）不同：本分支 `ahead/behind = 0 2`，即不落后 local-main**，无陈旧基线问题。

**变更集（merge-base 三点）= 11 件 / 1774 insertions / 8 deletions**
```
A .claude/claims/1056.yaml                                  （治理）
A .claude/task-briefs/2026-10-09-1056-l15-profession-layer.md（治理）
A docs/synova/product-lines/evidence/1056-l15-profession-layer-20261010.md（治理）
A extensions/professions/chain-retail-expansion/manifest.json
A extensions/professions/chain-retail-expansion/thresholds.json
A extensions/professions/manifest.json
M src/deploy/content-registry.ts                             ← 超卡面写集（已声明）
A src/extensions/layer-resolver.ts
M tests/deploy/content-registry.test.ts                      ← 超卡面写集（已声明）
A tests/extensions/layer-precedence.test.ts
A tests/extensions/profession-layer.test.ts
```
**写集核**：卡面内 6 件 + 治理 3 件 + **超卡面 2 件**（`src/deploy/content-registry.ts`、`tests/deploy/content-registry.test.ts`）⇒ **与「registry 域 +2 件」声明相符**。未出现其它越界。

---

## a. 我跑了什么命令（原始）

```bash
# —— 取件 / 钉定 / 基线 ——
git -c … ls-remote --heads "http://Synova:<TOKEN>@192.168.1.7:3000/…/SynovaAgent.git"
git -c … fetch --no-tags "$URL" "+refs/heads/feat/1056-l15-profession-layer:refs/remotes/origin/…" \
                              "+refs/heads/local-main:refs/remotes/origin/local-main"
git -c … merge-base origin/local-main origin/feat/1056-l15-profession-layer
git -c … rev-list --left-right --count origin/local-main...origin/feat/1056-l15-profession-layer

# —— 只读深核（C 组）——
git -c … rev-parse origin/local-main:src/init/file-driven-loaders.ts ; git -c … rev-parse HEAD:同件
git -c … diff origin/local-main HEAD -- src/init/file-driven-loaders.ts      # 必须空
git -c … log --oneline "$MB"..HEAD -- src/init/file-driven-loaders.ts        # 必须 0 笔
git -c … grep -n "profession-layer" HEAD ; git -c … ls-tree -r --name-only HEAD | grep -i profession-layer
git -c … grep -n "initProfessionLayer" HEAD -- src
git -c … show HEAD:extensions/professions/manifest.json
git -c … diff "$MB" HEAD -- src/deploy/content-registry.ts
git -c … diff "$MB" HEAD -- tests/deploy/content-registry.test.ts

# —— 归因（X 组）——
git -c … config --get core.autocrlf ; git -c … hash-object --path src/init/file-driven-loaders.ts <file>
tr -d '\r' < src/init/file-driven-loaders.ts | sha256sum ; git -c … show HEAD:同件 | tr -d '\r' | sha256sum

# —— Stage B：五连（全部在自建克隆内造红 + 原样恢复）——
node_modules/.bin/vitest run tests/extensions/layer-precedence.test.ts tests/extensions/profession-layer.test.ts   # T-green
python3 把 content-registry.ts 的 dir: 'professions' 改成 'professions-k4v-removed'                                  # T-red-A
python3 把 layer-resolver.ts 的 export initProfessionLayer 改名 …Renamed                                             # T-red-B
python3 把 CONTENT_LAYER_ORDER 里 industry/profession 对调                                                             # T-mut
python3 把 extensions/professions/chain-retail-expansion/thresholds.json 的 F1_KZ.critical 1.2 → 1.25                # T-real
python3 往 extensions/frameworks/fts5-cjk-tokenizer.json 加 _k4v_neg_control 键                                       # T-neg
# 每次改后 git checkout -- 恢复，并 hash-object 核逐字相同

# —— 并发清场核对（起跑前）——
Get-CimInstance Win32_Process -Filter "name='node.exe'" | Select ProcessId, CommandLine
```

---

## b. 原始输出

### b-1 🔴 最高风险：`src/init/file-driven-loaders.ts` 是否被冲突解决吞掉
```
LOCALMAIN_BLOB = 6e0e1e6b0756eef2b71bd84347f8667c599582fb
DELIVERY_BLOB  = 6e0e1e6b0756eef2b71bd84347f8667c599582fb          BLOB_SAME=YES
git diff origin/local-main HEAD -- src/init/file-driven-loaders.ts  ⇒ 空     DIFF_EMPTY=YES
COMMITS_TOUCHING=0        （分支两笔提交均未触碰该文件 ⇒ 批 1 的 45 行尾插确已撤除）
```
**⚠️ 一个必须解释的现象（我一开始看到它，没有跳过）**：裸 `sha256sum` 两侧**不同**
（worktree `3c64663a…` vs blob `6544ee3f…`）。归因：
```
core.autocrlf = true
WORKTREE_HAS_CR=YES   WORKTREE_BYTES=4391   BLOB_BYTES=4303   CRLF_COUNT=88      （4391 = 4303 + 88 ✓）
git hash-object(worktree)  = 6e0e1e6b…   ← 与 blob 相同
WORKTREE(剥 CR) sha256 = 6544ee3f…   BLOB(剥 CR) sha256 = 6544ee3f…   NORMALIZED_SAME=YES
```
⇒ **差异只来自 CRLF 检出转换，文件内容逐字节一致**。**结论：该文件与 local-main 完全一致，未被吞改。**

### b-2 ① 改名是否改净
```
文件名面：HEAD 全树 grep -i profession-layer
  .claude/task-briefs/2026-10-09-1056-l15-profession-layer.md        （治理件名，历史）
  docs/synova/product-lines/evidence/1056-l15-profession-layer-…md   （治理件名，历史）
  tests/extensions/profession-layer.test.ts                          （测试文件名，见 §d 遗留）
  ⇒ src/extensions/profession-layer.ts 不存在（FILE_COUNT 中无该模块）

内容面（代码面 src/ + tests/ + extensions/）：仅 3 处，全是自我说明性注释
  src/extensions/layer-resolver.ts:6        改名注记
  tests/extensions/profession-layer.test.ts:2,4  文件名注记
  ⇒ 旧路径 import 数 = 0

新符号引用面（正常）
  tests/extensions/layer-precedence.test.ts:25  from '../../src/extensions/layer-resolver'
  tests/extensions/profession-layer.test.ts:21  from '../../src/extensions/layer-resolver'
  src/deploy/content-registry.ts:129  MODULE_IMPORTS: '../extensions/layer-resolver' → import(...)
```

### b-3 ③ 接线符号链（同符号，三处自洽）
```
registry : src/deploy/content-registry.ts:493-494
           module: '../extensions/layer-resolver'   init: 'initProfessionLayer'
模块     : src/extensions/layer-resolver.ts:520   export function initProfessionLayer(): ProfessionLayerInitResult
manifest : extensions/professions/manifest.json
           "entryPoint":"../src/extensions/layer-resolver.ts"  "exportKey":"initProfessionLayer"
```
> `entryPoint` 以 `extensions/professions/` 为基准、registry `module` 以 `src/deploy/` 为基准，**两者解析到同一文件** `src/extensions/layer-resolver.ts`；**符号名一致**（`exportKey` == registry `init` == `initProfessionLayer`）。

**表结构未被新造**：`ContentTypeEntry` 字段位 = `type / dir / face / status / loader? / readers? / reason?` = **七元，确无 order/precedence 字段位** ⇒「层序不由 registry 承载」这句属实。

### b-4 registry 计数与写集
```
content-registry.test.ts:45   expect(snap.counts.total).toBe(25);          （原 24）
content-registry.test.ts:73   expect(reachable.length).toBe(20);           （原 19）
content-registry.ts:584       if (CONTENT_TYPES.length !== 25) {            （原 24）
content-registry.ts:136       文档串「…＋ professions（#1056/K4-07）= 20」   （同步）
⇒ 三处硬钉 + 一处文档串 = 与「24→25 / 19→20 三处」声称相符
```
**全仓传播（铁律 9）**：除下方 §b-6 的陈旧探针外，**没有任何其它测试仍钉旧计数而被本卡改红**。
（`tests/growth/feedback-channel-unification.test.ts:119` 的 `counts.total`、`tests/electron/use-streaming-contract.test.ts:179` 的 `allTypes.length` 经核**与本表无关**。）
`src/init/file-driven-loaders.ts:50-51` 读 `snapshot.counts.total/reachable`（**无硬编码计数**）⇒ 不受影响。

### b-5 Stage B 五连判别性（真值 exit code）
```
[B0] 基线 HEAD=2cf60dfc…  PORCELAIN_LINES=0

[B1] T-green   VITEST_EXIT=0   Test Files 2 passed (2)   Tests 23 passed (23)   1.33s

[B2] T-red-A   VITEST_EXIT=1   1 failed | 22 passed
       × ① registry 登记了 professions 项，且 loader 按名指向 layer-resolver 的 initProfessionLayer
       AssertionError: registry 必须登记 professions 目录: expected undefined to be defined
     （突变：content-registry.ts 的 dir: 'professions' → 'professions-k4v-removed'
       ⇒ 该项不再登记 professions 目录 ⇒ ① 必红）
     恢复 RESTORE_EXIT=0   BLOB[src/deploy/content-registry.ts]=d1e0f52bd402a6d4d234c729abe935f172c745f5

[B3] T-red-B   VITEST_EXIT=1   4 failed | 19 passed
       × ② boot 装配真调 layer-resolver：initProfessionLayer 被执行且该项 ok（非静态判据）
       × ③ boot 自检覆盖真实专业包，且每个包的内容都参与层叠（unwired 为空）
       × ④ 判别性：层叠自检对「发现到但叠不进去」真报警（构造 unwired 真值）
       × ⑤ registry 装配报告把降级信号往上传（不静默吞）
       AssertionError: expected +0 to be 1        ← boot 解析不到 init ⇒ attempted=0
       AssertionError: expected [ Array(1) ] to deeply equal []
     恢复 RESTORE_EXIT=0   BLOB[src/extensions/layer-resolver.ts]=2b500edf715e021803ec42c04eed003e11302a99

[B4] T-mut     VITEST_EXIT=1   4 failed | 19 passed
       × CONTENT_LAYER_ORDER = builtin < industry < profession < custom（升序优先）
       × 四层同名键 → custom 胜；逐层移除 → 依次落到 profession → industry → builtin
       × 层序常量把 profession 夹在 industry 与 custom 之间（其余顺序仍能被证伪）
       × 运行时新建一个专业包目录 → 被 loadProfessionPackages 发现且参与层叠
       AssertionError: 投放 [builtin,industry,profession] 的胜出者应是 profession:
                       expected 'industry' to be 'profession'
       AssertionError: expected [ 'builtin', 'profession', …(2) ] to deeply equal [ 'builtin', 'industry', …(2) ]
       AssertionError: expected 2 to be 9
     恢复 RESTORE_EXIT=0   BLOB[src/extensions/layer-resolver.ts]=2b500edf…

[B5] T-real    VITEST_EXIT=1   1 failed | 22 passed
       × 真实包 extensions/professions/chain-retail-expansion 在两个 orgId 下均被命中且内容生效
       AssertionError: org-alpha: 专业包阈值应生效: expected 1.25 to be 1.2
     （突变：真仓 thresholds.json 的 F1_KZ.critical 1.2 → 1.25）
     恢复 RESTORE_EXIT=0   BLOB[thresholds.json]=53e5754f08119a92d0dff834919d8cfbc3586451（与改前逐字相同）

[B6] T-neg     VITEST_EXIT=0   Test Files 2 passed (2)   Tests 23 passed (23)
     （无关目录 extensions/frameworks/fts5-cjk-tokenizer.json 加键 ⇒ 仍全绿 ⇒ 红是特异的）
     恢复 RESTORE_EXIT=0   BLOB=e242cd6568c009c528df3e1d02c171fab03ee313（逐字相同）

[B7] 终检
     PORCELAIN_LINES=0 / STASH_ENTRIES=0 / HEAD_UNCHANGED=2cf60dfc…
     被改 5 件 blob 与交付态逐字相同：OK ×5
     UNTRACKED_LEFT_IN_PROFESSIONS=0
```

### b-6 🆕 冻结探针陈旧（我独立查出）
```
scripts/control-tower/probe-content-registry.ts:103
  if (snapshot.counts.total !== 20) { fail(`注册表应为 20 项，实测 ${snapshot.counts.total}`); }
而 local-main 侧：src/deploy/content-registry.ts:552  if (CONTENT_TYPES.length !== 24)
```
⇒ 探针期望 **20**、真值早已 **24** ⇒ **在 local-main 上就是红的**；本卡把 24→25 后仍红。**存量陈旧探针，非本卡引入**；本卡**正确地未触碰它**（在写集外），并在证据件「判据探针（未修，仅登记）」如实登记。建议另立卡收口其期望值。

---

## c. 与交付声称的异同

实施员一句话：*「L1.5 接线已改为经 content-registry 声明（`profession` 项 + init `initProfessionLayer`），模块改名 `profession-layer.ts → layer-resolver.ts`，`src/init/file-driven-loaders.ts` 零改动（撤掉批 1 的 45 行尾插，与 local-main 逐字节一致）；判据件 2 文件 23 用例全绿。」*

| # | 声称 | 我的实测 | 判 |
|---|---|---|---|
| 1 | 接线改为经 content-registry 声明（`profession` 项 + init `initProfessionLayer`） | `content-registry.ts:488-494`：`type:'profession'` / `dir:'professions'` / `loader.module:'../extensions/layer-resolver'` / `loader.init:'initProfessionLayer'`；`MODULE_IMPORTS:129` 有对应键 | **[一致]** |
| 2 | 模块改名 `profession-layer.ts → layer-resolver.ts` | 模块文件 `src/extensions/profession-layer.ts` **不存在**；旧路径 import **0 处**；剩余 3 处命中均为自我说明性注释 | **[一致]** |
| 3 | `src/init/file-driven-loaders.ts` 零改动、与 local-main 逐字节一致、撤掉批 1 的 45 行尾插 | blob 双侧同为 `6e0e1e6b…`；`diff` 空；`COMMITS_TOUCHING=0`；（裸 sha256 差异经 CRLF 归因，剥 CR 归一化后同 `6544ee3f…`） | **[一致]** |
| 4 | 判据件 2 文件 23 用例全绿 | 静态：13 + 10 = **23**；实跑 `Test Files 2 passed (2) / Tests 23 passed (23) / exit 0` | **[一致]** |
| 5 | （队长额外核点）manifest `entryPoint`/`exportKey` 与 registry 项同符号 | `exportKey:'initProfessionLayer'` == registry `init` == 模块导出名；`entryPoint` 与 `module` 解析到同一文件 | **[一致]** |
| 6 | （队长额外核点）registry 计数 24→25 / 19→20 三处 | 两处测试断言 + 一处源码完整性硬钉 = **三处**，另同步一处文档串 | **[一致]** |
| 7 | （队长额外核点）写集超卡面两处声明 | 超卡面恰为 `src/deploy/content-registry.ts` + `tests/deploy/content-registry.test.ts`（registry 域 +2） | **[一致]** |

**未覆盖（诚实标注）**：实施员证据件里另有若干**过程性读数**（自跑 vitest 原始输出、tsc、门禁双配置、D708 等）—— 我**只复跑了与判据直接相关的 2 个判据件**，其余过程读数**未逐条复跑**，不作为我的证据。

---

## d. 自验结论

### **自验结论：一致（可提请独立审计）**

**三条最高风险判据（开工前写死在 `task-8`，未事后调整）**
1. **冲突解决是否吞了 main 侧改动 —— 通过**。`src/init/file-driven-loaders.ts` 与 local-main **blob 逐字相同**、diff 空、**分支两笔提交 0 次触碰**；裸 sha256 的表面差异已归因为 CRLF 检出转换（`NORMALIZED_SAME=YES`）。
2. **改名是否改净 —— 通过**。模块旧路径**零 import**；`src`/`tests`/`extensions` 仅 3 处自我说明性注释；新符号引用面正常；`EXTENSION` manifest 的 `entryPoint` 已随之更新。
3. **接线真被执行（删掉即红）—— 通过**。T-red-A（registry 不再登记 professions）⇒ ① 红；T-red-B（init 导出改名）⇒ ②③④⑤ 四条连红，`expected +0 to be 1` 证明 **boot 真按名解析并调用**，不是静态 grep 判据。

**判别性成色（本卡最值得说的一条）**：T-mut 把层序常量对调后，失败原文为
`投放 [builtin,industry,profession] 的胜出者应是 profession: expected 'industry' to be 'profession'`
—— 这正是卡面点名要防的反面教材（「优先级完全倒置仍通过」）。**本卡 V3 能区分"层序正确"与"层序倒置"，不是恒真断言。**

**红证不残留**：`PORCELAIN_LINES=0` / `STASH_ENTRIES=0` / `HEAD=2cf60dfc…` 未变 / 被改 5 件 blob 与交付态**逐字相同** / `extensions/professions/zz-k4-1056-*` 残留 = 0。

**授权边界落实（队长三条）**：① 造红**只在我自己的克隆** `D:\synova-wt-b2-verify`；② 全部**原样恢复并自证干净**；③ **未 push**。→ **改的是我的克隆，非实施员写集。**

### 遗留（照实登记，**不作缺陷判定**）
1. **测试文件名仍为 `tests/extensions/profession-layer.test.ts`**（模块已改名）。证据件 §489 已自陈「本卡只裁定模块路径改名」。**队长 2026-10-11 已裁定本卡不改名**（理由：动已交付件 ⇒ 复核作废 + 多一轮成本）⇒ 我照实留一行**给 CTO 知情**，不在本项计为缺陷。
2. **`scripts/control-tower/probe-content-registry.ts:103` 期望值陈旧**（期望 20 / 真值 24→25），**在 local-main 上本就红，非本卡引入**；本卡正确地未触碰。建议另立卡。

### 边界（勿放大）
- 我**只复跑了 2 个判据件**（23 用例）；**未跑全量门禁**（tsc / 全量 vitest / 13 组）——归 CTO 收件闸 + K3 终审。
- 本报告只给「自验结论」，**不是审计**；是否通过归 CTO 收件闸 + K3 终审。我未合并、未推送、未改任何产品文件（仅克隆内造红+恢复）。

---

## e. 方法学注记（我自己踩到并纠正的两点）
1. **第一次并发清场检查实际什么都没证明**：我用 `wmic` 查 node 进程命令行，得到「无输出」，几乎据此报「无并发」。核对后发现**本机根本没有 `wmic`**（`'wmic' is not recognized`）。改用 `Get-CimInstance Win32_Process` 取到全部 node 进程命令行，确认只有 WorkBuddy / Codex / DSH Web 服务（PID 63204 `node --import tsx/esm apps/cli/src/bin.ts web`），**无 vitest**，才起跑。
2. **裸 sha256 差异没有被我当成差异**：先归因（`core.autocrlf=true` + CRLF 字节数守恒 4391=4303+88 + 剥 CR 归一化同值 + `git hash-object` 同 blob），再下结论。**若直接报"文件不同"就是假结论。**

---

## 附：重型验证运行记录（串行 ≤1）
| # | 时间(Asia/Shanghai) | 命令 | 真 exit | 重型 | 串行位 | 结果 |
|---|---|---|---|---|---|---|
| 1 | 23:4x | `vitest run tests/extensions/layer-precedence.test.ts tests/extensions/profession-layer.test.ts` ×6（T-green / red-A / red-B / mut / real / neg） | 0,1,1,1,1,0 | 是 | 队长放行占用 → **已释放** | 23 passed 基线；四条突变各自必红；终检干净 |

## 附：取证脚本与产物（全部在仓库外）
- 协议：`.k4-b2-lead\VERIFY-PROTOCOL.md`
- 脚本：`.k4-b2-lead\verify\`（`v30-fetch-1056.sh` `v31-1056-readonly.sh` `v32-1056-extra.sh` `v33-1056-counts.sh` `v34-1056-stageB.sh` `v35-clean3.sh`）
- 原始输出：`.k4-b2-lead\verify\out-1056-readonly.txt`、`out-1056-extra.txt`、`out-stageB-1056{,clean}.txt`、`out\1056-T-*.txt`
