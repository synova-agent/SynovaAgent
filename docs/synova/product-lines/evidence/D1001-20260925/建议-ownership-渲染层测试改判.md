# D1001 建议件 — ownership.yaml 渲染层测试归属改判 mac（建议 + 证据，Mac-CTO 执行改表）

> 撰写：code-a（D1001 小队）｜ 2026-09-25
> 性质：**建议件，本卡零代码改动**。`docs/synova/coordination/ownership.yaml` 为 **Mac-CTO 单写者**，Win 方不得直接改（派单件 §四 硬约束）。
> 基准：`origin/main` = `6a714483`（本卡独立 worktree HEAD 同此，实测时点与全部原始输出见同目录《证据集-原始输出.md》）。
> 判据对照：本文按派单件 §三 3.1–3.4 逐项产出，判据 W1–W6（§四）逐条可查。
> 修订（2026-09-25）：**RV-1 已获 CTO 放行**，四项 delta 已并入——①再生命令编码陷阱（§四 期望④）｜②反向验证重写为天然前后对照（§六）｜③测试补丁 58→60（§四-补）｜④D935 遗留转建议（§六-补）；落点索引见 §九。

---

## 一、为什么必须改（实测，非推断）

**现象（E1 实测，EXIT=1）**：3 件渲染层/桌面端测试全判 win，目标源文件判 mac → 单域 PR 直接被「跨域」拦死：

```
$ python scripts/control-tower/check-ownership.py tests/electron/dual-guide-packaging-guard.test.ts tests/ga-collab-logic.test.ts tests/ga-collab-ui.test.ts electron-renderer/src/lib/api.ts
win  tests/electron/dual-guide-packaging-guard.test.ts
win  tests/ga-collab-logic.test.ts
win  tests/ga-collab-ui.test.ts
mac  electron-renderer/src/lib/api.ts

❌ FAIL 跨域: 变更落在 2 个域 ['mac', 'win'] —— 单个 PR 只许一个域（无归属 0，域判定豁免 0）
EXIT=1
```

**根因两条（叠加）**：

1. `ownership.yaml` **没有** `tests/electron/**` 与 `tests/ga-collab-*` 规则 → 这些测试落 L35 `**` 兜底判 win（E4 实测：现有 43 条 glob 规则中无一覆盖，兜底在 L35，electron-renderer/** 在 L175，其后直接是 K3 段）。
2. 根 `vitest.config.ts:28` `include: ['./tests/**/*.test.ts', './tests/**/*.integration.test.ts']`（origin/main 实读，见证据集 §十）⇒ **渲染层测试只能住在 `tests/` 下**，不可能靠挪目录规避。

**不是个案（E3 实测，共 8 处 import）**：`tests/` 下 ≥3 件测试的 import 主体是 `../electron-renderer/src/**`：

```
origin/main:tests/ga-collab-logic.test.ts:29:} from '../electron-renderer/src/stores/ga-collab';
origin/main:tests/ga-collab-ui.test.ts:17:import { GaDetailSections, type GaDetailSectionsProps } from '../electron-renderer/src/components/ga-detail-sections';
origin/main:tests/ga-collab-ui.test.ts:18:import { renderToStaticMarkup } from '../electron-renderer/src/test-support/render';
origin/main:tests/ga-collab-ui.test.ts:19:import type { GaCalibrationItem } from '../electron-renderer/src/stores/ga-collab';
origin/main:tests/llm-config-frontend.test.ts:25:} from '../electron-renderer/src/stores/llm-config';
origin/main:tests/llm-config-frontend.test.ts:26:import { LlmSetupCard } from '../electron-renderer/src/components/LlmSetupCard';
origin/main:tests/llm-config-frontend.test.ts:27:import { WelcomePanel } from '../electron-renderer/src/components/WelcomeScreen';
origin/main:tests/llm-config-frontend.test.ts:28:import { renderToStaticMarkup } from '../electron-renderer/src/test-support/render';
```

