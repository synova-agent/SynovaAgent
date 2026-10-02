# D945 段④ — DSH 预设 bundle 一致性对账报告

> 写者: `d945-coder-a`（D945-A）｜工作树 `.synova-wt-squad-d945`｜分支 `feat/d945-preset-bundle`
> base: **栈式 base `feat/b3-d922-fixture` @ `1a6bf9a45158f5b335a15d0d9bab996e046033ba`**（2026-09-25 队长裁定 A；原 `origin/main 11458279` 因与 B3 同改 `ci.yml` 会冲突而改栈）
> 生成日期: 2026-09-25（UTC 2026-09-24T16:3x）｜工具: `scripts/control-tower/check-preset-bundles.sh`（本卡新增）
> 口径: 本报告只给**事实与原始输出**，不给"通过/审计通过"结论。判定阈值由 CTO/K3 定。

## 一句话结论

仓库侧 bundle 源已入库且形态合规（`--repo` rc=0）；**运行时 12 个 `@local/dsh-preset-*` 中 4 个与各自 legacy 源逐字节一致、8 个实质不同**；其中 `preset-synova-squad-lead` 的已装 patch **仍含 legacy `- id: delegation` 组、缺 `agent-team`**，而它的 legacy 源已是正解 → **D931（小队成员 ≤4 的 Agent Teams 接线）从未进入 bundle 层，即运行时未生效**。两处 home 的 legacy 目录均**仍在场**（12 / 11），`--consistency` 按卡面判红（rc=1）。

---

## §0 方法与可复现命令

环境（实测，非假设）：

```bash
$ echo "DSH_HOME=[${DSH_HOME:-<unset>}]  HOME=$HOME"
DSH_HOME=[/Users/wane/.dsh-trial-017]  HOME=/Users/wane

# 关键前提纠正：profiles/desktop 不是仓库相对路径，而是 DSH home 相对路径
$ find . -path ./node_modules -prune -o -type d -name 'profiles' -print
（零命中 — 仓库内无 profiles/ 目录）
$ ls -1 ~/.dsh-trial-017/profiles/desktop/node_modules/@local/ | wc -l
12
$ python3 -c "import json;print(len(json.load(open('$DSH_HOME/profiles/desktop/package.json'))['dsh']['profile']['bundles']))"
16
$ ls -1 ~/.dsh/profiles/desktop/node_modules/@local/ 2>/dev/null | wc -l
0
```

复现命令（全部原样可跑）：

```bash
bash scripts/control-tower/check-preset-bundles.sh --repo          # 仓库源形态
bash scripts/control-tower/check-preset-bundles.sh --consistency   # 运行时 vs 仓库源 + legacy 边界
SYNO_EMIT_DATE=2026-09-25 bash scripts/control-tower/check-preset-bundles.sh --emit synova-squad-lead
bash tests/control-tower/check-preset-bundles.test.sh              # 夹具（PASS=39 FAIL=0）
```

---

## §1 段① 产物：仓库侧 bundle 源

| 文件 | sha256 |
|---|---|
| `docs/synova/presets/synova-squad-lead/package.json` | `9a3353cdf7262245f3c17a290f6c515da4e70cda290efd97f64be9b4d855731d` |
| `docs/synova/presets/synova-squad-lead/cordis.patch.yml` | `24cf1677413f36d84226b80a826011da2d3f1a3c287744af8d50e259124ba47d` |

**生成可信性（不是手抄）**：生成器先用**已入库参考件** `@local/dsh-preset-synova-cto/cordis.patch.yml` 做逐字节回归：

```bash
$ diff -q /tmp/d945-cto-gen.yml <synova-cto 已装 patch>   # 用 legacy 源 + date=2026-09-23 复算
BYTE-IDENTICAL: generator reproduces reference exactly
gen sha256: 231157acb51fb8d63c368c37d47cc053e5331f2c6a57b139c1e8d5ecd959a81a
ref sha256: 231157acb51fb8d63c368c37d47cc053e5331f2c6a57b139c1e8d5ecd959a81a
```

