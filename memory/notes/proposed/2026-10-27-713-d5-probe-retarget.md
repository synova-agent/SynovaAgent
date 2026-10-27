# 2026-10-27 · #713 D5 判据件改靶（probe-knowledge-scope.ts）

- **状态**：proposed（待 #731 接线完成、D5 首跑转绿后 git mv 到 implemented）
- **日期**：2026-10-27
- **决策**：按 **裁 423 靶子归一**，把 D5 判据件的靶从"内容面独立目录"改为**实物三件岗位 scope 文件**：
  - `TARGETS`／`GATE_TARGETS` = `extensions/presets/roles/{finance,hr,sales}/knowledge-scope.yaml`
    （存在性闸语义**不变**：缺任一 ⇒ exit 2；另加自检齿 `GATE_TARGETS ⊄ TARGETS` ⇒ 契约自检失败）；
  - 断言对象 = **真路由** `POST /api/knowledge/search` ＋ **真中间件链**
    （`jwtAuthMiddleware` → `rbacMiddleware` → 内联 provider）＋ **真 loader**（`preset-loader.loadRolePacks`）；
  - 新增旗标 `--base-url <url>` / `--roles finance,hr` / `--presets-root <dir>`（裸跑仍走原语义）；
  - **逐字保留清单**（改这些＝改门禁语义＝A 类，须另走提案）：三态退出码 `0/1/2`、
    **信号量==0 ⇒ exit 2**、**存在性闸 `GATE_TARGETS` 判定**、**判别力自检骨架**（V5）。
- **理由**：旧靶目录**从来不存在** ⇒ 探针恒定 exit 2，属"判据存在但无靶"，**永无可能变绿**——
  该判据从未具备判别力。裁 423 认定实物三件才是岗位知识范围的唯一内容载体；且先红后绿（Q-15）要求
  改靶完成而接线未动时**必须仍红**（exit 2），禁跳过红态直接绿。
- **判据点（本卡只到红，原始输出进卡）**：
  - 裸跑（无参）⇒ `RESULT=NOT_IMPLEMENTED` / **`REAL_EXIT=2`**，原因＝`生产链未消费 scopes（declared-only：
    真 provider 条件集无 pkb_domain 维）`；
  - 反例（临时内容根）：拔 `finance/knowledge-scope.yaml` ⇒ **exit 2**（存在性闸）；
    `finance.scopes` 改空 ⇒ **exit 1**（`❌ FAIL [L1] [finance] scopes[] 为空`）；
  - V5 判别力自检用**子进程真实退出码**：拔文件 ⇒ 自身 **2**、scopes 改空 ⇒ 自身 **1**（"永远绿"即检查自身失败）；
  - 结构面观测：真 provider 条件集当前只有 `access.sensitivity`（第 0 位，K12-11 不回退）⇒ 判定 declared-only 的
    **实测依据**，不是读源码猜的。
- **前提失败入账（随本卡上报 L1，均属 `src/l4/knowledge-store.ts`，本卡写集外，建议另立卡）**：
  1. **KL-1**：dev doc d-seed 的 `update(id,{pkb_domain})` **写不进去**——`insert()` 的 INSERT 列清单与
     `update()` 的 UPDATE 列清单**都不含 `pkb_domain`**（实测 update 后该列仍 NULL；`src/l3/pkb-seed.ts:266`
     同被静默丢弃，`documents.ts:57`／`knowledge-agent.ts:173` 同族）⇒ 播种按 L1 裁定改为
     "生产 `store.insert` ＋ 同库句柄直写该列"，探针输出**显式打印 KL-1**，断言对象仍在读侧生产链。
     ⇒ 真实产品缺口：**生产写侧目前无法表达 scope**。
  2. **KL-6**：`knowledge_chunks` 的 FTS 同步触发器 `kc_fts_delete` 把字符串 `id` 当 FTS5 的 rowid
     （`VALUES('delete', old.id, …)`），rowid 必须整数 ⇒ **任何 DELETE 都抛 `SQLITE_ERROR: SQL logic error`**
     （实测按 id 逐行删同样失败）⇒ 探针播种改"同形复用"，域不一致即报环境原因（不拿脏语料出绿）。
- **失效条件**：① `role-pack v2`（权限宇宙归一）落地后，本件 d-perm 迁移说明段（命名空间＝scope id 第一个 `.`
  之前的前缀，现物得 `{finance, people, market}`）以 v2 为准；② #731 接线完成且 D5 首跑转绿后，本 Note 由
   proposed 转 implemented（若届时未转 ⇒ 生命周期门禁会列僵尸）。

