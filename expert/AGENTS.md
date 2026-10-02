# expert/ · 施工守则

## 一、这块是什么

`expert/` 是 6 位问题域专家的**声明式定义目录**：6 个专家目录 + 共享 `expert-registry.yaml`（唯一事实源），启动时被扫成专家 system prompt。`_template/`、`_deprecated/` 被扫描器跳过（`src/agent/file-scanner.ts:256`：`_` 前缀即 continue）。加专家 = 加目录 + registry 条目，不改 TS。

## 二、谁可以改

**归属线（实测）**：`expert/**` 在 `docs/synova/coordination/ownership.yaml` **无专属规则**，落 `**` 兜底 → **win**；声明 mac 被判越域。业务上本域属产品线，与实测归属**冲突**——勿自改 `ownership.yaml`。

```
$ python3 scripts/control-tower/check-ownership.py expert/host/PROMPT.md --owner mac
win  expert/host/PROMPT.md
❌ 越域: 声明 owner=mac，实际 owner=win
```

**改这块必须同时改**：

| 动作 | 连带必改 | 门禁 |
|---|---|---|
| 增删/改名专家目录 | `expert-registry.yaml` 同名条目；目录集须 == registry 声明集 | e2e Stage 5b（`tests/e2e/full-pipeline.integration.test.ts:201`） |
| 新专家 | `manifest.json` 必填 name/version/type/displayName/description | `tests/expert/manifest-consistency.test.ts` |
| 改 registry `tools:` | 该名须在 `expert/` 或 `skills/` grep 到 | `scripts/validate-expert-config.sh`（pre-commit 7b） |
| 改 `PROMPT.md` | 角色段+输出结构段+行动词汇，≥5 行，无 `{{`/`TODO`/`???` | `scripts/ci/diagnosis-quality-check.sh`（pre-push 硬阻断） |
| 专家名 | 禁含 `cycle`；旧 8 名不得回流 | `tests/expert/expert-enum-propagation.test.ts`（锁 5 处硬编码现场） |

**越界**：diff 含 `expert/` 又混装他域 → D733「变更跨域」；找 CTO（`docs/synova/dispatch/`）。

## 三、改完怎么算完成

**必须穿的生产入口（实测）**：
- `src/deploy/bootstrap.ts:1013`（Phase 4i）/ `src/server.ts:307` / `src/routes/reload.ts:28` → `ExpertFileLoader.loadFromIndex()` → `src/l3/expert-registry.ts`
- `PROMPT.md` 两条独立链：`src/agent/expert-router.ts:86`（缺失→`degraded:true` 空分析）、`src/agent/prompt-assembler.ts:484`（经 `manifest.json` 的 `promptTemplate`）

**本域独有红线**：
1. **现状 6/6 专家 `degraded=true`（实测）**：`assemblePrompt` 要求 8 段（`src/agent/expert-file-loader.ts:128-148`），6 位**全缺** `SOUL.md`+`STAGE_LOGIC.md`，`competitive-strategy`/`host`/`technology-foundation` 另缺 `KNOWLEDGE.md`。⚠️ `PROMPT.md` 不在扫描清单 `EXPERT_FILE_NAMES` 内，**它不是 degraded 的原因**——别照传闻修。
2. `expert/` **不在 CI docs-only 白名单**（`.github/workflows/ci.yml:74` 明列「运行时资产」排除）→ 动它就全量 CI。
3. `manifest.json` 数组形态 `"tools": [...]` 零残留（D663 死字段）；真 seam 是 `computes` + `compute-map.yaml`（顶层键 = 目录名）。
4. `_` 前缀 = 扫描盲区；目录从 `_deprecated` 改名移出会**瞬间进生产**。
5. `scripts/check-architecture.sh:88` 的 `PAT_L3` 含 `/expert/`——L1/L2 代码 import 带此路径即跨层。

**「改坏即红」最小用例（实测）**：

```bash
export PATH="/Users/wane/.nvm/versions/node/v22.23.2/bin:$PATH"
npx vitest run tests/expert/                # 5 files / 74 tests / 299ms 全绿
bash scripts/ci/diagnosis-quality-check.sh  # 9/9 passed
bash scripts/validate-expert-config.sh      # exit 0
# 另跑 FileScanner+ExpertFileLoader 探针复查 degraded（当前 DEGRADED=6/6）
```

## 四、不在这里的事

哨兵定义 → `extensions/sentinels/`；compute 实现 → `src/l3/`；共享知识正文 → `knowledge/shared/`（`KNOWLEDGE.md` 只引用不复制）；`ExpertRegistry`/`ExpertDispatcher`/`ExpertStore` 源码 → `src/l3/`、`src/expert-platform/`；`scripts/audit/**` = K3 红线。

## 五、不确定找谁

归属线冲突（产品线 vs 实测 win）→ CTO，勿自改 `ownership.yaml`；专家数口径锁在 `scripts/control-tower/weekly-selfcheck.sh:97`（实测 6=6）；`degraded` 缺口修复派单 → CTO。
