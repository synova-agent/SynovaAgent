# CI 补丁提案 · V7 归因棘轮 → 真门禁

> 🔴 **本卡不能改 `.github/**`**（A 槽属治理线）⇒ 本文是**提案**，未生效、未提交到 `.github/`。
> 落地人 = 治理线。落地后请复跑 §5 的复验命令并回填结果。
> 唯一改动点：`.github/workflows/ci.yml` 一个 step（`Run tests`，L246–269）。
> 逐行 diff：`raw/ci-patch.diff` ｜ 打过补丁的完整副本：`raw/ci-patched.yml`（可直接 `--ci-yml` 喂探针）。

---

## 1. 改动范围

| 项 | 值 |
|---|---|
| 文件 | `.github/workflows/ci.yml` |
| 唯一 step | `jobs.test.steps[name="Run tests"]` 的 `run:` 正文 |
| 行区间 | 原 **L246–269**（24 行）→ 新 **50 行** |
| diff | **+43 / −19**（`raw/ci-patch.diff`，71 行含上下文） |
| YAML 合法性 | 已校验：13 个 job 不变、`jobs.test.steps` 仍 5 步（`js-yaml` 实跑） |
| **新增外部依赖** | **0 个新脚本**；只需治理线新增一个**数据文件** `scripts/control-tower/vitest-red-exempt.txt` |
| 其它 step / job | **零改动** |

---

## 2. 逐行 diff（含理由）

