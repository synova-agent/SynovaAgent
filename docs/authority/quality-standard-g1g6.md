# 质量门禁标准 v1 · G1–G6（可机械判）

> **版本** `v1` ｜ **as_of** `gitea/local-main@6e5f321aa`（2026-10-23）｜ **状态** `proposed`（P0：只测量，不阻断）
> **语义真源**：院方《运行面全面对照与代码质量泛化》**附卷 A §1**（G1–G6 的定义）
> 🔴 **本件不重定义 G1–G6**：只把附卷 A §1 的语义**机械收窄**（收窄处逐条写进「已知盲区」）。
> **规则的唯一定义** = 规格 §2.3-D3 的 T1–T5；本件只**引用规则 ID ＋ 给命令**，**不复制规则实现** —— 防两处各写一版口径（DS-3）。
> **门禁 ID 的唯一定义** = `docs/authority/GATE-INVENTORY.yaml`（DOC-0243）；**登记表** = `docs/authority/WIRING-REGISTRY.yaml`（DOC-0242）。
> **扫描器** = `scripts/control-tower/quality-baseline.py`（三态退出码；`--selfcheck` 判别力自检）。

## 怎么用（一条命令拿到 6 条判据的现状）

```bash
python3 scripts/control-tower/quality-baseline.py --json     # 6 条判据的命中集合（T1–T5 + 门禁位）
bash tests/control-tower/quality-standard.test.sh           # 本标准的可核性（结构 + 判别力）
```

**三态退出码**（与 `scripts/control-tower/AGENTS.md` 同口径）：`0` = 无回退 ｜ `1` = 有回退/有违规 ｜ `2` = 扫描自身失败（看不见 ⇒ **不得**当通过）。

---

## G1 可达

- **判据定义**：能力必须四段连通 —— 声明 → Provider → **生产** Consumer（非测试、非注释）→ 测试（打真实路径）。
- **怎么判（机械）**：
  - ① **扫描规则 `T1`**（声明无消费者；规则唯一定义见规格 §2.3-D3）—— 命令：`python3 scripts/control-tower/quality-baseline.py --json`（看 `totals.T1` 与 `violations[].check == "T1"`）
  - ② **已有门禁 `PC-G4`**（盘点表：接线完整性 —— 接线审计 ＋ 接线深度两个检查点）—— 命令：`bash scripts/pre-commit-check.sh`（组 4）
  - ③ **登记表 `status` 校验** —— 命令：`python3 scripts/control-tower/quality-baseline.py --check-registry docs/authority/WIRING-REGISTRY.yaml`
- **红条件**：
  - `[T1]` 声明存在而**生产**消费者 = 0（只在 `tests/` 或注释里出现视为 0）
  - `[T1]` 消费者只 `import` 未**调用**（import-only 子桶）
  - `[T1]` 消费者落点**只在定义文件自身**（同文件自调用不计消费者）
  - `[--check-registry]` 登记行 `status: wired` 而 `consumer` 或 `test` 为空 ⇒ 红
  - `[--check-registry]` 登记行 `defined_at` 指向不存在的 `path:line` ⇒ 红
- **证据要求**：`violations[]` 的 `{check, path, line, detail}` 原始 JSON 片段 ＋ 复跑命令原文；门禁类结论另给 `pre-commit` 的原始输出行（禁"我查过了"）。
- **豁免条件**：格式 `# quality-exempt: <issue> <reason> <expiry>`（`<expiry>` = `YYYY-MM-DD`），**写在违规行同行或该文件头部 20 行内**；批准人 = P4 门禁包负责人（跨块豁免须 CTO 在 Issue 留裁）；**同一 commit 既改判据又加豁免 ⇒ 豁免无效**；到 `<expiry>` 当日自动失效，`<expiry>` 缺失/非法 ⇒ 视为**未豁免**（fail-closed）。**运行时不可见的能力（动态 DI／外部注入）必须人工确认后才可加豁免**。

## G2 不静默