**归属依据**：CTO 三原则第②条「**测试跟随被测模块**」。被测主体 `electron/**`（表 L172）、`electron-renderer/**`（表 L175）均 mac；且表内已有同型先例 `tests/sentinel/**`（L58-60，source 自述「哨兵体系核心=Mac，其测试随域」）与 `tests/control-tower/**`（L106-108）、`tests/doc-system/**`（L85-87）、`tests/project/**`（L123-125）。

---

## 二、建议新增的两条规则（§3.1：逐字，可直接复制进 yaml）

```yaml
  - glob: "tests/electron/**"
    owner: "mac"
    source: "D1001：测试跟随被测模块（electron/** 与 electron-renderer/** 均 mac）"
  - glob: "tests/ga-collab-*.test.ts"
    owner: "mac"
    source: "D1001：同上（ga-collab-logic/ui 两件被测主体均为 electron-renderer/src/stores|components）"
```

缩进/引号/键名与现有表逐字一致（对照 L172-177 `electron/**`、`electron-renderer/**` 两规则：列表项 2 空格缩进，`glob`/`owner`/`source` 三键，值带双引号）。

**可选注释段**（仿表内 D806/D914/D935 增补惯例，不改变语义，供 Mac-CTO 酌情采用；本卡沙箱预演即带此段）：

```yaml
  # D1001 增补（2026-09-25）: 渲染层/桌面端测试跟随被测模块。被测主体 electron/** 与
  #   electron-renderer/** 均 mac（本表 L172/L175），而 tests/ 根与 tests/electron/ 无规则，
  #   落 `**` 兜底误判 win（D1001 E1/E5 实测 FAIL 跨域，卡住桌面端单域 PR）。测试随被测
  #   模块归属（同 tests/sentinel/** 先例）。不改任何既有归属。
```

### 插入位置（E4 实测定位）

- **语义硬约束**：表语义「规则按顺序求值，**最后匹配者胜出**」（表头注释 L8-9）。新规则 owner=mac，必须排在 L35 `**` 兜底行**之后**才生效。
- **具体落点**：**L177（`electron-renderer/**` 规则的 source 行）之后、L179（`# ═══ Kimi K3 审计红线` 段注释）之前**（即现 L178 空行处）。这样两条 mac 规则收在 Mac 例外区末尾、不混入 K3 段。
- E4 定位原始输出（节选，全文见证据集 §四）：

```
origin/main:docs/synova/coordination/ownership.yaml:35:  - glob: "**"          ← 兜底（win）
origin/main:docs/synova/coordination/ownership.yaml:58:  - glob: "tests/sentinel/**"
origin/main:docs/synova/coordination/ownership.yaml:172:  - glob: "electron/**"
origin/main:docs/synova/coordination/ownership.yaml:175:  - glob: "electron-renderer/**"
origin/main:docs/synova/coordination/ownership.yaml:180:  - glob: "scripts/audit/**"   ← K3 段首条规则（L179 为段注释）
```

### 为什么是 glob 不是列单文件（派单件 §3.1 明示）

只列 `ga-collab-logic` 一件，下一张桌面卡撞 `ga-collab-ui` 时同一堵墙再出现一次。两条 glob 覆盖：`tests/electron/**` 全部 13 件既有测试（E2）+ 未来新建；`tests/ga-collab-*.test.ts` 覆盖 logic/ui 两件既有 + 同族未来件。

---

## 三、证据 E1–E5（§3.2：全部实跑原始输出，完整版见证据集）

> 采集环境：Windows，`python` = Python 3.13.13，worktree HEAD = `6a714483` = `origin/main`（干净）。Mac-CTO 复现时等价替换 `python3`；`EXIT=` 行为本方回显，非工具输出。

### E1 改造前跨域证据（EXIT=1）

```
$ python scripts/control-tower/check-ownership.py tests/electron/dual-guide-packaging-guard.test.ts tests/ga-collab-logic.test.ts tests/ga-collab-ui.test.ts electron-renderer/src/lib/api.ts
win  tests/electron/dual-guide-packaging-guard.test.ts
win  tests/ga-collab-logic.test.ts
win  tests/ga-collab-ui.test.ts
mac  electron-renderer/src/lib/api.ts

❌ FAIL 跨域: 变更落在 2 个域 ['mac', 'win'] —— 单个 PR 只许一个域（无归属 0，域判定豁免 0）
EXIT=1
```