---

## 返修批补记（2026-10-27 · 活账 #1070 · 活3 / PR #1055 · CTO 裁 #7605 §1「品味1＝选项 a」）

- **起因**：队外复核 R-C2 品味1/8 发现 —— 探针头注只有 `@input/@output/@degraded` 三个标签，**`@exit`／`@authority`
  ／`@not-here` 标签形态缺**（退出码语义只在散文行「退出码（三态，逐字保留）」）；且 `scripts/control-tower/README*`
  当时不存在 ⇒ 长期件缺 README 骨架（Summary/Design philosophy/Source map）。CTO 裁 #7605 §1 选 **(a) 真补**（非偏差声明）。
- **本次改动（纯增量）**：
  1. `probe-knowledge-scope.ts` **头注**补三段标签 —— `@exit`（0/1/2 标签形态，**语义与既有散文逐字同源**）、
     `@authority`（谁能跑：裸跑任何人可跑；`--base-url` 行为面需自备服务＋临时库；谁能改：骨架归治理线、
     判据语义归 #713/#731）、`@not-here`（不替生产链接线／不建第二口径／不改门禁语义／除播种外不写库）。
     **代码、断言、退出码语义、`TARGETS`/`GATE_TARGETS`、V5 骨架零改动**（diff 逐行核对）。
  2. 新增 `docs/synova/runbooks/README-probe-knowledge-scope.md`（五节：Summary → Use［When to choose it／
     最小可用命令／What success and failure look like］→ Understand the implementation［Design philosophy 一句＋
     Source map］→ Known Limitations［declared-only 先红态／V5 依赖 tsx 可解析／三态 exit 2 语义］）。
  3. `docs/authority/DOCS-REGISTRY.yaml` 追加 **DOC-0307**（`type: architecture`，`status: active`，`owner: P3`）
     —— D2 登记门禁「新增 .md 必须登记」的机械必需，纯 append（L1 已授权，待 L1 追认）。
- **判据点**：裸跑仍 **`exit 2`**／末行 `RESULT=NOT_IMPLEMENTED`／`COVERAGE: PASS=7 NOT_IMPLEMENTED=4 UNVERIFIED=4`
  （与改前基线逐字一致 ⇒ 行为等价）；`grep -c '@authority'`／`'@exit'`／`'@not-here'` 各 ≥1；README 五节逐条 grep 命中；
  `SYNO_CI=1 GITHUB_ACTIONS=true SYNO_DIFF_BASE=gitea/local-main bash scripts/pre-commit-check.sh` 末行 + EXIT。
- **路径更正（2026-10-27 同日，CI 硬红后）**：README 首版放在 `scripts/control-tower/README-probe-knowledge-scope.md` ⇒ Gitea CI
  `local-gates / gates` 的 **D1193 文档契约三闸·闸 3（入库闸）** 硬红 —— 该白名单（`docs/synova/DOC-CONTRACT.md` 的
  `doc-contract-whitelist` 块）只放行 `docs/**`／`decisions/**`／同址 `**/README.md`（同址需有代码）等，**带后缀的 scripts 下
  README 不在内**（本地 pre-commit 该闸是软提示 ⇒ 本地绿 ≠ CI 绿，与"本地 pre-commit 不含 vitest"同族）。按 L1 裁定改放
  `docs/synova/coordination/README-probe-knowledge-scope.md`（`docs/**` 在白名单内），DOC-0307 的 `path` 同步更正；
  内容语义不变。**该路径本身仍命中 §3 阻断清单**（`doc-contract-blocked` 明列 `docs/synova/coordination/**`，阻断优先于白名单）⇒
  按 L1 二次裁定落 `docs/synova/runbooks/`（docs/** 白名单内、不在阻断清单；既有 7 件 runbook 先例）。判据：
  `bash scripts/control-tower/check-doc-contract.sh --base gitea/local-main` ⇒ EXIT=0。
- **如实记录**：仓内**没有**头注标签的契约测试（`tests/control-tower/probe-contract.test.sh` 断的是 stdout 末行
  `RESULT=` 与三态退出码，**不 grep 头注标签**）⇒ "删 `@authority` ⇒ 测试必红"**不成立**；本项只能以独立复核为准。