**`--emit` 对本卡产物逐字节可复现**（审计复现路径）：

```bash
$ SYNO_EMIT_DATE=2026-09-25 bash .../check-preset-bundles.sh --emit synova-squad-lead > /tmp/e.yml
$ shasum -a 256 /tmp/e.yml docs/synova/presets/synova-squad-lead/cordis.patch.yml
emit sha256:      24cf1677413f36d84226b80a826011da2d3f1a3c287744af8d50e259124ba47d
committed sha256: 24cf1677413f36d84226b80a826011da2d3f1a3c287744af8d50e259124ba47d
✅ EMIT REPRODUCES COMMITTED FILE BYTE-IDENTICALLY
```

**硬判据（卡面验收 5 原样）**：

```bash
$ grep -c "agent-team" docs/synova/presets/synova-squad-lead/cordis.patch.yml
6
$ grep -c "id: delegation" docs/synova/presets/synova-squad-lead/cordis.patch.yml
0
```

同两条命令的 `--repo` 判定：

```bash
$ bash scripts/control-tower/check-preset-bundles.sh --repo; echo rc=$?
REPO-OK: synova-squad-lead package.json + ./cordis.patch.yml 形态合规
--repo 汇总: 发现 1 个预设, 违规 0 个
rc=0
```

---

## §2 逐预设对账

### 表 A — 仓库源 vs 运行时（`--consistency` 原始输出，逐字）

```bash
$ bash scripts/control-tower/check-preset-bundles.sh --consistency; echo rc=$?
STALE: synova-squad-lead 陈旧: /Users/wane/.dsh-trial-017/profiles/desktop/node_modules/@local/dsh-preset-synova-squad-lead/cordis.patch.yml ≠ /Users/wane/SynovaAgent/.synova-wt-squad-d945/docs/synova/presets/synova-squad-lead/cordis.patch.yml
     证据: installed agent-team=0 id-delegation=1 | repo agent-team=6 id-delegation=0
RUNTIME-ONLY: @local/dsh-preset-liangshen 已安装但仓库无 bundle 源（…/@local/dsh-preset-liangshen）
RUNTIME-ONLY: @local/dsh-preset-securities-research 已安装但仓库无 bundle 源（…）
RUNTIME-ONLY: @local/dsh-preset-shanhe-business 已安装但仓库无 bundle 源（…）
RUNTIME-ONLY: @local/dsh-preset-shanhe-director 已安装但仓库无 bundle 源（…）
RUNTIME-ONLY: @local/dsh-preset-shanhe-product 已安装但仓库无 bundle 源（…）
RUNTIME-ONLY: @local/dsh-preset-shanhe-tech 已安装但仓库无 bundle 源（…）
RUNTIME-ONLY: @local/dsh-preset-shanhe-theory 已安装但仓库无 bundle 源（…）
RUNTIME-ONLY: @local/dsh-preset-synova-cto 已安装但仓库无 bundle 源（…）
RUNTIME-ONLY: @local/dsh-preset-synova-devdoc 已安装但仓库无 bundle 源（…）
RUNTIME-ONLY: @local/dsh-preset-synova-dsh 已安装但仓库无 bundle 源（…）
RUNTIME-ONLY: @local/dsh-preset-synova-k3-audit 已安装但仓库无 bundle 源（…）
LEGACY-PRESENT: /Users/wane/.dsh-trial-017/.agent-presets/liangshen 仍在场（已有 bundle 等价物 …）
LEGACY-PRESENT: /Users/wane/.dsh-trial-017/.agent-presets/securities-research 仍在场（…）
LEGACY-PRESENT: /Users/wane/.dsh-trial-017/.agent-presets/shanhe-business 仍在场（…）
LEGACY-PRESENT: /Users/wane/.dsh-trial-017/.agent-presets/shanhe-director 仍在场（…）
LEGACY-PRESENT: /Users/wane/.dsh-trial-017/.agent-presets/shanhe-product 仍在场（…）
LEGACY-PRESENT: /Users/wane/.dsh-trial-017/.agent-presets/shanhe-tech 仍在场（…）
LEGACY-PRESENT: /Users/wane/.dsh-trial-017/.agent-presets/shanhe-theory 仍在场（…）
LEGACY-PRESENT: /Users/wane/.dsh-trial-017/.agent-presets/synova-cto 仍在场（…）
LEGACY-PRESENT: /Users/wane/.dsh-trial-017/.agent-presets/synova-devdoc 仍在场（…）
LEGACY-PRESENT: /Users/wane/.dsh-trial-017/.agent-presets/synova-dsh 仍在场（…）
LEGACY-PRESENT: /Users/wane/.dsh-trial-017/.agent-presets/synova-k3-audit 仍在场（…）
LEGACY-PRESENT: /Users/wane/.dsh-trial-017/.agent-presets/synova-squad-lead 仍在场（…）
--consistency 汇总: 一致 0, 陈旧 1, legacy 判红 12
rc=1
```

