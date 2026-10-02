# D1003 派单件 — 文档/产物治理：Windows 工具陷阱固化 + A 类一次性产物清理登记

> 出件：Win-Codex-CTO ｜ 2026-09-26 ｜ 号段：Win 段 `D1000–D1099`（本卡 = D1003）
> 来源：① CTO 2026-09-25 裁定「`docs/tools.md` 立项 = D1003」（K3 与小队均踩过同类坑 3 次）
> 　　　② CTO 2026-09-26 对 `chore/remove-a-class-artifacts-20260923` 的逐条核实（18/18 仍在 main）
> 域：`win` ｜ `owner_side`：`win`（写集全 win，无需跨域特批）

---

## 一、本卡只做两件事（都**不删任何文件**）

| 产物 | 内容 |
|---|---|
| **A** `docs/tools.md` | 固化 3 条已反复踩到的 Windows 工具陷阱 |
| **B** `docs/synova/product-lines/evidence/D1003-20260926/A类清理清单.md` | 把 A 类 18 件一次性产物逐条登记 + **跨域拆分方案**，交后续执行卡照抄 |

**本卡明确不删文件**——那 18 件跨 win/mac 两域，且当前合并通道被 mac 侧系统性问题堵死，删了也进不去 main。**本卡只把清单做扎实**，实际删除另立执行卡按拆分方案走。

---

## 二、A 件：`docs/tools.md` 必须含的 3 条（逐条「症状 + 复现命令 + 正确做法」）

| # | 症状 | 正确做法 |
|---|---|---|
| 1 | **`findstr` 在 cmd 下被工具层转义引号**，`findstr /b /c:"GITHUB_TOKEN"` 报"找不到"→ **假阴性**（实测：凭据行明明存在，检查却报 ABSENT） | 涉及引号的检索一律写 `.cjs` 交 `node` 跑；或改用 `git grep` / `git status` |
| 2 | **中文路径过 cmd 代码页 → `if exist` / `dir` 报"文件不存在"假阴性**（实测：`D:\Synova-独立审计\...`、派单件中文名各中一次）；`dir /s /b` 输出中文亦乱码 | 中文路径的存在性判断用 `git status -s` / `node fs.existsSync`；不要用 cmd 内建判断 |
| 3 | **`bash` 在 PowerShell PATH 中解析到未安装的 WSL 存根**（`E_ACCESSDENIED`）；Git 自带 bash 可用但**必须自带 PATH**，否则 `grep/tr/rm: command not found` → 49 项环境性假失败 | `$env:PATH='C:\Program Files\Git\usr\bin;C:\Program Files\Git\bin;'+$env:PATH; bash <script>`，或直接 `C:\Program Files\Git\bin\bash.exe --noprofile --norc` |

**附加一条（第 4 条，可并入）**：本机 PowerShell **内置模块加载失败**（`Microsoft.PowerShell.Management` 与 Core 不兼容 → `Get-Content`/`Get-ChildItem` 全报错）⇒ 读文件改用 `cmd /c type`、`node fs`、或 `more +N`。

---

## 三、B 件：A 类清单必须含的 5 项

1. **18 件逐条路径 + 状态**（D=删除），按四类归组：Python 缓存 4 / **旧仓库嵌套副本 8** / 一次性看板快照 3 / `.bak`与备份 3
2. **实测口径与命令**：`git cat-file -e origin/main:"<path>"` 逐条核 → **18/18 仍在 main**（CTO 2026-09-26 实测）
3. **跨域拆分方案**（硬要求）：`mac` 2 件（`docs/synova/research/archive/**` 两个 `.html.bak`）交 Mac-CTO；`win` 16 件归后续执行卡
4. **不直接推原分支的理由**（三条）：混入 D725 内容（已进 main）／22 文件超 ≤12 预算／跨域
5. **本地留存说明**：工作树 `.claude/worktrees/a-class-cleanup @ 36b7342d` **未推**，是这 18 件删除的**唯一本地副本** ⇒ **在拆分执行完成前不得删除该工作树与分支**

---

## 四、完成标准（可执行判据）

| # | 判据 | 反例 |
|---|---|---|
| T1 | `docs/tools.md` 含 3（+1）条，每条三要素齐全（症状/复现命令/正确做法） | 只写"注意引号"无复现命令 → 红 |
| T2 | 清单含 18 件逐条路径，且**按类归组计数之和 = 18** | 数目对不上 → 红 |
| T3 | 清单含第 2 项的实测命令与结论（18/18 仍在 main），并注明**截至时刻** | 只写"仍在"无命令 → 红 |
| T4 | 清单含跨域拆分：**win 16 / mac 2 逐条列出**，mac 2 件标注"交 Mac-CTO" | 不分域 → 红 |
| T5 | **零 `src/**` 改动**；**零文件删除**（`git diff --name-status` 无 `D`） | 出现 D 状态 → 红 |
| T6 | `docs/tools.md` 可被**新会话**直接照做（命令可复制执行） | 命令里有占位符/缺路径 → 红 |

**边界值枚举**：清单里必须给出**任一件消失时应如何判断**（例如某件被他人删了 → `git cat-file` 报 not exist ⇒ 标记"已由他人清理，从清单剔除"），避免执行卡把已清项当未清项。

---

## 五、执行形态（硬字段）

- Agent Teams 组队；队长**不下场写码**；1 独立自验 + 1 独立复核（自验不得由编码兼任）
- 单域 win 单 PR；≤12 文件（本卡 3 件）；重型验证串行 ≤1
- 工作目录钉死本卡 worktree；禁 `rm -rf`；临时产物只落 `/tmp`
- 回执含**团队成员运行记录**（成员名 · 运行状态 · token · 共享任务 id 与状态）

## 六、回执格式

1. T1–T6 逐条自验结论 + 证据索引
2. 团队成员运行记录
3. `git diff --stat` + `ls-remote`（基准写 `origin/main` 合后确切 SHA，**禁用本地 main**）
4. 未清项（诚实登记）
5. 派单件指纹对账（三条坐标 × 三方值）

## 七、红线

- 禁 `--no-verify` / `git stash` / force push；不碰 `scripts/audit/**`
- **不删任何文件**；不碰 `scripts/**`、`.github/workflows/**`、hooks（mac 域）
- 不推 `chore/remove-a-class-artifacts-20260923` 原分支
- 执行方**不判通过**；终审归 K3

## 八、未清项预登记

| # | 项 | 归属 | 处置 |
|---|---|---|---|
| 1 | A 类 18 件**实际删除** | win 16 / mac 2 | 拆分执行卡，**等合并通道恢复**（现被 mac 侧 `union` + 必需检查堵死） |
| 2 | `chore/remove-a-class-artifacts-20260923` 原分支与工作树 | win | 拆分执行完成前**不得删**（唯一本地副本） |
| 3 | 嵌套旧仓库副本（`novis-backup-20260526/Novis/synova-agent/**` 8 件）来源 | 待查 | 谁在什么情况下提交进来的 → 建议一并查根因，防复发 |
| 4 | K3 报告未闭合项 **R-1..R-6**（含 R-6 越权分支旧卡号判据需澄清） | CTO | 等 D1001 落 main 后一并处理 |
