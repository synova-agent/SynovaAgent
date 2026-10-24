# 测试分层成文 v1 · 六档现役 ＋ 两档未建（可机械判）

> **版本** `v1` ｜ **as_of** `gitea/local-main@ac41ae13c`（2026-10-24）｜ **状态** `proposed`（P0：只测量，不阻断）
> **语义真源**：`#918 A 节 Q-10`（裁 353 批准；裁 332 ①②③）｜**归属**：治理域 · P7 交付自证与真值
> **本件只做「分层成文」**：把「非平凡模块必须有 expected/snapshot」从形容词变成**可判判据**。**不改门禁语义（P4）｜不动 `src/**`｜本 PR 不接 CI**（接线归 PR-3 的 ①g，由 P4 决定）。
> 🔴 **本件不重定义 G1–G6**：质量判据的唯一定义 = `docs/authority/quality-standard-g1g6.md`（DOC-0241），本件**只引编号、不复制、不改写**（防两处口径）。
> 🔴 **「非平凡」的唯一真源** = `tests/contract/triviality-manifest.yaml`（DOC-0266，裁 332 ① 指定落点）；**执行器** = `scripts/control-tower/check-test-obligations.py`。**本件不写第二本账**：凡清单与本文冲突，以清单＋执行器输出为准。
> 🔴 **同字母异义警示**：本件的「六档」≠ 根件 §8.0 的**代码层 L1–L5**（那是 import 方向门禁）。引用时写清是哪一套。

## 怎么用（一条命令拿到分层义务的现状）

```bash
python3 scripts/control-tower/check-test-obligations.py --base gitea/local-main   # 三态：0 满足/SKIP ｜ 1 真红 ｜ 2 检查自身失败
python3 scripts/control-tower/check-test-obligations.py --selfcheck              # 判别力自检（S1–S9 逐例）
bash tests/control-tower/check-test-obligations.test.sh                                # 配对测试（两态＋改坏必红）
```

**三态退出码**（与 `scripts/control-tower/AGENTS.md` 同口径）：`0` = 满足或 `SKIP`（变更集无 `src/**`）｜`1` = 真红（缺资产／命名违规／清单级过期）｜`2` = 检查自身失败（清单 schema 非法／base 不可解析／扫描根 0 个 `src` 文件 —— **看不见不得当通过**）。
`@降级` 走既有约定：stderr `degraded:` 行 ＋ `SYNO_GATE_DEGRADED_LOG` JSON（check-gate-protection.sh 同形）。

---

## 1 六档现役（逐档给「判据面 ＋ 枚举命令」）

> 「现役」= **本仓已有载体、且在当前 `npx vitest run` / 既有 runner 下会被执行**。判据面一律给枚举命令（引用纪律：不给手写数）。

| # | 档 | 判据面（谁挡） | 枚举命令（现状可核） |
|---|---|---|---|
| ① | **unit** | `npx vitest run`（`vitest.config.ts` 的 `include`） | `git ls-files 'tests/**/*.test.ts' ':!tests/**/*.integration.test.ts' ':!tests/**/*.e2e.test.ts'` |
| ② | **integration** | `npx vitest run`（`*.integration.test.ts` 在 include 内） | `git ls-files 'tests/**/*.integration.test.ts'` |
| ③ | **e2e** | `tests/run-e2e-pipeline.cjs`（端到端流程 runner） | `git ls-files 'tests/e2e/*.e2e.test.ts'` |
| ④ | **acceptance** | `npx vitest run`（切片验收：MVP 切片判据） | `git ls-files 'tests/acceptance/**'` |
| ⑤ | **contract（＋门禁自证）** | 契约套件：同一套用例 × N 实现 ＋ 登记表（`known-divergences.yaml`／`known-red.yaml`）；**门禁自证**：每个门禁／检查器的配对 `*.test.sh`（含「改坏必红」） | `git ls-files 'tests/contract/**' 'tests/control-tower/*.test.sh' 'tests/doc-system/*.test.sh'` |
| ⑥ | **snapshot-replay** | 冻结输入 → 归一化输出 → 逐字段 diff；执行器 `scripts/ci/golden-snapshot-runner.ts`（经 `tests/ci/*.test.ts` 在 vitest 内执行）；**资产面** = `tests/expected/**`（见 §2 命名） | `git ls-files 'tests/ci/golden-*' 'scripts/ci/golden-snapshot-runner.ts' tests/expected` |

