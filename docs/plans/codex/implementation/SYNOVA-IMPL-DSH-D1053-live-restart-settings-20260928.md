# D1053 · 线25 live/restart 设置分类 —— PLAN（六项产出，等 CTO 复核放行后写码）

> 任务号 **D1053**（`alloc-task-id.sh "线25 live-restart 设置分类" --prefix squad-` 现场取号）
> worktree `.synova-wt-squad-d1053` ｜ 分支 `feat/d1053-live-restart-settings` ｜ base `origin/main` @ `20b55eba`
> 记分对象：**25-8 / 25-9**（product-lines.yaml:1166-1175）｜ 判据来源：K3 批次1 报告 FIX-C（commit `643069b9`）
> 前置证据：`00-premise-freeze.json`（P1-P25 逐条实测）｜ `10-conflict-scan.txt`（M2 冲突扫描）
> 状态：**PLAN —— 未写一行产品代码。** 依 `CTO-固化-最终方向与在制任务-20260924.md` §二① 与派单件 §三①：产出后停下等 CTO 复核放行。

---

## 〇、开工前置（已完成，可核）

| 项 | 命令 | 结果 |
|---|---|---|
| 现场取号 | `bash scripts/control-tower/alloc-task-id.sh "线25 live-restart 设置分类" --prefix squad-` | `D1053` + `task-state/D1053.json` + brief 骨架 |
| 主工作区同步 | `git fetch --all && git pull --ff-only` | 开工时 `[behind 7]` → 已清零到 `20b55eba` |
| 专用工作树 | `git worktree add .synova-wt-squad-d1053 -b feat/d1053-live-restart-settings origin/main` | 就绪（不复用他人工作树） |
| 认领绑定 | `.claude/current-brief` → `2026-09-28-D1053-线25-live-restart-设置分类.md` | 本地 marker（`.gitignore:30` 已忽略） |

---

## 一、🔴 前提冻结结论（先看这个：**9 条派单件前提不成立/偏差**）

**完整实测见 `00-premise-freeze.json`（P1-P25，每条含可复跑命令 + 原始输出 + 结论）。** 摘要：

### A 类｜锚点/路径过时（须按实测更正后施工）

| # | 派单件原文 | 实测 | 处置 |
|---|---|---|---|
| P5 | 客户配置包 `mountPreset`/`leakedServices` 机制，接线在 `src/config.ts:34` | `mountPreset` 全仓 **0 命中**；`src/config.ts:34` 是 sentinel 阈值字段；真实符号是 `discoverCustomerConfigPackages`/`resolveCustomerConfig`（`src/config/customer-config-package.ts`），泄漏审计函数名 `leakedGlobalConfig` | 能力面**存在**（25-6 已 pass）⇒ 不废卡；施工按真实锚点 |
| P6 | 接线在 `src/agent/../diagnosis.ts:226` | `src/diagnosis.ts` **不存在**；真实是 `src/routes/diagnosis.ts:226`（路径错、行号对） | 按实测路径 |
| P7 | 必读 #1 = `docs/synova/audit-reports/2026-09-28-K3-产品线审计-批次1-线25线1.md` | 该路径**不在 main**（`git log main -- <path>` 空）；仅存于 `origin/audit/k3-20260928-batch1-line25-line1` | 以 commit `643069b9` 回源引用（原文已核读 316 行） |
| P10 | `dsh-settings-file` 的 `resolveSpec` / 分层 resolve 可借 | 该包在锁定快照 **不存在**；`patchNode` 全仓 **0 命中**；`resolveSpec` 仅存在于 `credentials-local`（不同语义） | B-10 可借面收敛到**本仓已落 main 的 D599 落点** |

### B 类｜DSH 版本锚点断裂（M6 类，K3 P1-2 独立复现）

