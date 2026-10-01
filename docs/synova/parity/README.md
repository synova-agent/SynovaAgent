# docs/synova/parity —— 跨机预设/技能一致性（parity）口径说明

> 落地件：`scripts/control-tower/check-preset-parity.sh` ＋ 本目录 `mac.json` / `win.json`
> 规格源（唯一依据，只读）：`/Users/wane/山河研究院/05-组织协作工作流/补充研究-2-Win侧完整规格.md`
> `[W]:261`（§八 G4 行）／`[W]:277`（§九-7 落地行）／`[W]:284`（§九-14 #14 —— **先建议级**）
> 夹具：`tests/control-tower/check-preset-parity.test.sh`（含「改坏即红」判据⑤）

---

## 1. 指纹四项（逐字对齐 `[W]:261`，不多不少）

| # | json 键 | 取什么 | 唯一源 |
|---|---------|--------|--------|
| ① | `skills_sha256` | 16 个 skill 各一条 sha256 | `<repo>/.dsh/skills/<id>/`（整目录） |
| ② | `preset_cordis_patch_sha256` | 预设 `cordis.patch.yml` 各一条 sha256 | `<repo>/docs/synova/presets/<id>/cordis.patch.yml` |
| ③ | `dsh_anchor_tag` | DSH 断面 tag（**只读，不复制**） | `docs/synova/coordination/DSH-断面.json` 的 `current.tag` |
| ④ | `bundles_line_count` | 运行时 `dsh.profile.bundles` 条数 | 本机 profile `package.json`（解析序见 §6） |

生成物形态（两机必须**逐字节一致**）：

```json
{
  "schema": "synova/parity/v1",
  "skills_sha256": { "<skill-id>": "<64 位小写 hex>", "…": "…" },
  "preset_cordis_patch_sha256": { "<preset-id>": "<64 位小写 hex>" },
  "dsh_anchor_tag": "<DSH-断面.json 的 current.tag>",
  "bundles_line_count": 0
}
```

### 1.1 口径（复现命令逐条可核 —— 「计数必须带命令 + 口径」）

- **skill 摘要 = 整目录摘要**，不是单文件摘要：
  `sha256( 按相对路径排序的 "<relpath> <file-sha256>" 行拼接 + "\n" )`。
  取整目录的原因：`dev-doc-delivery/` 除 `SKILL.md` 还带 `template/编码指令模板.md`，
  只看 `SKILL.md` 会漏（本目录 16 个 skill / 17 个文件 —— 命令：
  `find .dsh/skills -type f | wc -l`）。
- **一律 LF 归一后取 sha256**（`b"\r\n" → b"\n"`）。原因：`.gitattributes` 只对
  `*.sh` / `*.py` 强制 LF，skill（`.md`）与预设（`.yml`）在 Windows `autocrlf=true`
  下会被检出成 CRLF —— 不归一会产生**跨机假红**。
- **json 以 UTF-8 字节直写**（不经文本模式 ⇒ 不落 CRLF），键序固定 + 子表按名排序
  ⇒ 幂等可复跑（重跑生成产出同字节）。
- **`bundles_line_count` = 数组条数**（每条一行）。与 `[W]:277` §九-4「Mac bundles 行同步移除」
  同一口径（那里说的「bundles 行」= bundles 表里的一行 = 一个条目）。
- ① 的基准数是 **16**（`[W]:261`）。生成时若 ≠ 16，脚本只在 stderr 打一条 `NOTE:`，
  **不判红** —— 多/少本身就是跨机差异，交给 §3 的 diff 判据点名，不在生成侧预设结论。

## 2. 怎么生成（两机各跑各提交）

```bash
# Mac（本机）—— 只写 docs/synova/parity/mac.json
bash scripts/control-tower/check-preset-parity.sh --generate --side mac

# Win —— 只写 docs/synova/parity/win.json
bash scripts/control-tower/check-preset-parity.sh --generate --side win
# （--side 可省：auto 按 uname 识别 Darwin→mac / MINGW|MSYS|CYGWIN→win；识别不出则显式降级 exit 2）
```

