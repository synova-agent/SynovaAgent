# #1122 Step 1 · 总闸最小可跑版：把「门禁治理验收」变成一条可执行的机器判据

- **状态**: proposed（本批实现已落同一分支；迁移到 implemented/ 由 L1 收件闸 ＋ K3 追认决定）
- **任务**: #1122（门禁配额制 Step 1 · 分支 `feat/s1-verify-governance`；基线 `gitea/main` = b8edf9860）
- **日期**: 2026-10-28
- **#CRITERIA**: D
- **架构层**: 不属五层业务（治理脚本）

## 现状（做之前是什么样）

- 规格 §4「一键验收（机器判据）」列了 G1–G10 十项，但仓内 **`verify-governance.sh` 零命中**
  （Issue 卡面已查证：零既有总闸卡可合并）⇒ "门禁治理是否收口"只能靠人肉逐项看。
- 三件必需的机器件其实都已存在，只是**没有编成一张总闸**：
  - 归一真源 `scripts/control-tower/gate-assert.sh`（#1096 W6，`ga_run` 三态 ＋ 128 归判据故障）；
  - 遥测单写入器 `scripts/control-tower/gate-telemetry.sh`（#1094 W2，`result ∈ hit/miss/warn/degraded`）；
  - 同形字分级门禁 `scripts/control-tower/check-unicode-confusable.py`（#1108 W10，`--root`/`--staged`/三态/末行汇总）。
- 缺总闸的直接后果：**"没数据"与"没问题"分不开** —— 日志没写过、清单没登记、子判据根本没跑的三种情形，
  在人工汇报里都长得像"一切正常"（规格 §5 M-8 的原话：清空遥测必须报"未运行"，不得报"零命中可退役"）。

## 决定（做成了什么）

| 层 | 件 | 决策 |
|---|---|---|
| 总闸 | `scripts/control-tower/verify-governance.sh`（新） | 只做 **G2/G6/G10** 三项（不铺满 G1–G10）；逐项 `PASS/FAIL/SKIP` ＋ 末行 `GOVERNANCE: x/y PASS`；**全 PASS ⇒ 0 ／ 有 FAIL 或 SKIP ⇒ 1 ／ 判不了 ⇒ 2**；只读，不写仓库 |
| G2 | 同上（内嵌 python 单进程） | required 集合 = `classification:` 段里 `required_ci: true` 的 entrypoint；gate 名取确定性别名（完整路径／文件名／stem，**精确相等**）；窗口 `--days`（默认 7）。**日志缺失/为空/全坏行 ⇒ SKIP 且全部计「未运行」（绝不 PASS）**；有数据但个别门禁零记录 ⇒ FAIL 并逐条点名；required 集合为空 ⇒ exit 2（信号量 0） |
| G6 | 同上（source `gate-assert.sh`） | 用 `ga_run` 跑注入判据：默认 `exit 0`；配对测试在 `SYNO_TEST_ARM=1` 沙箱下注入 `exit 128` ⇒ 必须 **判据故障(2) ⇒ 计 FAIL**。**零第二套归一**：本件只读 `ga_run` 返回值，不写 `case 128)`，也不把 0/1/2 折叠成"一律 2" |
| G10 | 同上（临时 git 仓夹具） | 调 `check-unicode-confusable.py --root <夹具> --staged`：甲 = 标识符混西里尔 U+0430 ⇒ 必须 rc=1/VIOLATION；乙 = 注释内全角标点 ⇒ 必须 rc=0/PASS。**两态都对才 PASS**；扫描器自身 rc=2 ⇒ 本件 exit 2（判不了 ≠ 通过） |
| 配对测试 | `tests/control-tower/verify-governance.test.sh`（新） | T0 至 T16（53 断言）：自身约束（UTF-8/LF/swallow-ok/PYBIN/无组横幅）／3/3 PASS／遥测缺失 SKIP／空日志／注入 128／0-1-2 透传／**改坏即红（128→0）**／G10 甲态错／G10 乙态错／`--days` 边界／坏行计数／全坏行／三类"判不了 exit 2"／只读＋注入缝边界／WIRING 记账自洽 |
| 登记 | `docs/authority/WIRING-REGISTRY.yaml` | 能力 `governance.verifyGovernance` = **`declared-only`**（consumer 空）：本批写集不含 pre-commit/.gitea ⇒ 只有显式调用才跑。**不编造消费者** |
| 登记 | `docs/authority/GATE-INVENTORY.yaml` | **纯追加** `CT-verify-governance`（class **P1**、owner P4、review_after 2026-11-27、`required_ci: false`、confirmed_by: pending-cto）：不登记的话 `check-gate-inventory.sh` 第 ③ 条「盘上件未入册」会立刻红（新脚本落在 `scripts/control-tower/verify-*` 枚举面内） |
| 登记 | `docs/authority/DOCS-REGISTRY.yaml` | `DOC-0324`（type decision，path=本批豁免文件） |
| 豁免 | `gate-exemptions/2026-10-28-1122-verify-governance.md`（新） | 首行 `# review: #1122` ＋ 受保护路径四条（总闸／测试／自覆盖／DOCS-REGISTRY 自登记） |