- **判据定义**：失败/降级必须**可见** —— `catch` 必带 `log.*` / `degraded: true` / `throw`；"看不见"必须返回 **2**（不得当通过）。
- **怎么判（机械）**：
  - ① **扫描规则 `T4`**（空 catch／`return null`／`return []`／`return false` 吞错；含 `// swallow-ok:` 行内豁免）—— 命令：`python3 scripts/control-tower/quality-baseline.py --json`（看 `totals.T4` ＋ `exemptions[]`）
  - ② **已有门禁 `PC-G2`**（盘点表：empty catch 无 log ＋ 静默吞错扫描两个检查点）—— 命令：`bash scripts/workflow/check-silent-swallow.sh --diff`
  - ③ **判据互补说明**：`T4` 补 `return []` / `return null` / `return false` 型吞错**并覆盖存量**；`check-silent-swallow.sh` 只扫 `scripts/` 且只看 `2>/dev/null` 族。
- **红条件**：
  - `[T4]` `catch` 块体去注释后为空，且块内无 `log.` / `logger.` / `console.` / `degraded` / `throw` ⇒ 红
  - `[T4]` `catch` 块体仅 `return` / `return null` / `return []` / `return false`，且无上述可见化调用 ⇒ 红
  - `[check-silent-swallow]` `|| true` / `2>/dev/null` 且无 `# swallow-ok:` 注释 ⇒ 红
  - `[三态]` 扫描产出 0 条却当作"没问题"（信号量 == 0）⇒ **红（必须 exit 2）**
- **证据要求**：`totals.T4` 与 `exemptions[]` 的 JSON 片段 ＋ `check-silent-swallow.sh --diff` 的原始输出；改坏前后两态（0 → 1）各一份。
- **豁免条件**：同 G1 的统一格式 `# quality-exempt: <issue> <reason> <expiry>`；**`// swallow-ok:` 是本标准的行内豁免，但不得与 `# quality-exempt:` 同时出现在同一行**（口径互斥，出现即判红）；批准人 = P4；到期自动失效。

## G3 有判据

- **判据定义**：测试必须打在**真实路径**上，禁壳/恒真；新增 impl 必须有配对测试。
- **怎么判（机械）**：
  - ① **扫描规则 `T5`**（测试壳；规则唯一定义见规格 §2.3-D3）—— 命令：`python3 scripts/control-tower/quality-baseline.py --json`（看 `totals.T5`）
  - ② **已有门禁 `PC-G2`**（盘点表：新文件配对测试、桩测试 ≥3 expect、跨模块集成三个检查点）—— 命令：`bash scripts/pre-commit-check.sh`（组 2）
  - ③ **测试自证** —— 命令：`bash tests/control-tower/quality-standard.test.sh`（本标准的判别力自证即 G3 的自证样例）
- **红条件**：
  - `[T5]` `it(` / `test(` 块内 `expect(` 数 = 0 ⇒ 红
  - `[T5]` 恒真断言（`expect(true)`、`expect(1).toBe(1)` 等）且无其他断言 ⇒ 红
  - `[T5]` 唯一断言是 `toBeDefined()` / `toBeTruthy()` / `not.toBeNull()` ⇒ 红（minor 桶）
  - `[T5]` 全文件仅 `skip` / `todo`、零启用用例 ⇒ 红
  - `[T5]` 只测替身、不 import 真实现 ⇒ 红
- **证据要求**：`violations[].check == "T5"` 的 `file:line` 原始输出 ＋ 用例计数命令原文；`--selfcheck` 的 `SELFCHECK-OK t1..t5=1/1/1/1/1 clean=0` 原文（这是"判别力"证据，不是"测试通过"证据）。
- **豁免条件**：同 G1 统一格式；**纯文档/纯配置的 commit 可豁免**（须写 `<reason>`）；批准人 = P4；到期自动失效。`*.test.sh`（shell 测试）在 P0 **不进 T5 口径**（见「已知盲区」），不得据此声称"已判"。

## G4 边界