- 生成模式**只写本侧那一份 json**，不碰对侧、不写任何日志。
- 生成前会把解析到的 `repo-dir / parity-dir / skills-dir / preset-dir / anchor / profile-dir`
  逐行打 stderr（可观测，不静默）。
- 生成后请把本侧 json 随 PR 提交 —— CI diff 腿（§3）读的是**提交进仓的两份文件**。

## 3. 怎么比对（`--check`）

```bash
bash scripts/control-tower/check-preset-parity.sh --check          # 人读：不一致时 exit 1
bash scripts/control-tower/check-preset-parity.sh --check --advisory   # 建议级用：不一致仍 exit 0
```

| exit | 含义 | 摘要行 |
|------|------|--------|
| 0 | 两文件 LF 归一后**逐字节一致**；或对侧是**合法占位** | `PARITY: OK（…）` / `PARITY: PENDING（…）` |
| 1 | 不一致 / 指纹形态非法（= CI 里的**建议级红**） | `PARITY: DIFF（四项中 N 项不一致）— ADVISORY-RED …` |
| 2 | 降级：参数错 / `PYBIN` 不可用 / 文件缺失 / JSON 不可解析 / 不可写 | `PARITY: DEGRADED` + stderr `degraded: …` |

不一致时输出**逐条点名**（哪一项、哪条 skill/preset、A 值 vs B 值），例如：

```
PARITY-CHECK: mac.json <-> win.json
  （LF 归一后逐字节比对: 不一致）
  [DIFF] skills_sha256（A=16 B=16，值不同/单侧缺失 1）
      - cto-handover: A=<64hex> B=<64hex>
  [OK] preset_cordis_patch_sha256（A=2 B=2，值不同/单侧缺失 0）
  [OK] dsh_anchor_tag（A=<tag>）
  [DIFF] bundles_line_count: A=21 B=16
PARITY: DIFF（四项中 2 项不一致）— ADVISORY-RED 建议级红（…）
```

判定与诊断的分工（有意）：**红/绿由逐字节比对定**（对齐 `[W]:261`「两文件逐字节比对」），
逐项 diff 只负责**点名差异**，让红得可定位、可裁决。

## 4. 为什么先建议级（`[W]:284`）

parity diff 腿在 CI 里是**建议级红（不阻断）**，不是必需 context。三条具体理由：

1. **规格明写**：`[W]:284`（§九-14）「parity diff 腿**先建议级（不阻断）**；升级必需集走 1a/1b 流程」。
   本件的 CI 接线（`.github/workflows/ci.yml`）即按此办：跑、出 `::warning`、**不设 FAIL**。
2. **第④项可能天然不同域**：`bundles_line_count` 取的是**各机运行时 profile** 的条数。
   两侧「结构同构、清单按域」（`[W]:277` §九改述），条数未必天然相等 ——
   把这种**待裁决差异**直接做成阻断，会把每个 PR 打成红。
3. **首轮数据尚未两侧齐全**：Win 侧 json 目前是**占位**（§5），此刻硬红 = 把「还没提交」
   误报成「不一致」，噪声会让门禁链被绕过（V3.6 历史教训）。

升级为必需集（必修红）**不在本件**：按 `[W]:284` 走 1a/1b 流程裁决后再改 `ci.yml`。

## 5. 占位约定（`win.json` 当前状态）

`win.json` 现在是**占位**，标注「待 Win 侧生成/提交」——**没有伪造任何 Win 侧数据**：

```json
{ "schema": "synova/parity/v1", "placeholder": true, "status": "pending-win",
  "note": "占位：待 Win 侧生成/提交 …",
  "skills_sha256": null, "preset_cordis_patch_sha256": null,
  "dsh_anchor_tag": null, "bundles_line_count": null }
```