| # | 派单件原文 | 实测（DSH 0.1.7-rc.1 @ `46a7f68b`） |
|---|---|---|
| P8 | yaml note：`SettingsApplies` = live\|restart（`lib/types/index.d.ts:21`），注册缺省即 live（`lib/index.js:288`） | `SettingsApplies` 全仓 **0 命中**；`packages/settings/settings/lib/index.js:446` **硬编码 `applies: "live"`**；`lib/types/types.d.ts:32` 字面量 `applies: 'live'` |
| P9 | 派单件 §二②：`applies: options?.applies ?? "live"` | `?? "live"` 全仓 **0 命中**（该句是 v0.1.6 旧版形态） |

> **⇒ 本卡不能写成「接入 DSH 的 live\|restart 分类」**（该能力在锁定快照不存在，且红线明文禁引 `@deepseek-ai/*`）。
> 只成立的口径：**借范式自研**（第六章「复制范式而非代码」:21）+ **以 DSH 恒 `live` 的默认作反例边界**（正是 25-9 要防的半生效盲区）+ M3 锚点注释用**现验** `path:line`（不写死行号）。

### C 类｜口径混用（教训库 L-020：数字必须带口径）

| # | 派单件原文 | 实测 |
|---|---|---|
| P15 | 「线25 现 5/10 → 完成后 8/10；全项目 verified 11 → 14」 | K3 verdict 口径：线25 pass 5 / fail 3。**product-progress.json 权威口径**：线25 verified **0/9**、全项目 verified **0**、`pending_k3` **51**（机器绿但未审不计分）；main 的线25 只有 **9 点**（25-10 未落 main）⇒ 分母不是 10 |

### D 类｜协同面误判（须收缩写集）

| # | 派单件原文 | 实测 |
|---|---|---|
| P17 | main 的 GS-08 记分通道不可用⇒自备 fixture | 成立（GS-08 仍是 D446 契约级诚实 RED）。**但不阻塞**：25-8/25-9 权威证据通道是 `test:`（非 `scenario:GS-08`） |
| P20 | 线3 切片（#877 在飞）「不构成冲突（不同模块面）」 | **部分不成立**：D1051 写集含 `src/routes/diagnosis.ts`、`src/routes/conversations.ts` —— 恰是 live 通道的现存 L1 消费者 ⇒ 本卡**不碰这两文件** |

**废卡触发：否。** 6 条锚点过时 + 1 条口径混用 + 2 条协同误判，均未击穿可行性（判据原文已核读、底层能力面存在）。

---

## 二、逐文件写集（含写者，两两互斥）

### 2.1 写集（本次 PLAN 提交：0 修改 + 6 新建）

| 文件 | 操作 | 说明 |
|---|---|---|
| docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D1053-live-restart-settings-20260928.md | 新建 | 本 PLAN（六项产出）；落 dev-doc 豁免区以免撞 D782 登记门禁 |
| .claude/task-briefs/2026-09-28-D1053-线25-live-restart-设置分类.md | 新建 | 认领 brief 六字段 + `## 写集`（含实现阶段全部文件） |
| task-state/D1053.json | 新建 | alloc-task-id.sh 现场取号登记（status=claimed） |
| docs/synova/product-lines/evidence/D1053/00-premise-freeze.json | 新建 | 前提冻结实测 P1-P25（命令 + 原始输出 + 结论） |
| docs/synova/product-lines/evidence/D1053/10-conflict-scan.txt | 新建 | M2 写集冲突扫描（引用面完整输出 + 在途分支清单） |
| memory/notes/proposed/2026-09-28-D1053-live-restart-settings.md | 新建 | 铁律 49 四态 Note（决策 + 理由 + 待裁项） |

> 口径：上表 = **本次提交实际落盘的文件**（`check-dev-doc-write-set.sh` 逐条核「存在 + ∈ 本次 diff」）。
> **实现阶段的写集**（§2.2 的 `src/**` + `tests/**`）在实现提交时按 D600 先例**同 commit 回填上表**——
> `src/config/**`、`tests/**` 不在 reverse-check 的 SKIP 前缀（`.claude/ docs/ memory/ task-state/ .codex/ .github/ scripts/workflow/`）内，
> **不回填 = CI 写集漂移硬红**。