- **判据定义**：对外入口必须 **schema 校验 ＋ timeout ＋ 默认 fail-closed**。
- **怎么判（机械）**：
  - ① **扫描规则 `T2`**（无 timeout）—— 命令：`python3 scripts/control-tower/quality-baseline.py --json`（看 `totals.T2`）
  - ② **扫描规则 `T3`**（schema 直通）—— 命令：同上（看 `totals.T3`）
  - ③ **存量 fail-open 样本的人工判据**：引用 #838 的"三处 fail-open"样本（**只引用，不修**）；人工判据须给 `file:line`，禁"我看过了"。
- **红条件**：
  - `[T2]` `fetch(` 所在语句起 12 行内无 `signal:` / `AbortSignal.timeout` / `timeout` ⇒ 红
  - `[T2]` `axios*` / `exec*` / `spawn*` / `http(s).request(` 参数内无 `timeout` ⇒ 红
  - `[T3]` `req.body` / `req.query` / `req.params` / 工具入参在同一语句内被当实参直传，且同语句无 `parse(` / `safeParse(` / `validate(` / `assert(` 类校验 ⇒ 红
  - `[人工]` 异常/缺省分支"放行"（fail-open）⇒ 红
- **证据要求**：`violations[]` 的 `{check, path, line, detail}` ＋ 该语句的原始代码片段（含行号）；人工判据另给 `file:line` 与被引 Issue 号。
- **豁免条件**：同 G1 统一格式；**内部纯函数调用（不出进程）不适用 timeout 条款**（须写 `<reason>` 说明"不出进程"）；批准人 = P4；到期自动失效。

## G5 状态