### E2 `tests/electron/` 既有清单（恰 13 件，EXIT=0）

```
$ git ls-tree --name-only origin/main tests/electron/
tests/electron/auto-update.test.ts
tests/electron/backend-spawn.test.ts
tests/electron/capability.test.ts
tests/electron/desktop-build.test.ts
tests/electron/dual-guide-packaging-guard.test.ts
tests/electron/ipc-contract.test.ts
tests/electron/mac-install-verify.test.ts
tests/electron/notification-center.test.ts
tests/electron/right-panel-report-sentinel.test.ts
tests/electron/upgrade-data-verify.test.ts
tests/electron/use-streaming-contract.test.ts
tests/electron/use-streaming-conversation.test.ts
tests/electron/win-install-verify.test.ts
EXIT=0
```

**点名**：`dual-guide-packaging-guard.test.ts` 系 **D716（Win 线）** 所建 —— 创建提交实测 `b1618971 feat(D716): 1-5 双引导收敛——旧安装引导退场（410 显式下线 + 回归守卫） (#538)`（`git log --oneline --diff-filter=A origin/main -- tests/electron/dual-guide-packaging-guard.test.ts`，证据集 §二）。其头注自陈「本文件对 electron/、electron-renderer/、build-synova.cjs **只读断言**（Mac DSH 域，零写入）」⇒ 改判 mac 是**纠正旧误标**，不是把 Win 资产划走（派单件 §八-2）。

### E3 三件测试 import 主体（共 8 处，EXIT=0）

逐行贴全见本文 §一（ga-collab-logic 1 处 / ga-collab-ui 3 处 / llm-config-frontend 4 处），全部指向 `../electron-renderer/src/**`。

### E4 表内位置（EXIT=0）

43 条 glob 行全列见证据集 §四；关键行：兜底 `**`=L35、`electron/**`=L172、`electron-renderer/**`=L175、K3 段注释=L179（其首条规则 `scripts/audit/**`=L180）。

### E5 切片 B 候选 8 文件改表前现状（EXIT=1）

> 8 文件清单出处：D1000 派单件 `66c1cb5e` §五 切片 B 写集表（L154-167）+ D1000 PLAN `origin/docs/d948-plan` §4 B-①（「写集真实最小 = 8 文件（6 mac + 2 win）> 派单 ≤6；CTO R3 已批准 8 文件。两条缺口（app-store.ts / tests/ga-collab-logic.test.ts）」）+ §6（「P0-a+ 唯一实测可放行选项，✅ PASS 8 个文件同域 mac」）。D1000 勘误：派单正文旧号一律按 D1000 读，故新建测试代表路径用 `tests/electron/d1000-identity-chain-desktop.test.ts`（工具契约支持未创建路径，测试套 §6「尚未创建的文件路径也可判域」已覆盖）。

```
$ python scripts/control-tower/check-ownership.py electron-renderer/src/stores/auth-session.ts electron-renderer/src/stores/ga-collab.ts electron-renderer/src/components/RightPanel.tsx electron-renderer/src/components/LoginPanel.tsx electron-renderer/src/lib/api.ts electron-renderer/src/stores/app-store.ts tests/electron/d1000-identity-chain-desktop.test.ts tests/ga-collab-logic.test.ts
mac  electron-renderer/src/stores/auth-session.ts
mac  electron-renderer/src/stores/ga-collab.ts
mac  electron-renderer/src/components/RightPanel.tsx
mac  electron-renderer/src/components/LoginPanel.tsx
mac  electron-renderer/src/lib/api.ts
mac  electron-renderer/src/stores/app-store.ts
win  tests/electron/d1000-identity-chain-desktop.test.ts
win  tests/ga-collab-logic.test.ts

❌ FAIL 跨域: 变更落在 2 个域 ['mac', 'win'] —— 单个 PR 只许一个域（无归属 0，域判定豁免 0）
EXIT=1
```