### 2.2 实现阶段文件清单（预估，CTO 放行后由成员 S 的活规格定稿）

**域：win（`check-ownership.py` 实测 PASS，7 文件同域）｜ PR 预算：7 个产品文件 + 治理产物（D860 口径不计入 12）**

| # | 文件 | 动作 | 写者 | 说明 |
|---|---|---|---|---|
| 1 | `src/config/settings-applies.ts` | 新建 | C1 | 分类内核：`SettingsApplies = 'live'\|'restart'`；命名空间注册制；**未声明⇒强制 restart + 清单**；live 现读 / restart boot 冻结；逐键 dump（复用 D599） |
| 2 | `src/config/settings-source.ts` | 新建 | C1 | 两层文件源（workspace/home）读取 + schema 校验（借 B-10 范式；复用 `config-layers.mergeLayers/resolveLayers`，**不重写叠加**） |
| 3 | `src/routes/settings.ts` | 新建 | C1 | **真实入口** `GET /api/settings/effective`：每请求读同一 accessor，返回 `{ns,key,applies,declared,effective,pending,sourceLayer}` |
| 4 | `src/routes/config.ts` | 修改（+≤15 行） | C1 | **第二消费者**：`/api/config/dump` 增列 applies/effective/pending/declared —— 用于「两消费者同一新值」的物理证明 |
| 5 | `src/server.ts` | 修改（+2 行） | C1 | 1 import + 1 `app.use(settingsRoutes)`；热点文件（15 个未合并分支触及）⇒ **只允许这 2 行** |
| 6 | `tests/config/settings-applies-live.test.ts` | 新建 | C1 | 路径 A 套件（文件名**字面**含 yaml evidence 串） |
| 7 | `tests/config/settings-applies-restart.test.ts` | 新建 | C1 | 路径 B 套件（同上） |
| 8 | `tests/routes/settings-applies-e2e.test.ts` | 新建 | C1 | 路径 A+B+C 的 HTTP 端到端（真实路由，不 mock 管线，铁律 12） |
| 9 | `docs/synova/product-lines/evidence/D1053/**` | 新建 | 队长/V | 四件套证据（域中性，D860 治理产物） |
| 10 | `.claude/task-briefs/2026-09-28-D1053-*.md`｜`task-state/D1053.json`｜`memory/notes/proposed/2026-09-28-D1053-*.md`｜`.claude/bypass.log` | 新建/修改 | 队长/hook | 认领链 + 四态 Note + 绕过账本（治理产物，D860 不计入预算） |

**只读复用（不修改）**：`src/config/config-layers.ts`、`src/config/customer-config-package.ts`、`src/config.ts`、`docs/synova/product-lines/product-lines.yaml`（创始人领地，线集结构不动）。
**明令不碰**：`scripts/audit/**`、`docs/synova/audit-reports/**`（K3 域）；`src/routes/diagnosis.ts`、`src/routes/conversations.ts`（D1051 在飞写集）；`src/sentinel/baseline-store.ts`（3 个未合并分支）；`scripts/pre-commit-check.sh` 等门禁脚本；`ci.yml`。

**计数核对**：产品文件 8（1-8）+ 治理 1 目录 + 4 流程件 = 12 条目；按 D860 口径计入预算的 = **8 ≤ 12** ✅

---

## 三、依赖图