- **判据定义**：关键状态**落盘·事务一致·可回放**（不是内存 splice）。
- **怎么判（机械）**：
  - ① **未建成 → `P1`，探针命令如下**（P0 只给规则与探针，**不计入基线**；`limitations[]` 写明"启发式，未成门禁"）：

    ```bash
    # P5-a 事务覆盖（写操作数 vs 事务数）
    git grep -nE '\.prepare\(`(INSERT|UPDATE|DELETE)' -- 'src/**/*.ts' | wc -l
    git grep -nE 'db\.transaction\(' -- 'src/**/*.ts' | wc -l
    # P5-b 事件覆盖（publish 调用点，排除测试）
    git grep -nE 'publish\(' -- 'src/**/*.ts' | grep -v '\.test\.' | wc -l
    # P5-c 存量样本（人工核对的两处已知问题）
    sed -n '371,412p' src/store/session-store.ts        # 双写非事务
    sed -n '396,401p' src/agent/conversation-engine.ts  # 未传 onEvent
    ```

  - ② **既有证据样例**：`P5-c` 的两处存量样本（只引用，不修）。
- **红条件**：
  - `[P5-a]` 写操作数 > 0 而事务数 = 0（命令：`git grep -nE 'db\.transaction\(' -- 'src/**/*.ts'`）⇒ 红
  - `[P5-c]` 双写落在不同事务/无事务（如 `src/store/session-store.ts:371-412`）⇒ 红
  - `[P5-b]` 状态变更无事件（如 `src/agent/conversation-engine.ts:396-401` 未传 `onEvent`）⇒ 红
  - `[P5]` 事件不落盘/不可回放，或备份拷活库（非 `sqlite3 .backup`）⇒ 红
- **证据要求**：三条探针命令的原始输出（计数 ＋ 命中行）＋ 存量样本的 `file:line` 片段；**P1 不计入基线**，故不得用 `quality-baseline.json` 的 `totals` 冒充 G5 证据。
- **豁免条件**：同 G1 统一格式；**纯内存派生状态（无持久化语义）可豁免**（须写 `<reason>`）；批准人 = P4（涉及存储层须 CTO 联署）；到期自动失效。P1 未成门禁前，本条的"红"**只用于登记**，不阻断。

## G6 一致

- **判据定义**：文档/台账/注释与实现**一致**，无"承诺 × 实物"漂移。
- **怎么判（机械）**：
  - ① **已有门禁 `PC-X-9cf8d7`**（盘点表：D1193 文档契约三闸 —— 格式 / 取代 / 入库）—— 命令：`bash scripts/control-tower/check-doc-contract.sh`
  - ② **已有门禁 `CI-S3`**（盘点表：登记件不变量 `check-registry-invariants.ts` 的 C10 复算 wire 位；`--check-registry` 侧另见下条）
  - ③ **文档真相门禁** —— 命令：`bash scripts/doc-system/check-doc-truth.sh`
  - ④ **登记表 `defined_at` 可解析** —— 命令：`python3 scripts/control-tower/quality-baseline.py --check-registry docs/authority/WIRING-REGISTRY.yaml`
  - ⑤ **文档登记齐** —— 命令：`git add -A && bash scripts/doc-system/doc-registry-gate.sh`（断言 `检查 N 个文档`，`N≥3`，且 `0 个未登记`）
- **红条件**：
  - `[check-doc-truth]` 文档声明与脚本实际不符（版本/组数/文件路径对账失败）⇒ 红
  - `[check-doc-contract]` 任一闸不通过（格式闸 / 取代闸 / 入库闸）⇒ 红
  - `[doc-registry-gate]` 新增文档未登记 `docs/authority/DOCS-REGISTRY.yaml` ⇒ 红
  - `[check-registry-invariants]` 双真源（同一事实两处定义）或登记 id 不唯一 ⇒ 红
  - `[--check-registry]` 登记行指向不存在的 `file:line` ⇒ 红
- **证据要求**：三门禁的汇总行原文（`结论: PASS …` / `✅ 全部硬检查通过` / `0 个未登记`）＋ 违规清单（若有）的 `文件:行 + 原因`。
- **豁免条件**：同 G1 统一格式；**历史引述件可豁免**（`memory/notes/**` 的 11 份历史引述不回改，须写 `<reason>`）；批准人 = CTO（文档域守则归 CTO）；到期自动失效。**豁免不得用于"新文档不登记"**（登记是 G6 的硬面）。

> ⚠️ **口径更正（如实记录）**：规格 §2.3-D1 的 G6 基线把「登记件不变量」标为盘点表 `PC-G13`；锚上 C10 复算该检查器（`check-registry-invariants.ts`）只 wire 到 `CI-S3`，而 `PC-G13` 是"技能同步一致性" ⇒ 本件按盘点表**实测**写 `CI-S3`，**判据内容不变**（仍要求"登记件不变量"参与 G6 判定）。

---

## 规则映射表（G → 机械判法）

| G 轴 | 名称 | 机械判法 | 类型 | 命令/规则 ID |
|---|---|---|---|---|
| G1 | 可达 | `T1` ＋ `PC-G4` ＋ 登记表 `status` | 扫描 + 既有门禁 | `--json` / `--check-registry` |
| G2 | 不静默 | `T4` ＋ `PC-G2`（静默吞错） | 扫描 + 既有门禁 | `--json` |
| G3 | 有判据 | `T5` ＋ `PC-G2`（桩测试/配对测试） | 扫描 + 既有门禁 | `--json` |
| G4 | 边界 | `T2` ＋ `T3` ＋ #838 样本人工判据 | 扫描 + 人工 | `--json` |
| G5 | 状态 | `P1` 探针（P5-a／P5-b／P5-c） | 探针（未成门禁） | 见 G5「怎么判」 |
| G6 | 一致 | 文档真相 ＋ 三闸 `PC-X-9cf8d7` ＋ 登记件不变量 `CI-S3` ＋ `defined_at` | 既有门禁 | `check-doc-truth.sh` / `check-doc-contract.sh` |

> 规则 `T1`–`T5` 的**唯一实现**在 `scripts/control-tower/quality-baseline.py`（唯一**定义**在规格 §2.3-D3）；本表只做**映射**，不新增口径。

---

## 已知盲区（静态扫描看不见什么 —— 必须人工确认）

1. **动态 DI / 反射**：容器按字符串键解析、装饰器注入 ⇒ `T1` 看不到消费者。
2. **外部插件**：仓外加载（bundle/插件目录）⇒ 声明无仓内消费者不等于不可达。
3. **cron / 定时任务 / 运维脚本**：触发面在仓外 ⇒ `T1` 判为"无消费者"是**假红**。
4. **barrel 再导出**：`export * from` 链 ⇒ `T1` 的消费者统计会漏（再导出不算生产调用）。
5. **运行时字符串引用**：`mod[method]()`、配置驱动的工具名 ⇒ `T2`/`T3`/`T4` 均可能漏。
6. **`T2` 窗口启发式**：判定窗口 = 语句起 **12 行**（超窗即漏）。
7. **`T5` 不含 `*.test.sh`**：shell 测试的"壳"口径未定 ⇒ P0 不计（不得据此声称 G3 已判）。
8. **`T3` 只看已知入口**：`src/routes/**`、`src/mcp/**`、`src/agent/tools.ts`、`src/agent/builtin-tools.ts`；其他入口未覆盖。
9. **G5 无机械判法**：P1 探针只是启发式计数，无法判"事务是否覆盖了正确的写集"。
10. **门禁位模型是行号归属**：`slot` 由「上方最近 banner/注释头」确定 ⇒ 注释头增删会改变 owner（盘点表 `meta.counts` 只对锚有效）。

---

## 新门禁准入（防"只加不减"）

新增任何**阻断**门禁，必须**同时**满足四条，缺一不受理：

1. **配对账**：给出门禁 ID，并在 `docs/authority/GATE-INVENTORY.yaml` 的 `pairing` 段写 1 行 —— 说明它 **replace** 哪个旧门禁（同判据）或**等额 retire** 哪个旧件（`action: retire` 的 `target` 必须 ∈ C10 机器复算的孤儿集）。
2. **判别力自证**：新增门禁必须带「改坏 ⇒ 判红」的两态原始输出（改好 ⇒ 0），且信号量 == 0 时 **exit 2**（禁把"看不见"当"没问题"）。
3. **三态退出码**：`0` 通过 / `1` 真红 / `2` 检查自身失败；不得只有 0/1 两态。
4. **E6 参考**：贴 `bash scripts/control-tower/gate-retirement-report.sh --days 90` 的输出；**干净树必然"无数据"**（`.claude/gate-hits.log` 不在树内）⇒ 此时**不得**用"零命中"当退役依据，只能用孤儿集（C10 机器复算）。

---

## 失效条件（这条标准何时可撤 / 出 v2）

**标准 v1 失效（任一成立 ⇒ 出 v2）**：

1. `WIRING-REGISTRY.yaml` 被各包填满 **≥90%** 的声明 ⇒ 届时删「3 行样例」条款。
2. `T1`–`T5` 任一类成为**阻断门禁** ⇒ 届时改写"只测量"表述与配对退役条款。
3. G5／G6 的机械判法建成（P1 转正 / 三闸扩面）⇒ 届时删「P1 只给探针」。
4. 连续 **90 天** `totals` 无新增（只有存量）⇒ 提请降级为季度抽检（与门禁退役同理）。

**盘点表失效**：枚举器 `E1`–`E7` 任一**结构性变化**（组号体系重构、banner/注释头增删、CI 步骤拆分）⇒ `label_hash` 与行数都会变，`C1`–`C4` 必然要求重扫；`meta.counts` 只对锚 `6e5f321aa` 有效。

**扫描器失效**：某类规则连续 **90 天** 0 次命中真实新增（只有存量）⇒ 在 `candidates.retire` 里评估退役该规则（防"只报告不退役"）。

**E6 条款**：若将来 `.claude/gate-hits.log` 入树或被 CI 落盘，则恢复"零命中"作为退役证据之一（当前不成立）。

---

## 引用与登记

- 门禁盘点：`docs/authority/GATE-INVENTORY.yaml`（DOC-0243）
- 接线登记表：`docs/authority/WIRING-REGISTRY.yaml`（DOC-0242）
- 扫描器：`scripts/control-tower/quality-baseline.py` ＋ 基线 `scripts/control-tower/quality-baseline.json`
- 标准自证：`tests/control-tower/quality-standard.test.sh`（末行 `STANDARD-OK g=6 fields=5 rules=5`）
- 上游：Issue **#841**｜EPIC **#836**｜语义真源：附卷 A §1