> 🔴 **现状分读**：六档**机制**均在库（上表枚举命令非空）；但 ⑥ 的**资产面** `tests/expected/**` 当前 **0 件**（`git ls-files tests/expected | wc -l`）。⇒ **「档在库」≠「资产已齐」**：资产由清单行 `asset_glob` 在**首次触碰模块的变更集**里补齐（`expiry` 兜到期）；bench／web 两档见 §2（**未建，一个字节都不算**）。

**档间不许互相顶替**（每档各答一个不同问题）：

- unit 答「这段逻辑对不对」；integration 答「装配起来对不对」；e2e 答「用户流程走得通吗」；acceptance 答「切片判据达成没有」；contract 答「两个实现/两层之间契约一致吗」＋「这个门禁自己有没有判别力」；snapshot-replay 答「同样的输入，冻结输出变了没有」。
- 🔴 **unit 全绿 ⇒ 不得据此声称 integration/e2e 绿**；**契约套件绿 ⇒ 不得据此声称快照义务已满足**（反之亦然）。判据错档 = 该判据不计入「通过」（根件 §8.1 判据纪律 ③ 证据）。

## 2 两档未建 · **不空转**（显式声明，禁读成"已覆盖"）

| 档 | 现状（可核） | 为什么列而不建 | **「建成」的判据**（满足才算该档上线） |
|---|---|---|---|
| **bench**（性能/基准） | **未建**：`git ls-files 'tests/bench/**'` 零命中；`package.json` 无 bench 脚本 | 无稳定基准环境（CI 机器抖动）＝判据不可判；**建空壳目录/空跑断言 = 空转**，按 G3「测试壳」判红 | ① 有 `tests/bench/**` 真实基准用例（跑真代码，非 sleep 模拟）② 有基线文件＋**棘轮**（只降不升）③ 有 runner 命令与阈值判定 ④ 三态退出码 |
| **web**（浏览器/E2E-UI） | **未建**：`git ls-files 'tests/web/**'` 零命中；无浏览器 runner 依赖 | 当前无 Web 用户面交付物可测（桌面端走 `tests/desktop/**`／`tests/electron/**`，**不得冒名 web 档**） | ① 有真实浏览器 runner（如 Playwright）② 用例打在真实路由（禁 mock 整页）③ CI 可见失败点 ④ 三态退出码 |

🔴 **不空转 = 四条硬规则**（两档共同）：

1. **不设门禁**：本档未建 ⇒ 不设阻断、不计入任何判据、**不得出现在"本 PR 覆盖了 X 档"的声称里**。
2. **不建空壳**：禁止「空目录 ＋ `expect(true)`」冒充上线；出现即按 **G3**（有判据）判红，并要求删除。
3. **不借名**：`tests/desktop/**`、`tests/electron/**`、`tests/golden-scenarios/**` 等**既有目录不得被当作 bench/web 档的替身**。
4. **上线走规则**：某一档要转「现役」⇒ 先满足上表「建成判据」四条，**在同 PR 改本文件对应行 ＋ 改 `DOCS-REGISTRY` 状态**（禁只改代码不改分档）。

---

## 3 义务（哪一档必须有什么资产）

**判据（纯查表，无启发式）**：`非平凡 ⇔ 清单有登记行且 surface ≠ none`。

**触发**：变更集（`--base gitea/local-main` 的 `merge-base..HEAD`，`--diff-filter=ACMR`）**触及**某登记模块（路径前缀匹配）⇒ 同变更集必须含该模块 `asset_glob` 命中的**新增或修改**文件；否则 **rc=1**，点名 `module → asset_glob（实际改动：…）`。

| surface | 含义 | 该模块必须有什么资产 | 落在哪档 |
|---|---|---|---|
| `protocol` | 对外/跨模块契约（序列化形状、前缀语义、错误码） | `obligation: expected` ⇒ `tests/expected/<area>/*.expected.json`（或 `.expected.ts`） | ⑤ contract 的判据面（＋④ acceptance 若切片声明） |
| `model` | 模型/提示/压缩/重试等非确定性或高漂移逻辑 | `obligation: snapshot` ⇒ 冻结快照（`tests/expected/<area>/**`）＋归一化白名单 | ⑥ snapshot-replay |
| `human-visible` | 人类可读输出（报告/摘要/告警文本） | `obligation: expected` ⇒ `tests/expected/<area>/*.expected.json` | ⑥ snapshot-replay（结构级 diff） |
| `none` | 已 triage 判定无需资产 | **无需资产**（但登记行必须有 `reason`，见 §4 豁免口径） | — |