```
                 ┌──────────────────────────────────────────┐
                 │ 已完成且在 main 的可复用面（只读）        │
                 │ · D599 src/config/config-layers.ts        │  四层叠加 + 逐层 provenance（B-10 落点）
                 │ · D599 customer-config-package.ts         │  resolveCustomerConfig + 泄漏审计
                 │ · D600 src/routes/config.ts /api/config/dump │ 第二消费者落点
                 │ · 25-6 运行时插件化（K3 批次1 pass）       │  『加文件即生效』语义先例
                 └───────────────────┬──────────────────────┘
                                     │ 复用（不重写）
                     ┌───────────────▼────────────────┐
                     │ D1053 #1 settings-applies.ts    │  ←── 本卡核心（新机制）
                     │ D1053 #2 settings-source.ts     │
                     └───┬───────────────┬────────────┘
                         │ 接线           │ 接线
              ┌──────────▼──────┐  ┌─────▼──────────────┐
              │ #3 routes/settings.ts │  │ #4 routes/config.ts │   ← 两个独立消费者（同一新值）
              └──────────┬──────┘  └─────┬──────────────┘
                         │   #5 server.ts 2 行挂载
              ┌──────────▼───────────────────────────────┐
              │ #6/#7/#8 三套件（live / restart / e2e）    │
              │ #9 evidence/D1053 四件套                   │
              └───────────────────────────────────────────┘

硬依赖：无（K3 批次1 报告为判据来源，非代码前置）
同批约束：25-8 与 25-9 共用同一 applies 机制 ⇒ **必须同 PR 同批声明**（yaml note 明写）
反向依赖：**25-7（k3_only 审计员复核）的翻转点 = 本卡**；本卡完成 ⇒ 25-7 可复审翻绿 ⇒ 一格工作换三格
无依赖并行：线3 D1051（不同分支/无写集交集，见 §二 明令不碰清单）
```

---

## 四、三路径 + 变异体夹具设计

### 三路径（每条都有**运行期**判据，不用 grep 型静态判据）

| 路径 | 场景 | 判据（可执行） | 对应验收点 |
|---|---|---|---|
| **A · live 生效** | 改 `settings.yaml` 的 live 类键（阈值类 `diagnosis.gate*` / 文案类） | 同进程、**不重启**：下一次 `GET /api/settings/effective` 与 `GET /api/config/dump` 都返回新值 **且两值相等**（无部分消费者滞留旧值） | 25-8 |
| **B · restart 隔离** | 改 restart 类键（连接类 `llm.baseUrl` / 数据源类 `store.path` / 鉴权类） | 同进程两消费者 `effective` **仍是旧值**、`pending` = 新值、`applies=restart`；进程行为不变（`healthz` 200 / 端口不变）⇒ **绝不半生效**；重启进程后 `effective` = 新值 | 25-9 |
| **C · 默认安全（未声明）** | 源里放一个**未声明**的键 | 该键 `applies` 被强制为 `restart`（**绝不按 live**）、`declared:false`；启动日志出现未声明项清单（`log.warn` 一次，可见） | 25-8 note + 完成标准「启动日志列出未声明分类项」 |

### 变异体夹具（V 独立注入；「删掉即报红」判别性）

| 变异 | 注入手法 | 期望 | 复原 |
|---|---|---|---|
| **M1** restart 项当 live 处理 | 改 #1 的分类判定分支，使 restart 键走现读 | 路径 B 套件**必红**（`effective` 变新值 = 半生效） | 复原后 `git diff` 空 + 文件 sha256 与注入前一致 |
| **M2** 删分类声明 | 把某键从 registry 声明中移除（模拟"忘声明"） | 路径 C 套件**必红**（缺失=默认安全断言失败）⇒ 证明判据**真的在跑**，非装饰 | 同上 |
| **M3** 消费者绕过 accessor 自缓存 | 在 #4（或 #3）注入一个模块级缓存分支 | 路径 A 套件**必红**（两消费者值不等） | 同上 |
| **M4** 负控：非法配置 | `settings.yaml` 写 `applies: "sometimes"`（非法值）／坏 JSON | **fail-closed 必红**（抛 `SettingsSpecError` + `degraded`，铁律 24/32），不得静默降级为默认 | 删除负控夹具文件 |