读法：6 件渲染层源码已判 mac，仅 #7（tests/electron/ 未创建路径）与 #8（tests/ 根）落兜底判 win——**改表所补正是这两个洞**。

---

## 四、改表后应当达到什么（§3.3：期望①–⑥，每条一条命令可复现）

> Mac-CTO 落表后在仓库根执行（macOS 用 `python3`）。每条期望我方已在**沙箱**（TEMP 副本 + `--yaml`，不动仓库）预演出同款输出，编号 S1–S6 见证据集 §十一。

**期望①** `tests/electron/**` 13 件逐条判 mac：

```bash
python3 scripts/control-tower/check-ownership.py tests/electron/auto-update.test.ts tests/electron/backend-spawn.test.ts tests/electron/capability.test.ts tests/electron/desktop-build.test.ts tests/electron/dual-guide-packaging-guard.test.ts tests/electron/ipc-contract.test.ts tests/electron/mac-install-verify.test.ts tests/electron/notification-center.test.ts tests/electron/right-panel-report-sentinel.test.ts tests/electron/upgrade-data-verify.test.ts tests/electron/use-streaming-contract.test.ts tests/electron/use-streaming-conversation.test.ts tests/electron/win-install-verify.test.ts
```

期望输出：13 行 `mac` + `✅ PASS 13 个文件同域: mac`，EXIT=0（沙箱 S1 已实测同款）。

**期望②** ga-collab 两件判 mac：

```bash
python3 scripts/control-tower/check-ownership.py tests/ga-collab-logic.test.ts tests/ga-collab-ui.test.ts
```

期望输出：2 行 `mac` + `✅ PASS 2 个文件同域: mac`，EXIT=0（沙箱 S2）。

**期望③** D1000 切片 B 候选 8 文件同域 mac：

```bash
python3 scripts/control-tower/check-ownership.py electron-renderer/src/stores/auth-session.ts electron-renderer/src/stores/ga-collab.ts electron-renderer/src/components/RightPanel.tsx electron-renderer/src/components/LoginPanel.tsx electron-renderer/src/lib/api.ts electron-renderer/src/stores/app-store.ts tests/electron/d1000-identity-chain-desktop.test.ts tests/ga-collab-logic.test.ts
```

期望输出：8 行 `mac` + `✅ PASS 8 个文件同域: mac`，EXIT=0（沙箱 S3；与 D1000 PLAN §6 P0-a+ 行的实测结论一致）。

**期望④** CODEOWNERS 与生成结果逐字节一致（零 drift）。Mac-CTO 落表后**必须先重跑生成**再验：

```bash
python3 scripts/control-tower/check-ownership.py --emit-codeowners > .github/CODEOWNERS
python3 scripts/control-tower/check-ownership.py --emit-codeowners | diff - .github/CODEOWNERS
```

期望输出：diff **零输出**，EXIT=0。

> **⚠️ 再生命令编码陷阱（RV-1.3a；macOS bash 天然无此问题，Windows/PowerShell 复现时必读）**
> 1. **Windows PowerShell 5.1 的 `>` 默认写 UTF-16LE + BOM**。本卡实测：同一 emit 输出经 PS 5.1 `>` 落盘，首 16 字节 `ff fe 23 00 20 00 2e 00 67 00 69 00 74 00 68 00`（`ff fe` = UTF-16LE BOM，ASCII 全变双字节），体积 6098 B ≈ 健康值 3308 B 的两倍，且重定向退出码仍为 0（表面成功）→ `check-ownership.test.sh` §7 **逐字节** drift 断言必失败（原始输出见证据集 §十二）。
> 2. 重定向**必须用 cmd 或 git-bash**，二选一：
>    - `cmd /c "python scripts\control-tower\check-ownership.py --emit-codeowners > .github\CODEOWNERS"`
>    - git-bash 下原命令直用：`python scripts/control-tower/check-ownership.py --emit-codeowners > .github/CODEOWNERS`
> 3. 落盘后核首 3 字节（健康值 `23 20 2e` = `# .`；凡出现 `ff fe`（UTF-16LE BOM）或 `ef bb bf`（UTF-8 BOM）即坏）：

