# #1108 W10 · Unicode 同形字分级门禁：把"非 ASCII"从一刀切改成按危险分级

- **状态**: proposed（本批实现已落同一 commit；迁移到 implemented/ 由 L1 收件闸 ＋ K3 追认决定）
- **任务**: #1108（W10 批次 · 分支 `feat/1108-unicode-confusable`，基线 `gitea/local-main` = 3449bafdb）
- **日期**: 2026-10-28
- **#CRITERIA**: D
- **架构层**: 不属五层业务（治理脚本）

## 现状（做之前是什么样）

- 本仓**没有**同形字门禁。规格 §3 W10 记录：main 仓 899/1451 受控 `.ts` 含歧义字符；
  `ct/p3m7-pr5` 的 cron/cycle 范围 1,341 处（已确认 0 在变量名/裸代码位、cron 表达式 ASCII 干净）。
- 两条**已规划但未接线**的检查：D738（bash `$VAR` 全角边界常驻扫描，PR #544 未合）、
  研究规格外部审计器 finding #13（`\uFFFD` 乱码检查）。
- 若直接"全仓禁非 ASCII" ⇒ 22k 历史全角字符会把**每一个** PR 判红 ⇒ 门禁必被绕过。

## 决定（做成了什么）

| 层 | 件 | 决策 |
|---|---|---|
| 扫描器 | `scripts/control-tower/check-unicode-confusable.py`（新） | 分四档：A（标识符/裸代码位同形字）／B（双向控制符）／C（U+FFFD ＋ 非法 UTF-8 字节）**P0 阻断**；D（全角标点）**仅提醒 exit 0**。**只判 diff 新增行**：`--base <ref>` ⇒ `git diff --unified=0 <ref>...HEAD`；无 base ⇒ `git diff --cached`。三态 0/1/2；`--json`；`--list-legacy`（存量只报不判）；`--selfcheck`（六夹具判别力自检） |
| 配对测试 | `tests/control-tower/check-unicode-confusable.test.sh`（新） | T0–T18：M-11／M-12／B／C／解码边界／空集 SKIP／坏 base／非 git 仓／参数互斥／`--staged`／`--json`／`--selfcheck`／**改坏即红**／WIRING 记账自洽／自身约束（UTF-8、纯 LF、无 `$VAR（`） |
| 登记 | `docs/authority/WIRING-REGISTRY.yaml` | 能力 `gate.unicodeConfusable` = **`declared-only`**（defined_at=新脚本:1；consumer 空是实测不是遗漏，理由见下「接线判定」） |
| 登记 | `docs/authority/DOCS-REGISTRY.yaml` | `DOC-0323`（type decision，path=本批豁免文件） |
| 豁免 | `gate-exemptions/2026-10-28-1108-unicode-confusable.md`（新） | 受保护路径四条（扫描器／测试／自覆盖／DOCS-REGISTRY 自登记），三段式 ＋ 裁定号 `#1108` |

**没做什么（边界）**：不接线（见下）／不扫全仓／不改 `scripts/audit/**`（K3 专属）／
不改 `probe-*.ts`（M6 独占）／不重写 D738 既有 bash 扫描、不动 PR #544／不提供 inline 忽略注释／
不合并 PR。选择 **`.py` 单一入口**（不出 `.sh` 薄壳）：`python3` 直接可跑，少一份受保护件、少一处双真源；
接线时 CI/pre-commit 直接调 `.py`（参数已备 `--base/--staged/--json`）。

## 依据

- **第一性原理**：真危险＝**视觉冒充**（同形字混入标识符 ⇒ 人眼与 grep 均漏）＋**双向控制符**
  （Trojan Source，CVE-2021-42574 类）＋**编码损坏**（U+FFFD／非法字节）。"出现非 ASCII"本身不是危险
  —— 中文注释、全角标点是本仓常态。
- **规格**：`docs/founder/DEVDOC-门禁治理实施规格-v1-20261028.md` §3 W10（:155-167）判定分层＋范围约束＋
  scanner 自身约束；§4 G10（:186）一键验收；§5 M-11/M-12（:204-205）反例集。
- **仓内既有范式（禁重复建设）**：`check-tool-args-delta.py`（#915）的「独立判据 ＋ 配对测试 ＋
  `--selfcheck` 判别力自检」；三态退出码（`scripts/control-tower/AGENTS.md`）；
  UTF-8 强制（D313 M5/D732）；`SYNO_GATE_DEGRADED_LOG` 降级日志（铁律 11/32）。
- **历史教训**：D370/D738 —— 扫描器**禁 cp1252 猜编码**（Windows 下 UnicodeDecodeError 曾被误降级成"通过"）、
  **禁 `$VAR（` 全角边界**；扫描器自身故障必须归 2，绝不可归 0（假绿）。

## 决定与理由（逐条）

1. **为什么 A 档只判"骨架"而不是整行**：注释/字符串里的全角/同形字不冒充代码语义
   （`// 中文注释：全角（，）` 是正常文案）。骨架 = 注释与字符串字面量置空后的剩余部分 ⇒
   `const pаssword` 命中、中文注释不命中。**这是"禁把中文注释判成 A"的实现方式**，不是白名单。