**红证不残留**：全部注入用带标记的临时代码分支（标记串如 `INJECTED-RED-D1053`），收尾 `grep -rc 'INJECTED-RED-D1053' src/ tests/` = **0**（硬判据，写进 M6 收尾三件）。

---

## 五、失效条件（每条 = 已知会假绿/假红的机制 + 本卡对策）

| # | 失效模式（有前科） | 本卡对策（写进验收命令/夹具） |
|---|---|---|
| F1 | **A2 机器证据管线假绿**：套件定位失败静默跳过却统一写 pass（`run-machine-evidence.sh:76-80`，K3 P0-1；25-8/25-9 现就在 35 个 test 绑定点内） | ① 测试文件名**字面**含 `settings-applies-live` / `settings-applies-restart`（A2 两步定位都能命中）；② 证据必须附「**实际执行了哪个套件、跑了几个用例**」的原始输出（`--reporter=verbose`）；③ 静默跳过 = 无效证据 |
| F2 | **grep 型静态判据当验收**（实测 3/5=60% 命中率） | 每条判据都必须有运行期夹具（三路径 + M1-M4），不接受"grep 到符号"作为验收 |
| F3 | **「接线了」≠「被执行」** | M2/M3 判别性夹具：删声明 / 绕 accessor ⇒ 必须报红；不红 = 未接线 |
| F4 | **证据新鲜度**：证据日期后该线 modules（`src/config/`）再有提交 ⇒ 判 `stale`（`calc-progress.py:47`） | 证据在**代码冻结后**跑；3 天内送审；不在证据产出后再改 `src/config/**` |
| F5 | **L1→L3 跨层基线**（线3 切片曾被退回） | 新模块落 `src/config/**`（实测不在 `PAT_L3/L4/L5`）✅；测试/路由不 import `l3/ sentinel/ expert/` |
| F6 | **跨卡写集重叠** | 不碰 `src/routes/diagnosis.ts` / `src/routes/conversations.ts`（D1051 在飞）与 `src/sentinel/baseline-store.ts`（3 未合并分支） |
| F7 | **热点文件**（`src/server.ts` 15 个未合并分支触及） | 只加 2 行；合并前 `git fetch` 复扫 |
| F8 | **红证残留** | 标记串 + 收尾 grep=0 |
| F9 | **Windows 门禁 fail-open** | 本卡不含 win 专属脚本改动；若 CI 该腿 degraded，必须在回执**显式标 degraded**（禁 fail-open 静默绿） |
| F10 | **同类第二次 = 升级** | 若出现 K3 已登记过的 M1/M6/M7 同类第二次，立即升级 CTO，不自行加机制 |
| F11 | **不引 `@deepseek-ai/*` 依赖** | 处置表 `dsh-settings`=接缝-预留 ⇒ 引包 = 越界（红线）；M1 锚点用注释 + 现验命令，不落 import |

---

## 六、可复制验收命令（V 独立重跑；①-⑤ 全绿才算四件套齐）