> 说明: 11 条 `RUNTIME-ONLY` = 该预设**仓库侧无 bundle 源**，按卡面口径（"--consistency 与**仓库源**对账"）无基准可判 —— 不是"已判绿"。它们的真实状态见表 B。

### 表 B — 12 个已装 bundle vs **各自 legacy 源**（复算，补充口径）

判定方式: 用同一生成器由 `~/.dsh-trial-017/.agent-presets/<id>/{agent.cordis.yml,preset.yml}` 复算 patch，与 `@local/dsh-preset-<id>/cordis.patch.yml` 逐字节比较；并对头日期行做了**单独归类**（避免把"仅日期行不同"误报为漂移）：

| preset | 判定 | legacy sha8 | installed sha8 | installed `agent-team` | installed `id: delegation` | legacy `agent-team` | legacy `id: delegation` |
|---|---|---|---|---|---|---|---|
| liangshen | **实质内容不同**（≥365 行） | 92b3e481 | b436baa5 | 0 | 1 | 0 | 1 |
| securities-research | **实质内容不同**（≥245 行） | 97959fab | 0ca5bc64 | 0 | 1 | 0 | 1 |
| shanhe-business | **实质内容不同**（≥239 行） | 2c06307e | 0fcc7d84 | 0 | 1 | 0 | 1 |
| shanhe-director | **实质内容不同**（≥242 行） | 86341101 | 9a512166 | 0 | 1 | 0 | 1 |
| shanhe-product | **实质内容不同**（≥254 行） | 4a35e118 | d3b1f1f6 | 0 | 1 | 0 | 1 |
| shanhe-tech | **实质内容不同**（≥239 行） | dc8e7d89 | 15168823 | 0 | 1 | 0 | 1 |
| shanhe-theory | **实质内容不同**（≥246 行） | f4869627 | 39caf927 | 0 | 1 | 0 | 1 |
| synova-cto | 逐字节一致（date=2026-09-23） | 231157ac | 231157ac | 0 | 1 | 0 | 1 |
| synova-devdoc | 逐字节一致 | 908e95fa | 908e95fa | 0 | 1 | 0 | 1 |
| synova-dsh | 逐字节一致 | 10eaf8d2 | 10eaf8d2 | 0 | 1 | 0 | 1 |
| synova-k3-audit | 逐字节一致 | 9ac32eb9 | 9ac32eb9 | 0 | 0 | 0 | 0 |
| **synova-squad-lead** | **实质内容不同**（≥84 行） | 0923ae98 | 31cfc611 | **0** | **1** | **6** | **0** |

汇总: **4 一致 / 8 实质不同**。

