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