```bash
# 变量
WT=/Users/wane/SynovaAgent/.synova-wt-squad-d1053
cd "$WT"

# ① 两套件（独立重跑）+ e2e —— 必须打印套件名与用例数（防 A2 静默跳过）
npx vitest run tests/config/settings-applies-live.test.ts \
               tests/config/settings-applies-restart.test.ts \
               tests/routes/settings-applies-e2e.test.ts --reporter=verbose

# ② 真实入口：真配置面读改 → 真 HTTP 读值（两个消费者同值）
mkdir -p .tmp-d1053 && cat > .tmp-d1053/settings.yaml <<'YAML'
settings:
  diagnosis:
    gateDataCompleteness: { value: 0.30, applies: live }
  llm:
    baseUrl: { value: "http://old.invalid", applies: restart }
YAML
SYNOVA_SETTINGS_FILE="$WT/.tmp-d1053/settings.yaml" npx tsx src/index.ts & SRV=$!
sleep 3
curl -s "http://localhost:${PORT:-18790}/api/settings/effective" | python3 -m json.tool
curl -s "http://localhost:${PORT:-18790}/api/config/dump?orgId=default" | python3 -m json.tool

# ③ 路径 A：改 live 键 → 不重启，下一次读取即新值，两消费者相等
sed -i.bak 's/0.30/0.55/' .tmp-d1053/settings.yaml
curl -s "http://localhost:${PORT:-18790}/api/settings/effective" | grep -c '0.55'   # 期望 ≥1
curl -s "http://localhost:${PORT:-18790}/api/config/dump?orgId=default" | grep -c '0.55'  # 期望 ≥1

# ④ 路径 B：改 restart 键 → 重启前完全无感（旧值持续），重启后生效
sed -i.bak 's#http://old.invalid#http://new.invalid#' .tmp-d1053/settings.yaml
curl -s "http://localhost:${PORT:-18790}/api/settings/effective" | grep -c 'old.invalid'  # 期望 ≥1（旧值仍生效）
curl -s "http://localhost:${PORT:-18790}/api/settings/effective" | grep -c '"pending"'    # 期望 ≥1（暂存可见）
kill $SRV; sleep 1
SYNOVA_SETTINGS_FILE="$WT/.tmp-d1053/settings.yaml" npx tsx src/index.ts & SRV=$!
sleep 3
curl -s "http://localhost:${PORT:-18790}/api/settings/effective" | grep -c 'new.invalid'  # 期望 ≥1（重启后生效）

# ⑤ 路径 C：未声明键 ⇒ 默认安全 + 启动清单
printf 'settings:\n  rogue:\n    whoAmI: 1\n' >> .tmp-d1053/settings.yaml
kill $SRV; sleep 1
SYNOVA_SETTINGS_FILE="$WT/.tmp-d1053/settings.yaml" npx tsx src/index.ts 2>&1 | grep -c '未声明'  # 期望 ≥1
kill %1 2>/dev/null || true

# ⑥ 负控（错误配置必红）
printf 'settings:\n  bad:\n    x: { value: 1, applies: sometimes }\n' > .tmp-d1053/bad.yaml
SYNOVA_SETTINGS_FILE="$WT/.tmp-d1053/bad.yaml" npx tsx -e "import('./src/config/settings-applies.ts').then(m=>m.loadSettings())" ; echo "期望非 0 exit"

# ⑦ 红证不残留 + 工作区干净
grep -rc 'INJECTED-RED-D1053' src/ tests/ | grep -v ':0' || echo "红证 0 命中 ✓"
git status --porcelain   # 期望仅本卡声明写集
```

**四件套对应**：①=verify 命令（两套件 + 负控）｜②=真实入口（真配置面读改 + 真 HTTP 读值）｜③=改坏即红（M1-M4 + 复原 sha 一致）｜`evidence/D1053/*.json`=.json 证据（含「实际执行了哪个套件、跑了几个用例」原始输出）。

---

## 七、团队编制（4 人，硬要求）与执行编排

| 角色 | 成员 | 定位 | 共享任务（放行后建） | 写集 |
|---|---|---|---|---|
| 队长 | `synova-squad-lead`（本 session） | 统筹 + 收口，**不下场写码** | 协调；出「自验结论」 | 仅治理产物（brief/task-state/Note/evidence 汇总） |
| 成员 S | （放行后 spawn，`context=fresh`） | **规格，独立于实现** | 出活规格（三路径夹具细化 + 契约 JSDoc + 失效条件清单） | `docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D1053-*.md` |
| 成员 C | （放行后 spawn） | 编码（≤2 人；本卡按 1 人编排） | 实现 #1-#8 | `src/config/settings-applies.ts`、`settings-source.ts`、`src/routes/settings.ts`、`src/routes/config.ts`、`src/server.ts`、3 个测试文件 |
| 成员 V | （放行后 spawn，**不得由编码兼任**） | **独立自验**，只读（可写 `/tmp`） | 独立重跑 ①-⑦ + M1-M4 注入 + 出证据 JSON | `evidence/D1053/**`（仅证据，不碰 src/tests） |