> **差异方向未判定**：表 B 只报"installed ≠ legacy 源"这一事实。7 个非 Synova 预设（liangshen/securities-research/shanhe-×5）的差异**未**在本卡判定哪一侧为正解 —— 抽样见一处：installed 含 `order: 4` 而 legacy 源无（`liangshen` diff 首行）。这属他域，交 CTO 裁定（§6 未决项 4）。
> **唯一例外是 synova-squad-lead**：其正解由 CTO 在本卡前提中指定（legacy 源 sha `ce80a3da057130ecfafe4a55ce4dd3a4f0b1e21e780905a8f493f171cbc62c9d`，含 `agent-team`、无 `delegation`），且本卡 §1 已按该源生成入库产物。

---

## §3 点名：`preset-synova-squad-lead` 的 `delegation` 残留 / `agent-team` 缺失

**已装 patch（陈旧，runtime）**：

```bash
$ P=~/.dsh-trial-017/profiles/desktop/node_modules/@local/dsh-preset-synova-squad-lead
$ grep -c "agent-team" "$P/cordis.patch.yml"; grep -c "id: delegation" "$P/cordis.patch.yml"
0
1
$ shasum -a 256 "$P/cordis.patch.yml"
31cfc611ab582ed993bf7bef881859447ff13a3bc94e382bb8e382cb9d587b6d
```

**仓库源（本卡入库，正解）**：

```bash
$ grep -c "agent-team" docs/synova/presets/synova-squad-lead/cordis.patch.yml
6
$ grep -c "id: delegation" docs/synova/presets/synova-squad-lead/cordis.patch.yml
0
```

**差异性质**（unified diff 摘要，installed → 正解）：diff 共 **81** 行，形态是**整块替换**，不是零星漂移：

```
@@ -220,62 +220,17 @@
-          - id: delegation
-            name: cordis:group
-            ...
-              - id: tool-subagent-control
-              - id: tool-subagent
-              - id: tool-subagent-fork
-              - id: workflow-ptc
-              - id: tool-ralph
+          - id: agent-team
+            name: '@deepseek-ai/dsh-experimental-agent-team'
+            config:
+              maxMembers: 4
+          - id: tool-agent-team
+          - id: ui-agent-team
```

**为什么这条是 P0 级事实**（引 DSH 上游源码，非我方推断）：

```
packages/boot/app-boot/src/profile.ts:5-16
 * A profile is a directory under `$DSH_HOME/profiles/<name>` holding a
 * `package.json` (… the profile manifest `dsh.profile` with its ordered `bundles` list)
 * and a `cordis.patch.yml` (the user's own patch layer, applied after every bundle layer).
 * … the tree is composed by applying each bundle's patch lists in `dsh.profile.bundles`
 *   order over an empty entry list, then the profile's own patches …
```

即**运行时组成 = bundle 层**（`node_modules/@local/dsh-preset-*/cordis.patch.yml`），而 legacy 目录**已不被上游读取**：

```bash
$ grep -rln "agent-presets" <DSH checkout>/packages/*/src <DSH checkout>/apps/*/src | wc -l
0
$ head -20 <DSH checkout>/.agents/notes/implemented/architecture/2026-09-18-declarative-agent-presets.md
# Agent Note: Declarative Agent presets and retained revisions  (Status: implemented)
## Alternatives considered
**Keep directory presets alongside declarations.** Two writable sources would compete for an
identity and require precedence, migration and editing rules. Ordinary profile configuration
supplies the required persistence and layering, so presets have no separate paths.
```

**结论（事实层）**：陈旧的是**生效中的那一份**；`agent-team`，也就是"成员 ≤4"的小队物理接线，**没有**在运行时生效。D931 修复只落在 legacy 源，从未随 bundle 层落位。另核：运行时 user patch 层 `profiles/desktop/cordis.patch.yml` **不含**任何 preset/delegation/agent-team 覆盖（`grep -n "preset\|agent-team\|delegation\|squad"` → 零命中），故不存在"上层覆盖救回来"的情况。

---

## §4 legacy 边界判据（在场 / 复活）

两处 home 均在场（本卡**禁删**，未做任何删除）：

