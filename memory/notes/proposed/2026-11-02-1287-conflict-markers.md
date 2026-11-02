# 冲突标记机检（A 类门禁新增）：把「严格冲突标记 0」从人规变成机检

- **状态**: proposed
- **日期**: 2026-11-02
- **卡**: #1287（待建）｜分支 `ct/conflict-markers-1102`｜基线 `7464d9531`
- **授权**: 创始人 2026-11-02 明确批准"同意加门禁，你的设计方案要做好"（A 类：新增阻断规则）

## 一、为什么（不是假想，是实证）

2026-11-02 夜里两次 forward-merge，我让 union 解析器在写盘后崩于控制台编码，结果**带 `<<<<<<<` 的合并提交被推送**：

| 提交 | 分支 | CI 结论 |
|---|---|---|
| `2d70f7e2b` | ct/1254-ledger-budget | **success**（#3171/#3172） |
| `b0edc5c92` | ct/1255-category-gate | **success** |

⇒ **全仓没有一处判据在看"文件里有没有留下两个版本互相打架的痕迹"**。而这类文件**解析不了**：
门禁读到垃圾仍可能给出"绿"——这是最坏的一类假绿（比红更危险）。

## 二、设计（怎么做的，以及为什么这样）

**判据**：行首四形态 ＋ 扩展名白名单。

| 形态 | 正则 | 来源 |
|---|---|---|
| open | `^\s*<<<<<<< ` | 普通 merge |
| base | `^\s*\|\|\|\|\|\|\| ` | `merge.conflictStyle=diff3` |
| sep | `^\s*=======\s*$` | 分隔线（独占一行才算） |
| close | `^\s*>>>>>>> ` | 普通 merge |

**为什么用扩展名白名单（而不是全仓 grep）**：
`.md`／`.txt` 里合法引用这些标记（文档、测试夹具、本文件自己）⇒ 全仓 grep 会**误杀所有"讲这件事"的文档**。
白名单 = 只扫**机器可解析**的文件：`.sh .bash .py .js .mjs .cjs .ts .tsx .jsx .json .yaml .yml .toml .xml .html .htm .css .go .rs .java .kt .rb .php .sql .ini .cfg .conf`。

**为什么只看行首**：冲突标记是**行首语法现象**；行内出现（`# 例如 <<<<<<< HEAD`）不算。代价写在 Known Limitations 里。

**逐行豁免**：同一行含 `conflict-marker-ok` 即跳过（可见、可审计，与 `swallow-ok` 同族）。

**三种模式**：`--staged`（pre-commit 腿，默认）｜`--base <ref>`（CI 腿，`<ref>...HEAD`）｜`--all`（人工抽查）。

**三态**：0 干净／1 命中（**阻断**）／2 判不了（无 git／无 python／base 不可解析／核心异常）——**2 绝不当通过**。

## 三、接入点

- `scripts/pre-commit-check.sh` **组 1（类型安全）** 追加：rc=0 ⇒ `soft_pass`；rc=1 ⇒ `hard_check`（**硬阻断**）；rc≥2 ⇒ `soft_check` 显式"判不了"。
  放组 1 的理由：语法完整性是类型安全的前提。
- **不新增组**（组数仍 12，`AGENTS.md` 的"12 组"口径不变）。

## 四、DSH 纪律与代码品味（逐项）

| 项 | 落点 |
|---|---|
| 契约头 `@input/@output/@exit/@degraded/@authority` | 文件头 `:17-49` |
| typed error 带 code | `E_USAGE / E_NO_GIT / E_NO_PYTHON / E_BASE / E_INTERNAL` |
| fail loud | 无 git／无 python／base 不可解析 一律 exit 2，禁静默 |
| 三态 0/1/2（D1） | 末行固定 `OK / VIOLATION(n) / DEGRADED` |
| `@降级` ＋ `SYNO_GATE_DEGRADED_LOG`（D2） | `deg()` 与 `check-gate-budget.sh` 同形（time/component/code/phase/retryable） |
| UTF-8（D3） | 首两行 `PYTHONIOENCODING` ＋ `LC_ALL` |
| 判别力自检（D4） | 测试 ⑩：删掉 open 形态 ⇒ ② 用例不再点名 open（证明红来自判据） |
| Known Limitations | 五条（只看行首／扩展名面外／不判语义冲突／只判当前树／非 UTF-8 误命中） |
| Source map | 文件头"结构（Source map）"段 |
| 测试配对（CT-40） | `tests/control-tower/check-conflict-markers.test.sh` **20/0**（含三态与改坏必红） |

## 五、实测

| 项 | 数 |
|---|---|
| 全树扫描（`--all`，main `7464d9531`） | **scanned=3802，hits=0**（无误杀） |
| 缺陷用例 | `.yaml` 三形态 ⇒ 1，逐条点名 `open/sep/close` ✅ |
| diff3 形态 | `\|\|\|\|\|\|\| ` ⇒ 命中 ✅ |
| `.md` 面外 | 不判（防误杀文档）✅ |
| 非 git | exit 2 ＋ 降级 JSON ✅ |
| 配对测试 | **20 通过 / 0 失败** |
| 台账 | inventory **44/0**、gate_meta rows=127、WIRING rows=45 |

## 六、边界（不做什么）

- **不改**任何既有门禁的判据（只新增一条）；
- **不动** `.md/.txt` 面（文档豁免是刻意选择，不是遗漏）；
- **不判**语义级合并损坏（两边都对、合起来逻辑错）——那不是本件职责，另属人工评审。