- **M3 事故判据**：自验由编码兼任 = 退回。V 只读产品代码，注入在临时分支/临时文件上做，出证据后复原。
- **重型验证串行**：vitest 同一时间 ≤1 个在跑（8GB 机器，已两次压满）。
- **WIP=1**：本卡未过 CTO 收件闸，不放行下一张代码卡。
- **组队时点**：CTO 放行后。理由：① 规格若基于未裁决前提（P8-P10 三条 DSH 锚点断裂）会整篇返工；② 放行前无写码任务，提前 spawn 违反 WIP=1 且制造空转。
- **回执**：必含「团队成员运行记录」（成员名 · 状态 · 共享任务 id 与状态）。

---

## 八、🚩 需 CTO 裁决（3 项 —— 放行前请一并裁）

1. **yaml note 的 DSH 锚点已断（P8/P9/P10）**。25-8 note 现文写「须写成接入 `@deepseek-ai/dsh-settings` 的 `SettingsApplies`（v0.1.6-alpha.2 的行号）」，但锁定快照 `0.1.7-rc.1` 里该类型不存在、`applies` 被硬编码为 `"live"`（K3 P1-2 与我方复现一致）。请裁其一：
   - (a) CTO 出**并行 PR** 重锚 yaml note（创始人领地由 CTO 走）；
   - (b) 授权本卡在 note 内**只改锚点行**（不改线集结构、不改 desc/evidence 串）；
   - (c) yaml 全不动，本卡在 PR 正文 + 证据里给**现验锚点**（`path:line` 逐条可核），并在回执登记 note 待重锚。
   > 本卡倾向 (c)（零越界）+ 由 CTO 决定是否补 (a)。**若 CTO 认为 M1 口径必须"接入 DSH"，则本卡范围需重定义**（因为该能力不存在，只能"约束/对齐其边界"）。

2. **口径冲突：决定④「鉴权类 = restart」 vs 既有 LLM 凭证热重载**。仓内已有并在测的**热重载**先例：`src/config.ts:76` 注释 + `tests/routes/llm-config.test.ts:165`「同进程 `loadConfig()` 立即读到新值」+ D575 spec §6 决策 3。若把鉴权类一刀切为 restart，会**回归掉验过的热重载**。请裁：本卡是否把既有凭证热重载路径登记为**既存例外**（不动它），仅对**新声明面**实施分类。

3. **default-safe 的适用边界**。若对**全部**既有设置项（含 env 源）施「未声明⇒强制 restart」，会改变 `llmApiKey` 等既有语义（回归风险）。本卡建议：**新声明面（settings.yaml + registry）内**默认安全（未声明⇒强制 restart），**启动时把全部未声明项（含既有 env 键）打印为清单**（满足完成标准「启动日志能列出未声明分类的设置项」的可观测性），既有键语义不变。请裁可否。

---

## 九、完成标准（业务一句话，与派单件一致）

> 改阈值/文案 → **立即生效无需重启**；换数据源/连接/鉴权 → **重启前完全无感（旧值持续工作）**；且启动日志能列出「未声明分类」的设置项（默认安全可观测）。

**交付语义**：本产出标 `可提请独立审计`；**K3 复审通过前不得合并**。执行方一律不判"通过"——链条为：成员 V 独立自验 → 队长「自验结论」 → **CTO 收件闸四判据** → K3 终审。**有条件通过 = 未通过**。

---

*PLAN 完。等 CTO 复核放行（§八 三项裁决请一并给）。*