```bash
$ ls -1 ~/.dsh-trial-017/.agent-presets | tr '\n' ' '
liangshen securities-research shanhe-business shanhe-director shanhe-product shanhe-tech shanhe-theory synova-cto synova-devdoc synova-dsh synova-k3-audit synova-squad-lead
$ ls -1 ~/.dsh-trial-017/.agent-presets | wc -l ; ls -1 ~/.dsh/.agent-presets | wc -l
12
11
```

判据实现（`check-preset-bundles.sh --consistency`）：

- **在场 → 判红**：每个 legacy 子目录一行 `LEGACY-PRESENT:`，并区分「已有 bundle 等价物」（可退役）/「尚无 bundle 等价物」（仅运行时可读）。本次 12/12 均为「已有 bundle 等价物」。
- **复活 → 判红**：跨运行记忆落在 `SYNO_PRESET_LEGACY_JOURNAL`（默认 `.codex/control-tower/logs/preset-legacy-journal.log`，`*.log` 已被 .gitignore 覆盖，不入仓）。`present → 消失` 记 `LEGACY-RETIRED`；再出现即 `LEGACY-REVIVED` + 判红。夹具 M3 三段实测：`LEGACY-PRESENT`(rc=1) → `LEGACY-RETIRED`(rc=0) → `LEGACY-REVIVED`(rc=1)。
- 观察日志本次实际内容（节选，证明判据在跑）：

```
synova-squad-lead	present	2026-09-24T16:33:01Z
… （12 行 × 3 次运行）
```

**收口的阻塞项（交 CTO）**：本仓仍有一处**活消费者**读 legacy：

```
dsh/plugins/synova-dashboards/scripts/install-dashboards.sh:22
PRESET_FILE="$DSH_HOME_DIR/.agent-presets/synova-cto/agent.cordis.yml"
:73  elif ! grep -qF "$MARKER" "$PRESET_FILE"; then      # :71-76 真读真改（删旧 loader 块）
```

全仓 `grep -rn "agent-presets"`（脚本/ts/py/json/yml）= **22 处**，其中活消费者**只有这一处**且只碰 `synova-cto`。因此 `synova-cto` 的 legacy 目录在 Dashboards 改道前**删不得**；`synova-squad-lead` 未发现任何消费者。这一条**不改变**判红语义（见 §6 未决项 1）。

---

## §5 降级与缺口

- **本次全部运行无降级事件**：`.codex/control-tower/logs/degraded-events.log` 未生成（`--repo`/`--consistency`/`--emit`/夹具四类运行均正常路径）；夹具中的降级路径（T4/T5/T6）在 mktemp 沙箱内命中 `exit 2` + 五字段日志。
- 降级记录格式（五字段 + schema 版本戳，对齐 `scripts/control-tower/control_tower_log.py`）：

```json
{"schema": "control-tower/logs/degraded/v1", "time": "2026-09-24T16:33:56Z", "component": "install-dsh-preset", "phase": "install", "reason": "bundle 源目录不存在: /tmp/…/nope", "retryable": true}
```

- **缺口**：11 个 `@local/dsh-preset-*` **仓库侧无 bundle 源** → 无法用"仓库源"口径判绿（表 A 如实标 RUNTIME-ONLY）。表 B 的 legacy 复算是我方补充口径，未写进 checker 判据（卡面口径是"vs 仓库源"）。

---

## §6 未决项（交 CTO，均需裁定，我不自决）