识别规则（**窄口径，防"占位"变成免检后门**）：合法占位 = `placeholder:true`
＋ `status` ∈ {`pending-mac`,`pending-win`} ＋ 非空 `note` ＋ **四项全 `null`**。
任一条不满足 → `PARITY: VIOLATION`（exit 1，建议级红）。
即：往占位里塞指纹值、或把真指纹的四项掏空，**都会红**（判据⑤「改坏即红」覆盖这两条路径）。

Win 侧提交真指纹后，占位被替换，本判据自动切到 §3 的逐字节比对。

## 6. 已知边界（不夸大能力）

- **本机 profile 解析序**（与 `check-preset-bundles.sh` 同口径）：
  `SYNO_PROFILE_DIR`（注入）→ `$DSH_HOME/profiles/desktop` →
  `~/.dsh-trial-017/profiles/desktop` → `~/.dsh/profiles/desktop`；解析结果每次生成都打印。
  换 home/换机可能取到不同 profile ⇒ ④ 值随之变化 —— 这正是 ④ 要暴露的机器级事实。
- **第④项只落"行数"**（按 `[W]:261` 逐字）：**同数不同成员不可判**（两侧都 21 条但成员不同
  → 本器不红）。升级为成员清单属「必需集升级」，走 `[W]:284` 的 1a/1b 流程，不在本件。
- **第③项取唯一源 tag，不取本机 DSH 树**：CI 读的是提交进仓的两份 json，只有仓内唯一源
  才能让两侧可比。`[W]:261` 说「Win 侧同步包 §7.1 的跨机版本对账命令并入指纹第三项」——
  落地方式：生成时若本机 DSH 树在场（`SYNO_DSH_TREE=<dir>`，或缺省看断面源 `current.path`
  是否存在的目录），脚本**只读**跑一次 `git rev-parse --short HEAD` ＋ 读 `package.json` 的
  `version`，与唯一源对账，输出 `NOTE:`（一致）/ `WARN:`（不一致）——**只告警、不改退出码**
  （树不在场 = 无法自证，显式留痕不猜）。
- **两 json 一律由本器生成**，勿手工编辑：手工改一侧即判据⑤要抓的红。

## 7. 为什么没有降级日志（与同目录其他门禁的有意差异）

本器受硬契约约束：**除 `docs/synova/parity/*.json`（生成模式）外零写入**；
**比对模式必须零写入**。故降级**不落** control-tower 五字段 `degraded-events.log`，
只走 stderr 显式 `degraded: <原因> (component=check-preset-parity, phase=…, retryable=true)`
＋ `exit 2`（D328 三态：2 绝不与 0 混同）。
零写入由夹具以**整树摘要前后比对**断言（`check` 模式跑前跑后沙箱逐文件 sha256 不变）。

## 8. CI 接线（建议级 diff 腿）

`.github/workflows/ci.yml` 两处（同一 PR 落地）：

1. **密封清单**：`tests/control-tower/check-preset-parity.test.sh` 入 `for t in` 列表
   —— 否则 `check-gate-integrity.sh` 判「未登记」而红（本仓最常踩的坑）。
2. **建议级 diff 腿**：独立 step 跑 `--check`，`PARITY: DIFF/VIOLATION` 只出
   `::warning`，**不进 `FAIL`**（`[W]:284` 不阻断）。该 step 不挂 `if:` 门控 ——
   两份 json 都在 `docs/` 下，改它们的 PR 正是 docs-only PR，会被重活门跳过，
   故 diff 腿必须无条件跑。

**未接线（诚实标注）**：`[W]:261` 的「＋周检兜底」在本件**未落地** —— 它要改的是既有周检线
（`scripts/control-tower/weekly-selfcheck.sh` 或 CI `schedule` 触发），不在本件写集内，
落点由 CTO 裁决后另立一行。本件交付面 = 脚本 + 两份 json + 夹具 + 上表两处 CI 接线。