**没做什么（边界）**：不做 G1/G3/G4/G5/G7/G8/G9／不改 gate-assert、gate-telemetry、gate-stats、check-unicode-confusable
的任何语义／不接线（写集不含 `scripts/pre-commit-check.sh`、`.gitea/workflows/**`、`.github/workflows/**`）／
不碰 `scripts/audit/**`（K3 专属）／不改 `probe-*.ts`（M6 独占）／不合并 PR。

## 依据

- **第一性原理**：总闸的价值不在"能打印 PASS"，而在**"看不见"时绝不打印 PASS**。五种"看不见"
  （日志缺失／清单无 classification 段／required 为空／子判据缺失／参数错）必须 SKIP 或 exit 2。
- **规格**：`docs/founder/DEVDOC-门禁治理实施规格-v1-20261028.md` §4（:171-186）G2/G6/G10 三行判据；
  §5（:196-205）M-6（128 不得 PASS）与 M-8（无数据只能报"未运行"）；§3 W10（同形字两态语义）。
- **仓内既有范式**：三态退出码与"信号量==0 ⇒ exit 2"（`scripts/control-tower/AGENTS.md`）；
  `ga_run` 作为唯一归一真源（#1096）；`gate-telemetry.sh` 作唯一写入器（#1094）；
  `check-unicode-confusable.py` 的两态/三态语义（#1108）；测试沙箱 = `mktemp -d` 复制真件（#1108 测试范式）。
- **历史教训**：D520（禁裸 python3，一律 `PYBIN`）；D312（禁 stash，隔离用 worktree/临时目录）；
  M-8（把"没跑"读成"零命中可退役"是本仓真实发生过的误判方向）。

## 决定与理由（逐条）

1. **为什么只做 G2/G6/G10**：Issue 红线明写"不得顺手扩"；其余七项的机器件多数未落地（W4/W5/W7 等分批），
   现在写只会得到"数表全绿"的空转（`scripts/control-tower/AGENTS.md` 红线）。
2. **为什么 G2 的 gate 名用"确定性别名"而不是模糊匹配**：现网遥测 `gate` 是**检查点散文名**
   （如 `Notes 迁移门禁 (D472)`），而 inventory 记的是 entrypoint 脚本名。模糊匹配会把"名字像"的当跑过
   ⇒ 直接破坏 M-8 语义。取别名精确相等的结果是：**现网大多数 required 项会落「未运行」**——这是如实的缺口
   （遥测命名与 inventory id 的对齐属 #1112 接线批次），不是本件漏判。