```bash
head -c 3 .github/CODEOWNERS | od -An -tx1
```

基线对照（我方实测）：改表前该 diff 已零输出；沙箱 S6 实测**落表而未再生**时 diff 恰好只有 2 行新增（`tests/electron/**`、`tests/ga-collab-*.test.ts` 两行 `@tangbaobao520`），再无其他行变化——即重跑生成后必回零。

**期望⑤** 归属测试套不回归（项数 ≥58、EXIT=0）：

```bash
bash tests/control-tower/check-ownership.test.sh
```

期望输出末行：`✅ 全部通过: 58 项`，EXIT=0。我方在 origin/main 基线实跑已得 `✅ 全部通过: 58 项` EXIT=0（证据集 §八全文）。Win 侧复跑须自带 PATH：`$env:PATH='C:\Program Files\Git\usr\bin;C:\Program Files\Git\bin;'+$env:PATH; bash tests/control-tower/check-ownership.test.sh`。

**期望⑥** 除新增两条规则外，ownership.yaml 其余行逐字节不动：

```bash
git diff --numstat -- docs/synova/coordination/ownership.yaml
```

期望输出：`<N> 0 path`——**第二列（删除行数）= 0**，纯插入（仅贴 §二 6 行规则则 N=6；连同可选注释段则 N=10）。

---

## 四-补、测试补丁（58→60）（RV-1.4；由 Mac-CTO 落表时一并加入 `tests/control-tower/check-ownership.test.sh`，**本卡不改该文件**）

**可直接粘贴的断言文本**（与脚本现有 `run_expect <期望exit> "<说明>" <args...>` 语法逐字一致——定义见脚本 L44-51，用法先例 L59-67；节编号仿脚本既有 4b/5b 先例取 **8b**）：

```bash
echo ""
echo "── 8b. D1001 判别性夹具: 渲染层/桌面端测试→mac（改表即绿；边界锁死不外溢）──"
run_expect 0 "D1001 tests/electron 样例 + ga-collab-ui 判 mac" tests/electron/capability.test.ts tests/ga-collab-ui.test.ts --owner mac
run_expect 0 "D1001 边界: ga-collab.test.ts 无中段不命中仍判 win" tests/ga-collab.test.ts --owner win
```

**建议插入位置**：脚本 §8 结构契约之后（L207 `done` 行后）、§9 生产接线之前（L209 `echo ""` 前）。

**两条断言的红绿语义（全部实测，原始输出见证据集 §十三）**：

1. **断言①（改表后绿 / 改表前红）**：`tests/electron/capability.test.ts tests/ga-collab-ui.test.ts --owner mac` —— 改表前真表实测 `❌ FAIL 越域 2 处（声明 owner=mac）` EXIT=1（证据集 §十三 a1-改表前）；落表后（沙箱预演同款）`✅ PASS 2 个文件全部归属 owner=mac` EXIT=0。**判别性**：若 Mac-CTO 忘落表，此断言在 CI 即红——绿只能来自两条规则真在表里。
2. **断言②（恒绿，锁死 glob 不外溢）**：`tests/ga-collab.test.ts --owner win` —— 改表前后均绿（实测两者均 `✅ PASS 1 个文件全部归属 owner=win` EXIT=0，证据集 §十三 a2）。**护栏语义**：若日后有人把 glob 放宽成 `tests/ga-collab*.test.ts` 之类（吞掉无中段变体），该文件翻 mac → 本断言即红——glob 边界（§五）被测试锁死。

**项数说明**：+2 断言 → 期望⑤ 的 `✅ 全部通过` 由 **58 项 → 60 项**（期望⑤ 判据「≥58」不受影响；Mac-CTO 落表 + 加补丁后跑全套应见 `✅ 全部通过: 60 项`）。

---

## 五、边界值枚举（§3.4：两条原始输出 + 语义写明 + 替代写法）

**问题**：`tests/ga-collab.test.ts`（无中段）是否命中 `tests/ga-collab-*.test.ts`？`tests/ga-collab-ui.test.ts` 呢？