1. **legacy 判红 vs Dashboards 活消费者**：卡面「legacy 在场 → 判红」照做（未软化）。但 `synova-cto` 的 legacy 目录在被 `install-dashboards.sh` 读取期间判红**无法清零**（永久红）。选项：(a) 先派工改道 Dashboards 再收口；(b) 裁定 `synova-cto` 单条豁免（我建议用**登记表**驱动而非 if 特例）。`--repo` 不含 legacy 判据，绿腿不受影响。
2. ~~**`.github/workflows/ci.yml` canary 登记 = held**（队长 2026-09-25 通知：与 B3 `feat/b3-d922-fixture` 必冲突，等栈式裁定）~~ → **已闭合（2026-09-25，栈式裁定 A 后补做）**：新 base `feat/b3-d922-fixture @ 1a6bf9a4` 上追加 1 行，回执如下（注意：该 base 的 canary **末项 = `install-dsh-preset.test.sh; do`**（B3 把原末二项替换为它），不是旧 base 的 `verify-doc.test.sh:258`；为使 `git diff --stat` 恰为 `1 insertion(+)`、零删除，本行插在该末项**之前**，仍在同一 `for t in` 密封清单内，功能等价）：

```bash
$ grep -n "check-preset-bundles.test.sh" .github/workflows/ci.yml
267:            tests/control-tower/check-preset-bundles.test.sh \

$ git diff --stat -- .github/workflows/ci.yml
 .github/workflows/ci.yml | 1 +
 1 file changed, 1 insertion(+)

$ node -e "const y=require('js-yaml'),fs=require('fs');y.load(fs.readFileSync('.github/workflows/ci.yml','utf8'));console.log('YAML_OK')"
YAML_OK

$ bash scripts/control-tower/check-canary-drift.sh | grep -c "check-preset-bundles"
0     # 已不在漂移清单 → 登记生效
```
另：提取 `for t in … done` 块（54 行、剥 YAML 缩进）`bash -n` rc=0（YAML 解析不覆盖 `run:` 体内的 bash 语法，故单独验）；B3 的条目 `install-dsh-preset.test.sh` 与证据步**零改动**（diff 仅 1 插入行）。
3. **运行时落位未执行**：`install-dsh-preset.sh --install` 只在 mktemp 沙箱验证过；**未**对真实 `~/.dsh-trial-017/profiles/desktop` 执行 → 陈旧 bundle **仍在生效**（§3）。执行者/时机需 CTO 定（我未获授权改运行时）。
4. **7 个非 Synova 预设的 stale 归因**：installed ≠ legacy 源（239–365 行），哪一侧为准未判（§2 表 B）。属他域。
5. **冗余 legacy 载体**：`docs/synova/presets/synova-squad-lead/{preset.yml,SYSTEM-PROMPT.md}` 在 bundle 化后不再被任何流程读取（新流程只读 `package.json`+`cordis.patch.yml`）。**不在本卡写集**，未删；建议 CTO 另开卡退役。
6. **新增第 5 个注入缝（我主动声明）**：卡面列了 4 个缝，我另加 `SYNO_PRESET_LEGACY_JOURNAL`（复活判据的跨运行记忆）与 `SYNO_EMIT_DATE`（`--emit` 逐字节复现的日期钉）。二者只影响工具自身行为，不改任何判据语义。
7. **`--repo` 目前只覆盖 1 个预设**：`synova-cto`/`synova-k3-audit` 在 `docs/synova/presets/` 下只有 `preset.yml`/`persona-block.yml`，无 bundle 源 → `--repo` 对其"零样本"，不是判绿。

---

## §7 本报告的证据边界

- 本报告**不是**审计结论，也不宣称"产品被验证"。K3 复审前不作为合并依据。
- 表 B / §4 的部分数字来自一次性复算脚本（生成器与 checker 内嵌生成器同源、且已用 `synova-cto` 参考件逐字节回归）；checker 自身的判定面由夹具 `tests/control-tower/check-preset-bundles.test.sh` 覆盖（**PASS=39 FAIL=0**，含 M1–M4 变异体与恒真探针判别性自证）。栈式 base 切换后全部复跑一次：`bash -n`×4 rc=0、`--repo` rc=0、`--consistency` rc=1、夹具 PASS=39 FAIL=0、`--emit` 逐字节复现、`check-ownership.py` 8 路径 rc=0（7 mac + 报告 domain-neutral）。
- 所有"陈旧 / 一致"均为**字节级**判定，非 grep 型静态判据。
