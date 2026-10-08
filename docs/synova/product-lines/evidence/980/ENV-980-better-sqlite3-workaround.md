# #980 工作树环境记录（落仓 · M5/C-6 补缺）

> 由来：独立自验 α（`verifier-980-env`）审计发现本卡的 `better-sqlite3` 环境变通在**仓库治理产物中零记录**（C-6），且 `/tmp/install-deps-rebuild.log` 被后续包的 postinstall 覆盖 ⇒ **gyp 失败原文不可复得**。本件按 M5 补落仓记录。
> 版本坐标：工作树 `D:\novis-backup-20260526\Novis\.synova-wt-980`；记录时刻 HEAD = `c231d80e8`。

## 1. 事实（可核，逐条附命令）

| # | 事实 | 命令 / 证据 |
|---|---|---|
| E1 | `bash scripts/control-tower/install-deps.sh` 报失败包 = `better-sqlite3` | `%TEMP%\install-deps-failed.txt` 内容 `FAILED_PKG=better-sqlite3`；脚本输出行 `INSTALL-DEPS: VIOLATION(1)  [better-sqlite3 ]`（**双空格**，`install-deps.sh:147` 格式） |
| E2 | 失败在**阶段②（显式重建）**，不是 `npm ci` | `install-deps-npmci.log` = `① npm ci --ignore-scripts` … `added 813 packages in 20s` 成功 |
| E3 | **gyp 失败原文不可复得** | `install-deps.sh:123` 用 `>` 覆盖同一个 `/tmp/install-deps-rebuild.log`；现存内容已是 **electron 的 postinstall** |
| E4 | 工作树 `build/Release/better_sqlite3.node` 实际加载 = 主树 11.10.0 的产物，**非本树源码产物** | 决定性判别（自验α）：本树 `deps/sqlite3/sqlite3.h` = `#define SQLITE_VERSION "3.53.2"`，而实际 dlopen 报 `sqlite_version() = 3.49.2`（= 主树同值）；`node_modules/` 被 `.gitignore:1` 忽略 |
| E5 | 该 `.node` 字节大小 / sha256 / mtime | `1,908,224 B`；`bccd88b5074c5bf2c23706e343f1e8f449d260e9124c86c9d4fad3b87e3d3e39`；mtime `2026-07-28 22:05:41` |
| E6 | wrapper 版本 × native 版本 = **跨版本组合** | 工作树 `better-sqlite3/package.json` = `12.11.1`；`.node` 来自 `11.10.0`（主树同名文件字节完全相同） |
| E7 | 复制源**无法唯一确定**（自验α限定） | 同哈希者还有 `synova-wt-d358`（同 sha256）⇒ 仅凭哈希不能区分；本件只声明"来自主树 `synova-agent` 的同名文件"（操作者记录），不宣称唯一 |
| E8 | ABI 与加载路径 | `node v24.16.0` / `process.versions.modules = 137`；自验α用 `process.dlopen` 打点直证加载的就是 E5 那个文件 |
| E9 | 能力面实测（自验α独立复算，非转述） | 建表 / `INSERT graph_nodes` / `SELECT … WHERE id=? AND graph=? AND valid_to IS NULL` / `json_extract` / 事务 1000 行 28ms + 回滚 / 软删除 / WAL / `ALTER TABLE` 旧库迁移 / raw/pluck/iterate/columns/expand/safeIntegers/function/aggregate/serialize/backup 全 OK |
| E10 | 唯一 ERR 属两版共有行为 | `db.table('t')` 抛 TypeError，在主树 11.10.0 自洽对下**完全相同**，且 `src/` 零使用 ⇒ 非跨版本缺陷 |

## 2. 风险（**能证实 / 无法证实**分开写）

**能证实**：
- 两版 `lib/` 仅 `database.js` 一处差异（`file:` URL 前缀判断）；`lib/util.js` 字节相同；原生 addon 的 JS 可见表面（addon / `Database.prototype` / 实例属性）两树**逐字相同**。
- 仓库有**同类前科**（黑字在档）：`2026-08-28-D483-D484-D486.md:96-102`「node_modules 陈旧 11.10.0，主仓已 12.11.1」；`2026-08-22-P1-gs-deploy-u.md:37`「better-sqlite3 v12（**Node 24 崩溃根因，WiseLibs#1376**）」；`2026-09-08-K3-seven-task-batch-closeout.md:18`「**11.10.0**：Node 24 下 fork worker 退出 `Assertion failed: (env) != nullptr` 崩溃」。

**无法证实 / 不可外推**：
- 携带 SQLite **3.49.2 ≠ 源码预期 3.53.2**（语义差异面未量化）。
- 自验α按前科形态做了**判别性复现**（worker_threads ×3 + child_process.fork ×3 + 3000×prepare + 2000 行事务 + 强制 GC）⇒ **6/6 未复现、exit 0**；但历史崩溃发生在 **macOS/arm64**，**win32 x64 不复现不能外推为安全**。
- 只覆盖**主进程短时**行为面；长时/并发/多进程未覆盖。

## 3. 回退方式（一条命令）

```bash
# 删除借用二进制 ⇒ 恢复为"未构建"状态（测试/探针将报 bindings 缺失，属 fail-closed 可见）
rm -f node_modules/better-sqlite3/build/Release/better_sqlite3.node
# 或走正确路径重建（需本机具备可用的 node-gyp 工具链；本卡环境下 gyp 失败，故未采用）
npm rebuild better-sqlite3
```

## 4. 影响面与结论

- **影响**：仅本工作树的**本地开发/验证环境**；`node_modules/` 被 git 忽略 ⇒ **不影响 main、不影响 CI、不影响他人工作树**。
- **对判据的影响**：本卡真库路径（`tests/l4/sog-schema-validator.integration.test.ts` + `probe-diagnosis.ts`）依赖该模块可加载；CI 上由 `install-deps.sh` 正常路径构建，与本机变通无关。
- **登记缺口定性**：这是**环境变通**，不是产品改动；本件把"变通了什么、凭什么、影响面、怎么退"落仓，避免下一个人从零猜。
- **自验α的独立判定**：加载与功能面**可信**；版本身份**决定性判别**成立；风险**落在已登记前科坐标内、但不可外推安全**。

## 5. 原始输出留痕（仓库外 → 需 M6 收口）

自验α的原始脚本/临时库留在 `%TEMP%\verify-980-env-*`（14 个文件）；探针原始 run 输出留在 `/tmp/synova-980-probe-out/20261008-020519/`（`probe-output.txt` / `probe-output.json` / status 前后 / hashes 前后）。

> ⚠️ 上述两处**均在仓库外**（不进 git）。按 M6「收尾三件必须提交进仓库」，关键判定已在本件与 `evidence-980-probe-run.txt` 内落仓；完整原始 run 由队长另件落盘（见 `evidence/980/`）。