3. **为什么"有数据但个别门禁零记录"判 FAIL 而不是 SKIP**：SKIP 只保留给"整份日志不可用"（无数据）。
   日志可用且某个 required 门禁窗口内零记录 = 真实的"未运行"缺口 ⇒ 必须红，否则它会静默通过。
4. **为什么 G6 默认注入 exit 0、128 只由测试注入**：规格要求"注入 exit 128 ⇒ 必须归判据故障并计 FAIL"，
   而同一条规格又要求"干净夹具 3/3 PASS"。两者只有在**把 128 作为故障注入场景（测试侧）**时才同时成立。
   所以：默认跑干净路径（证链路可跑、码透传），128 故障注入由 T4 每次跑；若把 gate-assert 的 `128) printf '2'`
   改成 `'0'`，T4 的 FAIL 断言立刻失效（T6 已把这条写进用例）—— 这就是"改坏即红"。
5. **为什么注入缝要锁在沙箱**：`SYNO_GOV_G6_RC` 只在 `SYNO_TEST_ARM=1` 时生效（仓内既有沙箱标记）。
   否则"改一个环境变量让 G6 恒绿"就成了后门；非沙箱忽略注入由 T15 断言。
6. **为什么 G10 要两个夹具而不是一个**：只测"该红的红"会漏掉"该绿的绿"（误伤全角注释 ⇒ 中文文档全红，
   #1108 已实测 601 行文档会命中）。两态都对才 PASS，任一态错即 FAIL，覆盖两个方向。
7. **为什么判不了要 exit 2 而不是 1**：1 表示"判过且有缺口"（可据此排期修）；2 表示"根本没判"。
   把 2 折成 1 会把"工具坏了"混进"门禁坏了"，两个修复责任人不同。
8. **为什么本批不接线**：接线要改 `scripts/pre-commit-check.sh` 或 `.gitea/workflows/**`，二者都不在本批写集内；
   强行接线会让"写集"与"实际改动"不一致（D296 认领制的第一条判据）。WIRING 因此如实填 `declared-only`。

## 已知限制（禁读成"已检测"）

1. G2 的别名是"确定性映射"不是语义映射：现网散文名不会命中 ⇒ 大多数 required 项报"未运行"（见决定 2）。
2. G2 只证"跑过"，不证"有判别力"：一条 miss 也只说明执行了。
3. G6 只证归一链路（0 透传、128 归 2），不证任何业务判据的判别力。
4. G10 只验 A 档与 D 档两态；B 档（双向控制符）/ C 档（U+FFFD）由 `--selfcheck` 与 #1108 的配对测试覆盖。
5. `--days` 窗口按 UTC 当前时刻截断（与 gate-stats 同口径），跨时区主机边界日可能差一条。
6. 不判"遥测日志是否被 .gitignore 忽略"（规格 §4 G2 的该子句留给后续卡）。
7. 不产出 JSON 机读格式（本批最小可跑；需要时按 `--json` 另卡加，不加半套）。

## 失效条件（这条判据何时可撤 / 何时必须改）

- 当 G1–G9 的机器件全部落地、总闸扩到十项时，本件的"三项"结构要重排：**不得**只改数字不改语义，
  且扩项必须同批更新配对测试与被拒清单。
- 若遥测命名与 inventory id 完成对齐（#1112 接线批次），G2 的"别名精确相等"应升级为 id 级映射，
  否则会把"已对齐但名字不同"误报成未运行。
- 若 `gate-assert.sh` 的 `ga_run` 契约变更（返回值语义/点名行格式），本件与 T4/T6 必须同批同步，
  否则 G6 会从"证归一"退化成"证它自己能跑"。

## 生效时点

手动/CI 显式调用即生效（本批**未接线**，不挂 pre-commit、不挂 CI）：
`bash scripts/control-tower/verify-governance.sh`。回滚点 = 删除本件与配对测试两文件
（无环境变量开关；因为"关掉总闸"必须留下可审的 diff）。