**改表前（现状，EXIT=0）**——三件全落 `**` 兜底判 win：

```
$ python scripts/control-tower/check-ownership.py tests/ga-collab.test.ts tests/ga-collab-ui.test.ts tests/ga-collab-logic.test.ts
win  tests/ga-collab.test.ts
win  tests/ga-collab-ui.test.ts
win  tests/ga-collab-logic.test.ts

✅ PASS 3 个文件同域: win（无归属 0，域判定豁免 0）
EXIT=0
```

**改表后（沙箱 S5 实测，EXIT=1）**——ui/logic 变 mac，`tests/ga-collab.test.ts` 仍落 `**` 兜底判 win：

```
$ python scripts/control-tower/check-ownership.py --yaml <TEMP>/d1001-ownership-sandbox.yaml tests/ga-collab.test.ts tests/ga-collab-ui.test.ts tests/ga-collab-logic.test.ts
win  tests/ga-collab.test.ts
mac  tests/ga-collab-ui.test.ts
mac  tests/ga-collab-logic.test.ts

❌ FAIL 跨域: 变更落在 2 个域 ['mac', 'win'] —— 单个 PR 只许一个域（无归属 0，域判定豁免 0）
EXIT=1
```

**语义写明（实测，与直觉可能不同）**：`tests/ga-collab-*.test.ts` **不命中** `tests/ga-collab.test.ts`。原因按 `check-ownership.py` `glob_match()`（非 `/**` 结尾走 `fnmatch.fnmatchcase`）：模式含**字面 `ga-collab-`（带连字符）**，而该文件名在 `ga-collab` 之后是 `.` 不是 `-`，字面前缀对不上。**注意**：`*` 本身**可以匹配空串**——实测 `tests/ga-collab-.test.ts`（空中段）**命中** True（fnmatch 补充实测，证据集 §七）。「不命中」的正确归因是**缺字面连字符**，不是「`*` 只匹配非空中段」。另注：`tests/ga-collab.test.ts` 当前在 origin/main **不存在**（`git ls-tree` 实测，tests/ 根下 ga-collab 族只有 logic/ui 两件，证据集 §二），本条是纯边界假设。

**替代写法（只建议，不改表）**：若 Mac-CTO 认为将来出现的 `tests/ga-collab.test.ts` 也应归 mac，可增补单列规则：

```yaml
  - glob: "tests/ga-collab.test.ts"
    owner: "mac"
    source: "D1001 边界补充（可选）：ga-collab 族无中段变体"
```

---

## 六、反向验证做法（W6；RV-1.3b 修订：天然前后对照，无需人为删规则再复原）

判别性证据 = **同一命令落表前后的红→绿差分**——命令一字不改，唯一变量是两条规则落表与否，绿只能来自这两条规则本身。

**(a) 落表前（= 改造前基线）**——本卡已实测（原始输出见证据集 §一 E1）：

```bash
python3 scripts/control-tower/check-ownership.py tests/electron/dual-guide-packaging-guard.test.ts tests/ga-collab-logic.test.ts tests/ga-collab-ui.test.ts electron-renderer/src/lib/api.ts
```

实测输出：3 行 `win` + 1 行 `mac` → `❌ FAIL 跨域: 变更落在 2 个域 ['mac', 'win'] —— 单个 PR 只许一个域`，**EXIT=1**。

**(b) Mac-CTO 落表后（同一命令逐字复跑）**：

```bash
python3 scripts/control-tower/check-ownership.py tests/electron/dual-guide-packaging-guard.test.ts tests/ga-collab-logic.test.ts tests/ga-collab-ui.test.ts electron-renderer/src/lib/api.ts
```

期望输出：4 行 `mac` → `✅ PASS 4 个文件同域: mac`，**EXIT=0**（沙箱 S4 已预演出同款输出，证据集 §十一）。