2. **为什么 `#` 只在行首/空白后起注释**：`this.#privateField`、`a#b` 不能当注释（否则私有字段后的
   同形字会漏判）。`//` 在代码态直接起注释（字符串内的 `//` 已被字符串态保护）。
3. **为什么 C 档收"非法 UTF-8 字节"**：`git diff` 结构用 `surrogateescape` 保留（不丢字节、不猜编码），
   逐行再验；某行含无效字节 ⇒ 该行是**编码损坏证据** ⇒ C 档 P0 阻断（不是"看不清 ⇒ 跳过"，更不是"绿"）。
4. **为什么空变更集是 SKIP(0) 而不是 2**：pre-commit 常有无暂存变更时，这是**合法空集**
   （同 `check-quality-delta.py` A1 口径）；但输出显式打 `SKIP` ＋「无判据对象（SKIP 不是 PASS）」，
   且**解析器失效另有兜底**：diff 里有 `@@` 却解析不出 hunk ⇒ `E_PARSE` exit 2。
5. **为什么存量为"遗留清单"且读工作树**：M-12 语义是"存量不阻断"；清单不承担判据职责 ⇒
   读工作树（`git show` 逐件 5000+ 次太慢），上限 `--legacy-max-files`/`--legacy-max-bytes` 且显式标 `truncated`。
6. **为什么本批不接线**：前置条件实测缺失（见下），派单规则要求"不得假装已接线"。
   强行接线会改 `pre-commit-check.sh` 里尚不存在的段（W5/#1088）与 `GATE-INVENTORY` 尚不存在的
   `classification` 段（W1/#1090）⇒ 会与在飞批次冲突（写集重叠）。

## 接线判定（本批实测，禁假装已接线）

| 前置 | 检查命令 | 实测 | 结论 |
|---|---|---|---|
| ① `docs/authority/GATE-INVENTORY.yaml` 含 `classification:` 段 | `git show gitea/local-main:docs/authority/GATE-INVENTORY.yaml \| grep -c classification` | **0** | 缺 |
| ② `scripts/pre-commit-check.sh` 含「附: 治理面自检」段 | `git show gitea/local-main:scripts/pre-commit-check.sh \| grep -c 治理面自检` | **0** | 缺 |

⇒ **接线未做**：等待 **W1(#1090)**（`GATE-INVENTORY` classification 段）与 **W5(#1088)**（pre-commit 治理面自检段）
合入后再接线（`CT-check-unicode-confusable` 清单条目／A/B/C `hard_check`＋D `echo` 提醒／CI step 透传三态）。
`WIRING-REGISTRY` 因此填 `declared-only`，`consumer: null`。配对测试 T16 机器校验"status 与是否真接线自洽"
（declared-only ⇔ 两处零接线），**W5 接线后该断言会自动要求改成 wired**，防记账漂移。

## 已知限制（禁读成"已检测"）

1. A 档是启发式骨架不是 AST：模板字符串 `${...}` 内的代码位会被当字符串置空 ⇒ 该形态漏判。
2. 只判新增行：存量同形字不判（M-12 语义，防一次 PR 卡死 22k 历史）。
3. 同形表是枚举（西里尔/希腊常见同形 ＋ NFKC 兼容形）：亚美尼亚文、切罗基文等未入表 ⇒ 漏判。
4. 全角字母/数字出现在注释或字符串内 ⇒ **完全不报**（A 不收非代码位、D 只收标点）；这是与规格 D 定义一致的边界。
5. "乱码标记"只实现 U+FFFD ＋ 非法 UTF-8 字节；`Ã©` 这类"已被错误解码的 mojibake 文本"判不了。
6. B 档只收规格列举的两段（U+202A–202E／U+2066–2069）；U+200E/200F（LRM/RLM）未收 ⇒ 漏判（规格未列）。
7. 无豁免通道（无 inline 忽略）：A/B/C 要豁免须走 W3 双人复核 ＋ 日落（P0 永不自动退役）。

## 失效条件（这条判据何时可撤 / 何时必须改）

- 当"同形字/双向控制符"升级为 **解析器/编译器级判据**（AST/词法层直接判标识符）时，本器降级为回归锁，
  **不得无人接管即删**（V3.9：软机制被删等于从未存在）。
- W5(#1088) 落地「附: 治理面自检」段后，本器必须接线且 `WIRING.status` 改为 `wired`；
  否则 T16 记账自洽断言会红（这是有意的防漂移，不是噪音）。
- 规格若把 D 档升为阻断（改动 A 类判据），须 CTO 裁定 ＋ 本件同批更新，不得只改脚本。

## 生效时点

本 commit 起：**可手动／按需调用**（`python3 scripts/control-tower/check-unicode-confusable.py --base <ref>`），
`--selfcheck` 可随时验判别力；**尚未接入 pre-commit / CI**（接线未做，见上表），
接入后按规格为「A/B/C 在本步阻断、D 只 echo 提醒」。