**新增代码兜底（防"新代码逃避入册"）**：变更集**新增** `src/**/*.ts`，且**有效逻辑行**（去空行/注释）≥ **100** 且 ≥ 1 个 `export` ⇒ 必须有 triage 行（`surface` 或 `surface: none`＋理由），否则 **rc=1** `untriaged: <path>`。

**存量**：未登记 = `legacy`；`meta.legacy_baseline` **只减不增**（当前数 > baseline ⇒ rc=1；`--write-baseline` 只许**降到**当前值）。**撤登记逃逸** = 删清单行 ⇒ legacy 涨 ⇒ 红。

**版本化**：`schema_version` 变更须**同 PR** 改清单；执行器遇未知版本 ⇒ **rc=2**（fail-closed，不猜）。

**档内最小资产（定性，不写数）**：

- ⑤ contract：新契约 ⇒ 套件里**真实调用**（禁 import-only）＋ 实现登记表；新增实现 ⇒ `未纳管: X` 红。
- ⑤ 门禁自证：每个门禁/检查器 ⇒ 配对 `*.test.sh`，**必含「改坏确实红」两态**；信号量 0 ⇒ exit 2。
- ⑥ snapshot-replay：资产必须可**逐字段 diff**；录制 ≠ 判定（录制需人工确认后才写入 `tests/expected/**`）。

## 4 命名（S9 三条禁则 ＋ `tests/expected` 命名）

**S9 三条禁则**（新增文件 `A` 命中任一 ⇒ **rc=1** 命名红）：

1. **禁新增 `golden`**：路径含 `golden`（**大小写不敏感**，如 `foo.golden.json`、`Golden-X.json`）⇒ 红。存量 golden 件**冻结**（不改名、不扩增），见 §7 已知限制。
2. **禁 `*.snapshot.ts` 当 expected**：形如 `*.snapshot.ts` 的新增文件不得充当 expected/snapshot 资产 ⇒ 红（快照资产只认下面的命名）。
3. **`tests/expected/**` 只认两种扩展**：新增文件必须匹配 `*.expected.json` 或 `*.expected.ts` ⇒ 否则红。

**测试文件命名**（既有铁律 33，本件只引不改）：`*.test.ts`（unit／contract／acceptance）｜`*.integration.test.ts`（integration）｜`*.e2e.test.ts`（e2e）；门禁自证用 `*.test.sh`。

**目录约定**：`tests/expected/<area>/` 的 `<area>` 与清单行 `asset_glob` 一致（如 `tests/expected/compaction/**`）；区域内**不放**非资产文件（不放 README 当资产、不放 `index.ts` 当资产）。

## 5 豁免（`obligation: exempt` ⇒ 需 `issue`＋`expiry`＋`reason`，过期即红）

- **三栏必填**：`obligation: exempt` 的行必须同时带 `issue`（Issue 号，如 `#913`）、`expiry`（`YYYY-MM-DD`）、`reason`（≥10 个 Unicode 字）。**缺任一 ⇒ rc=1**（不是默认放过）。
- **过期即红**：`expiry` 当日已到或已过 ⇒ **rc=1**，属**清单级**失败（点名 module ＋ expiry）；**不吞**其他判据（缺资产、命名红照旧各自点名）。
- **只减不增**：豁免行是**债务登记**，修好后须删行（删行不得使 `legacy` 超 baseline —— 见 §3 棘轮）。
- **与 G1–G6 豁免是两套**：`# quality-exempt: <issue> <reason> <expiry>`（DOC-0241）是**源码行级**豁免；本节的 `obligation: exempt` 是**清单行级**登记。**两者互不替代**，不得互相引用洗白。
- **授权载体**：`issue` ＋ `expiry` ＋ `reason` 三者即授权链；本 PR 不接 CI ⇒ **不产生阻断面**，但清单被后续 PR-3 ①g 消费后，过期行会直接变红。

## 6 失效条件（`NoBehaviorChange` trailer 何时失效）

**形式**（裁 353，逐字）：commit **body** 出现 `NoBehaviorChange: <理由 ≥10 个 Unicode 字>` ⇒ 该提交触及的 surface 模块**免「补资产」**（执行器在整条 commit message 上逐行匹配，见失效条件 3）。