(a) 红 + (b) 绿 = 最强判别性证据（天然前后对照）。**旧表述「删规则→红→还原」作废**——无需人为删规则再复原；改坏即红的诉求由 §四-补 断言①（忘落表 CI 即红）承接。沙箱预演 S1–S6（§七）**保留为附加证据**：TEMP 副本 + `--yaml` 的改表后形态预演，佐证期望①–⑥ 的输出形态，不替代、也不弱化上述前后对照。

---

## 六-补、D935 遗留一并转建议（RV-1.5）

> 注源：「D935 遗留：dsh/** 与 docs/synova/presets/** 判 mac 的建议 + 实测证据」（队长 RV 转办，CTO 放行）。

**事实修正（实测坐标）**：origin/main **已含** `docs/synova/presets/**` 规则——E4 全文输出可直接指认（证据集 §四）：`origin/main:docs/synova/coordination/ownership.yaml:148:  - glob: "docs/synova/presets/**"`（规则组 L148-150，owner mac）。⇒ **真缺口仅 `dsh/**` 一条** + CODEOWNERS 对应生成行。**坐标勘误**：转办单所写锚点「docs/synova/presets/** 规则（origin/main L169-171）」中的行号 L169-171 经 E4 实测实为同族规则 `.dsh/**` 所在行；`docs/synova/presets/**` 实为 L148-150。本节已按实测坐标修正。

**缺口实测（worktree = origin/main 基准，EXIT=1，原始输出见证据集 §十四）**：

```
$ python scripts/control-tower/check-ownership.py dsh/presets/x.md dsh/plugins/x.md docs/synova/presets/install-squad-lead.sh --owner mac
win  dsh/presets/x.md
win  dsh/plugins/x.md
mac  docs/synova/presets/install-squad-lead.sh

❌ 越域: dsh/presets/x.md —— 声明 owner=mac，实际 owner=win
❌ 越域: dsh/plugins/x.md —— 声明 owner=mac，实际 owner=win
❌ FAIL 越域 2 处（声明 owner=mac）
EXIT=1
```

**缺口现状**：origin/main 上 `dsh/` 已有 **21 个文件**（`git ls-tree -r --name-only origin/main -- dsh/` 实测，全部在 `dsh/plugins/` 下：synova-dashboards + task-board-adapter 两插件；`dsh/presets/` 尚不存在，属前瞻覆盖）——这 21 件当前全落 `**` 兜底判 win，与 `.dsh/**`、`.claude/skills/**` 等同族 mac 路径相悖。

**建议规则原文（供 Mac-CTO 直粘，缩进两空格，与现有表样式一致）**：

```yaml
  - glob: "dsh/**"
    owner: "mac"
    source: "D935 遗留：DSH 会话资产（预设/插件 bundle），同 .dsh/** 惯例"
```

**插入位置建议**（两处语义等价，均在兜底 L35 之后；**推荐①**）：① 紧随同族规则 `.dsh/**`（origin/main L169-171）之后——source 自述「同 .dsh/** 惯例」，同族相邻最可读；② 或紧随 D935 批次 `docs/synova/presets/**`（L148-150）之后。落表后同批重跑 CODEOWNERS 再生（§四 期望④ 命令 + 编码陷阱警告），CODEOWNERS 将增 1 行 `dsh/** @tangbaobao520`。

**主树遗留登记（只读实测，不处置）**：主树（`D:\novis-backup-20260526\Novis\synova-agent`，非本卡 worktree）当前对这两个文件持有**未提交改动**——`git -C <主树> diff origin/main -- docs/synova/coordination/ownership.yaml .github/CODEOWNERS` 实测：`2 files changed, 13 insertions(+), 7 deletions(-)`（ownership.yaml 19 行变更 / CODEOWNERS +1 行），内容为一份 **dsh/** 规则草案（source 文本为「D935 §四-1 实测；同 .dsh/** 惯例（DSH 会话资产）」，与本节建议文本**不同版**）+ D935 presets 注释段重写 + yaml 末尾空行删除（全文见证据集 §十四）。**三不纪律：不动 / 不 stash / 不提交**——Win 不再持有这两个文件的改动；由 Mac-CTO 处置（采纳本节文本、其自拟或与主树草案合流，均由其单一写者身份定夺）。

---

## 七、沙箱预演说明（S1–S6，不动仓库；RV-1.3b 定位：**附加证据**——TEMP 副本预演，非替代 §六 落表前后对照）

我方在系统临时目录构造 `ownership.yaml` 副本（在 L177 后字节级拼入 §二 规则，含可选注释段，行尾跟随原文件），用 `check-ownership.py --yaml <TEMP副本>` 预演改表后全部期望：

| # | 预演内容 | 结果 |
|---|---|---|
| S1 | 13 件 tests/electron 逐条判域 | `✅ PASS 13 个文件同域: mac` EXIT=0 |
| S2 | ga-collab-logic/ui 判域 | `✅ PASS 2 个文件同域: mac` EXIT=0 |
| S3 | E5 8 文件 | `✅ PASS 8 个文件同域: mac` EXIT=0 |
| S4 | E1 4 文件 | `✅ PASS 4 个文件同域: mac` EXIT=0（由红转绿） |
| S5 | 边界三件 | `ga-collab.test.ts` 仍 win + ui/logic mac → `❌ FAIL 跨域` EXIT=1 |
| S6 | `--emit-codeowners` vs 现库 CODEOWNERS | diff 恰 2 行新增（两条新规则的生成行），DIFF_EXIT=1 → 重跑生成后归零 |

原始输出全文见证据集 §十一。**声明**：沙箱文件只落系统临时目录；仓库内 `ownership.yaml`、`.github/CODEOWNERS`、`scripts/**`、`tests/control-tower/**`、`src/**`、`electron-renderer/**` 零改动（本卡写集仅本目录两文件）。

---

## 八、未清项登记（承派单件 §八，归属不变）

| # | 项 | 归属 | 处置 |
|---|---|---|---|
| 1 | 渲染层测试**通则**（被测主体在 `electron/**`/`electron-renderer/**` 的测试归 mac）尚未成文；`tests/llm-config-frontend.test.ts` 等同类仍判 win | Mac-CTO | 本卡只建议两条 glob；建议后续成一通则 |
| 2 | `dual-guide-packaging-guard.test.ts`（D716 Win 建）连带改判 mac | 已核 | 头注自陈只读断言 Mac 域 ⇒ 纠正旧误标（本文 §三 E2） |
| 3 | `tests/control-tower/ownership.test.sh` 被引用但文件不存在 | Mac 侧 | 非本卡引入，登记备查 |
| 4 | 长期结构方向：仓根单一 `tests/` 树切断「测试跟随模块」 | 待立项 | 本卡只是补丁；长期应让归属规则与目录结构对齐 |

---

## 九、本建议件对判据 W1–W6 的自查索引

| 判据 | 落点 |
|---|---|
| W1 四项齐全 | §二（3.1 规则+位置）/ §三（3.2 E1–E5）/ §四（3.3 期望①–⑥）/ §五（3.4 边界） |
| W2 规则可直接粘 | §二 yaml 块逐字（派单件 §3.1 原文，样式对照 L172-177） |
| W3 E1–E5 带原始输出 | §三逐条实跑输出（全文另见证据集） |
| W4 六条期望各一条命令 | §四期望①–⑥，每条命令逐字给出 |
| W5 边界两条原始输出 | §五改表前 + 改表后（沙箱）两块 |
| W6 反向验证做法 | §六（RV-1.3b 修订：天然前后对照；沙箱 S1–S6 为附加证据，§七已标注） |
| RV-1.3a 编码陷阱 | §四 期望④ 再生命令警告块（PS 5.1 `>` = UTF-16LE+BOM 实测佐证，证据集 §十二） |
| RV-1.4 测试补丁 | §四-补（run_expect 8b 节，58→60；Mac-CTO 落表时一并加入，本卡不改该文件） |
| RV-1.5 D935 遗留 | §六-补（presets 已在 main 的坐标修正 + dsh/** 规则直粘 + 主树遗留三不登记，证据集 §十四） |

> 执行方不判通过：本文结论止于「已交付建议 + 实测证据」；通过与否归 Mac-CTO 落表自验与 K3 终审。