```diff
--- .github/workflows/ci.yml
+++ .github/workflows/ci.yml   (proposal)
@@ L245,26 +245,50 @@
           if [ "$EXIT_CODE" = "0" ]; then exit 0; fi
           # 去除 ANSI 颜色码后提取失败文件列表
           CLEAN_OUTPUT=$(echo "$OUTPUT" | sed 's/\x1b\[[0-9;]*[a-zA-Z]//g')
-          FAILED_TESTS=$(echo "$CLEAN_OUTPUT" | grep " FAIL " | grep -oP 'tests/\S+\.test\.ts' || true)
-          if [ -n "$FAILED_TESTS" ] && [ -n "$CHANGED" ]; then
-            NEW_FAILURES=""
-            while IFS= read -r tf; do
-              SOURCE_FILE=$(echo "$tf" | sed 's|^tests/|src/|; s|\.test\.ts|.ts|' | sed 's|-sentinel||' || true)
-              if echo "$CHANGED" | grep -qF "$SOURCE_FILE" 2>/dev/null || echo "$CHANGED" | grep -qF "$tf" 2>/dev/null; then
-                NEW_FAILURES="${NEW_FAILURES}${tf}\n"
+          # 🔴 V7（#1032）修复①: 失败清单取**全路径**。
+          #   旧式 `grep -oP 'tests/\S+\.test\.ts'` 有两条静默降级：
+          #     ① 路径不含 "tests/" 子串的失败（extensions/**、scripts/**…）整条被丢掉；
+          #     ② `packages/x/tests/**` 只匹配到 "tests/" 之后的部分 ⇒ **前缀被截断** ⇒ 错归因。
+          #   新式按 FAIL 行整取首段非空白字段，不预设路径形状。
+          FAILED_TESTS=$(echo "$CLEAN_OUTPUT" | grep -E '^[[:space:]]*FAIL[[:space:]]+' \
+            | sed -E 's/^[[:space:]]*FAIL[[:space:]]+//; s/[[:space:]].*$//' | sort -u || true)
+          if [ -n "$FAILED_TESTS" ]; then
+            TODAY=$(date -u +%F)
+            LEDGER="scripts/control-tower/vitest-red-exempt.txt"
+            NEW_FAILURES=""; EXEMPT_FAILURES=""
+            while IFS= read -r tf; do
+              [ -z "$tf" ] && continue
+              SOURCE_FILE=$(echo "$tf" | sed 's|^tests/|src/|; s|\.test\.ts$|.ts|' || true)
+              if [ -n "$CHANGED" ] && { echo "$CHANGED" | grep -qF "$SOURCE_FILE" 2>/dev/null || echo "$CHANGED" | grep -qF "$tf" 2>/dev/null; }; then
+                NEW_FAILURES="${NEW_FAILURES}${tf} (本 PR 引进)\n"; continue
               fi
-            done <<< "$FAILED_TESTS"
-            if [ -z "$NEW_FAILURES" ]; then
-              # D721: 放行必须可见（铁律 11 静默降级禁止）。…
-              echo "::warning::Vitest 存量红放行（非本 PR 改动文件引入，main 上同样红）: …"
-              echo "PREEXISTING_RED_FILES:"
-              echo "$FAILED_TESTS"
-              echo "→ 这些是真红，已登记 board-backlog: PLAN-main-vitest-preexisting-red（须烧掉，勿长期依赖放行）"
-              exit 0
+              # 🔴 V7 修复②: 归因外失败**不再无条件放行** —— 只允许"台账登记 + 未过期"。
+              #   台账行格式: <测试路径> | owner=<名> | expires=YYYY-MM-DD
+              #   棘轮只减不增（M-03）: 过期即红；放行条目须修掉或显式延期，不得续期式常驻。
+              EXPIRES=$(awk -F'|' -v f="$tf" '
+                /^[[:space:]]*#/ {next}
+                { p=$1; gsub(/^[[:space:]]+|[[:space:]]+$/,"",p);
+                  if (p != f) next;
+                  for (i=2;i<=NF;i++){ k=$i; gsub(/^[[:space:]]+|[[:space:]]+$/,"",k);
+                    if (k ~ /^expires=/){ sub(/^expires=/,"",k); gsub(/[[:space:]]/,"",k); print k } } }' "$LEDGER" 2>/dev/null | tail -1)
+              if [ -n "$EXPIRES" ] && [ "$EXPIRES" \> "$TODAY" ]; then
+                EXEMPT_FAILURES="${EXEMPT_FAILURES}${tf} (登记至 ${EXPIRES})\n"
+              else
+                NEW_FAILURES="${NEW_FAILURES}${tf} (归因外未登记/已过期)\n"
+              fi
+            done <<< "$FAILED_TESTS"
+            if [ -n "$EXEMPT_FAILURES" ]; then
+              echo "::warning::Vitest 台账内存量红放行（未过期；铁律 11 可见）: $(echo -e "$EXEMPT_FAILURES" | tr '\n' ' ')"
+              echo "PREEXISTING_RED_FILES:"
+              echo -e "$EXEMPT_FAILURES"
+              echo "→ 这些是真红，已登记 vitest-red-exempt.txt（须烧掉；到期即转红）"
             fi
-            echo "本 PR 引进的测试失败（阻断）:"
-            echo -e "$NEW_FAILURES"
+            if [ -n "$NEW_FAILURES" ]; then
+              echo "::error::Vitest 阻断（本 PR 引进，或归因外未登记/已过期）:"
+              echo -e "$NEW_FAILURES"
+              exit 1
+            fi
+            exit 0
           fi
           exit 1
```

### 逐条理由

| 改动 | 为什么 |
|---|---|
| `grep -oP 'tests/\S+\.test\.ts'` → `grep -E '^[[:space:]]*FAIL[[:space:]]+' \| sed -E '...' \| sort -u` | 修缺陷①②。**不再预设路径形状**：`extensions/**`、`packages/**`、`scripts/**` 全部纳入；前缀不再被截断。`sort -u` 去重（同一文件多行 FAIL）。 |
| `if [ -n "$FAILED_TESTS" ] && [ -n "$CHANGED" ]` → `if [ -n "$FAILED_TESTS" ]` | 修缺陷③的一部分：**姿态无关**。原先 CHANGED 为空（main push）会跳过整个判定直落 `exit 1`，导致 PR 面/ main 面**两套语义**。现在两面同一条判据。 |
| 新增 `LEDGER` 查询（`awk -F'|'` 按键取值） | 修缺陷④：引入**到期语义**。键 = 测试文件路径；放行必须"登记 + 未过期"。用 `awk` 而非新脚本 ⇒ 提案不新增外部依赖。 |
| `if [ -z "$NEW_FAILURES" ]; then …exit 0` 块 ← 改为 `EXEMPT_FAILURES` 分支 | 修缺陷③的核心：原先**全有全无**（一条能不能归因决定全部放行）。现在**逐条判**：可归因 ⇒ 阻断；归因外 ⇒ 必须命中台账。 |
| 结尾 `exit 0` / `exit 1` 分流 | 全部失败都在台账内 ⇒ `exit 0`（存量红放行，仍打 `::warning::`；铁律 11 可见）；有任何一条不可归因且未登记/已过期 ⇒ `exit 1`。**`FAILED_TESTS` 为空但 vitest 非 0** ⇒ 落最后 `exit 1`（fail-closed，不静默）。 |
| 错误输出用 `::error::` 而非 `::warning::` | 阻断项进注解面（CI 日志端点匿名常 404，注解可公开检索） |

### 新增数据文件（治理线建，**本卡未建**）

`scripts/control-tower/vitest-red-exempt.txt`（格式：`#` 注释 + 每行一条）：
```
# <测试路径> | owner=<名> | expires=YYYY-MM-DD
tests/l3/graphbridge-wiring.test.ts | owner=<待指派> | expires=2026-11-05
```
- 种子必须**逐条经裁**：`tests/l3/graphbridge-wiring.test.ts` 的映射源 `src/l3/graphbridge-wiring.ts`
  **在仓内不存在** ⇒ 它**永远无法归因**，只能靠豁免；因此它更需要**到期日**倒逼修或删。
- 若采用本提案，`exclude` 那 17 条（见 `v8-disposal-list.md` D4）也需一并裁决，
  否则 D4 的存量红会与 V7 修复叠加：**包含 D1 扩容后，未登记的 7 个新红会阻断全部 PR**（见 §4）。

---

## 3. 复验命令（落地人必跑）

```bash
export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"
cd <worktree>

# ① 补丁副本自证：8/8 必备语义、exit 0
bash tests/ci/attribution-ratchet-probe.sh \
  --ci-yml docs/synova/product-lines/evidence/V7V8/raw/ci-patched.yml --verbose; echo "EXIT=$?"

# ② 现存 ci.yml 对照：5/8、exit 1（证明探针有判别力，不是恒绿）
bash tests/ci/attribution-ratchet-probe.sh --verbose; echo "EXIT=$?"

# ③ 落地后（真 CI）：开一个"只改 docs 的 PR"⇒ Vitest job 应收 **failure**（现状是 success）
```
> ③ 是**唯一能收口"真 CI 断言"的一步**；不做 ③，V7 只能停在"本地等价判据已证、真 CI 未验"。

---

## 4. 🔴 与 V8 扩容的相互影响（落地前必须一起裁）

本卡已把 `include` 扩到覆盖全部 656 个 `.test.ts` ⇒ 补后新增 **7 个真红**（见 `v8-disposal-list.md` D2）。

| 组合 | CI 行为 |
|---|---|
| 现状 ci.yml + 扩容（本卡现状） | Vitest job 仍 `success`（棘轮吞掉全部 7 个红+既有红）⇒ 扩容**看不见收益** |
| **本提案 + 扩容，且 7 个红未登记** | Vitest job **红**，**全部 PR 被阻断** ← 必须避免的中间态 |
| **本提案 + 扩容 + 7 个红已裁决**（修复 / 退役 / 登记+到期） | 真门禁成立，且铁律 36 在 PR 面**首次真正成立** |

⇒ **建议的落地顺序**：
1. 先裁 D2 的 7 个红 + D4 的 17 条 exclude（`v8-disposal-list.md`）；
2. 再落本提案 + 建 `vitest-red-exempt.txt`（种子只放"经裁且带到期日"的条目）；
3. 最后开一个 docs-only PR 走 ③ 收口。

---

## 5. 本卡未做的事（主动列）

| 未做 | 为什么 |
|---|---|
| 未改 `.github/**`（一行都没动） | 卡面红线：A 槽属治理线。`git diff --stat` 可证 |
| 未建 `scripts/control-tower/vitest-red-exempt.txt` | `scripts/**` 不在本卡写集 |
| 未跑真 CI | 本会话不取 GitHub Actions 运行结果 ⇒ **真 CI 断言 = 未验**（`v7-attribution-ratchet.md` §5） |
| 未改 `package.json` / `package-lock.json` | `npm ci` ERESOLVE 属治理线 W1（#1159） |