**边界**（只免什么）：只免「同变更集必须有 `asset_glob` 资产」这一条；**不免**命名红（§4）、**不免**清单级过期（§5）、**不免**新增兜底 triage（§3）。

**失效即红**（命中任一 ⇒ 该 trailer **不成立**，回到「缺资产 ⇒ rc=1」，并点名 commit ＋ 命中行）：

1. **语义变了**：该提交对**该模块**的 diff **新增行**含 `export `／`if (`／`switch (`／`case ` 任一（"只重命名/只搬代码"的声称与事实不符）。
2. **理由不足**：理由 `strip()` 后 **< 10 个 Unicode 字**（空白视为空）。
3. **位置/形式不对**：不是独立成行的 `NoBehaviorChange: <理由>`（执行器在整条 commit message 上逐行匹配 `^\s*NoBehaviorChange\s*:`；**写在 PR 正文／Issue 评论里不算**），或理由为空。

**输出要求**：失效必须点名 `commit <short>` ＋ 命中新增行原文（执行器形态 `trailer 失效：commit <short> 声明 NoBehaviorChange「…」但新增行含行为变更 → +<行原文>`）；禁只给「trailer 失效」四字。

## 7 已知限制（做不到什么 —— 禁读成"已防护"）

1. **本 PR 不接 CI**：清单与执行器**暂无阻断面**；`--selfcheck` 只证明判别力，不证明拦得住（接线归 PR-3 ①g／P4）。
2. **只判变更集，不判存量**：历史未登记模块 = `legacy`，靠 `legacy_baseline` **棘轮**约束"只减不增"；不追溯补资产。
3. **只证明"有资产文件"，不证明资产为真**：`asset_glob` 命中 ≠ 资产内容正确（内容真伪归 **G3** 断言＋独立复核）。
4. **非确定性归一化归 #907**：`snapshot-replay` 的时间戳/ID 白名单由 #907 的 replay 夹具定义；本件不定义归一化字段表。
5. **trailer 失效判定是文本级**：`export `/`if (`/`switch (`/`case ` 按**新增行字面**匹配（注释/字符串里的同名片段也会命中 ⇒ 宁可误红不误绿）；反向地「行为改了但新增行一个 token 都不含」（如只改表达式常量）**抓不到** ⇒ 故只承重最粗一档，细粒度语义归 L1 复核。
6. **清单解析是 YAML 子集**：执行器不依赖 PyYAML，只收顶层键／flow map／block map／标量／`#` 注释；锚点、多行标量、列表套列表**不在视野**，超出子集 ⇒ **rc=2**（fail-closed，不猜）。
7. **两条口径并存且有意**：`tests/expected/**`（本件义务资产）与存量 `tests/fixtures/golden-cases/**`／`tests/golden-scenarios/**`（冻结 legacy）**并存但不互通**；迁移另立卡，禁在本件兼营。
8. **六档不含 bench/web**：两档见 §2，未建 = 不设判据，**不得计分**。
9. **doc 状态 `proposed`**：本件在 P0 只测量；转 `active` 须 CTO 批（引裁号）＋ 接线计划（PR-3 ①g，归 P4）。

## 8 相关件（File → Role）

| 文件 | doc id | 职责 |
|---|---|---|
| `docs/authority/testing-layers.md` | DOC-0265 | **本件**：分层成文（六档＋两档未建＋义务/命名/豁免/失效） |
| `tests/contract/triviality-manifest.yaml` | DOC-0266 | 「非平凡」清单（唯一真源；schema_version 版本化） |
| `scripts/control-tower/check-test-obligations.py` | — | 执行器：三态 ＋ `--base/--json/--selfcheck/--write-baseline`，只读无网络 |
| `tests/control-tower/check-test-obligations.test.sh` | — | 判别力自证（S1–S9 两态＋改坏必红） |
| `docs/authority/quality-standard-g1g6.md` | DOC-0241 | G1–G6 唯一定义（本件只引） |
| `docs/authority/DOCS-REGISTRY.yaml` | — | 文档台账（本件登记行） |
| `gate-exemptions/2026-10-24-p7-913-pr2-docs.md` | DOC-0267 | 受保护路径豁免（裁 331） |

> 变更史 → `LOOP-ENGINEERING-CHANGELOG.md`；过程留痕 → handbook 仓（本件不承载）。
