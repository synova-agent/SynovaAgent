# #984 · 0-10 fail-open 兜底 → fail-closed —— 三态取证（GREEN / 双反例 RED / 恢复）

> **任务**：task-17 B 类取证（D9209；CTO 2026-10-08 派）｜**判定人：K3 / 独立复核（执行方不自判）**
> **结论：通** —— 卡面 §⑥ V1–V6 全部成立；**V5 两条反例各自独立红**（改坏兜底 ⇒ 5 failed；删 `authProvider` ⇒ 2 failed）。
> **版本锚**：origin/main @ `44d4a721b`｜**零产品代码改动**（两处注入均跑后还原，`diff -q` 校验）
> **卡面状态**：`CLOSED`（2026-10-04）且 **0 条评论** ⇒ 本件补齐 §⑦ 要求的原始输出。

---

## §0 环境与命令

| 项 | 值 |
|---|---|
| worktree / 分支 | `.synova-wt-b977` / `evidence/D9209-b-class`（基点 `44d4a721b`） |
| V6 判据命令（卡面原文） | `npx vitest run tests/security/request-context-failclosed.test.ts tests/routes/im-authprovider.test.ts` |
| 被锁实现（只读） | `src/services/request-context.ts`（漏斗兜底）/ `src/routes/im.ts`（装配面） |

```bash
node_modules/.bin/vitest run tests/security/request-context-failclosed.test.ts tests/routes/im-authprovider.test.ts --reporter=verbose
```

---

## §1 判据逐条（命令 + 原始输出成对；全文见拼接件）

### V6 —— 回归锁复跑：exit = 0

```bash
$ node_modules/.bin/vitest run tests/security/request-context-failclosed.test.ts tests/routes/im-authprovider.test.ts ; echo "exit=$?"
 Test Files  2 passed (2)
      Tests  19 passed (19)
exit=0
```
⇒ **V6 成立**。

### V3 —— 拒绝型条件集**非空**（无上下文时）

测试件用例（原文名）：`无上下文 ⇒ conditions 非空（空集 = knowledge-store.ts:335 短路 = fail-open）`、`无上下文 ⇒ 条件集是钉死的拒绝型三元组（字段名不存在于任何权限列）` ⇒ GREEN **pass**。
被锁实现的形状（`src/services/request-context.ts:75-84`，原文）：
```ts
export async function getCurrentFilterClause(resourceType: string): Promise<FilterClause> {
  const ctx = storage.getStore();
  if (!ctx?.user || !ctx?.authProvider) {
    log.warn(
      { code: 'RBAC_DENIED', resourceType, reason: 'no_request_context' },
      '安全判据: 被拒绝 — 无请求上下文（漏斗兜底 fail-closed，返回拒绝型非空条件集）',
    );
    return { conditions: [{ field: DENY_ALL_FIELD, operator: 'EQ', value: DENY_ALL_SENTINEL }] };
  }
  return ctx.authProvider.getPermissionFilter(ctx.user, resourceType, 'read');
```
字段/算子/哨兵 = `__d947_no_authenticated_context` / `EQ` / `__d947_deny_all__`（常量定义 `:63-64`）。
⇒ **V3 成立**。

### V2 —— 每次拒绝必须 `log.warn` 留痕

测试件用例：`无上下文 ⇒ 留痕 RBAC_DENIED + reason=no_request_context`、`有 user、无 authProvider ⇒ 同样非空 deny-all + RBAC_DENIED` ⇒ GREEN **pass**；
实现侧 `log.warn({ code: 'RBAC_DENIED', resourceType, reason: 'no_request_context' }, …)`（上引片段）⇒ 铁律 24/31 载体在位。
⇒ **V2 成立**。

### V4 —— 有 `user` 无 `authProvider` ⇒ **同样拒绝**（不得因 user 存在而放行）

测试件两条用例（`有 user、无 authProvider ⇒ 同样非空 deny-all + RBAC_DENIED`、`… ⇒ 上下文确实已建立（非"没跑进 runWithContext"的假绿）`）⇒ GREEN **pass**；
实现侧判据 = `if (!ctx?.user || !ctx?.authProvider)`（**或**语义，二者缺一即拒）⇒ 与卡面不变量一致。
⇒ **V4 成立**。

### V1 —— 未认证 ⇒ 检索 0 行（真 HTTP 面）

测试件（`tests/routes/im-authprovider.test.ts`，真 HTTP + 真 JWT + 真语料）：
```
✓ 未认证：不新增 401/403 门槛，行为不变式 —— 200 + deny-all（0 条 + degraded=true）
✓ 未认证：真漏斗仍是 deny-all（非空拒绝型条件集，安全不回归）
✓ 已认证：用户可见产出 —— knowledgeSources > 0 且 degraded=false，受限条目被过滤
```
⇒ **V1 成立**（未认证 0 条 + `degraded=true`；已认证产出不受损 —— 与卡面 §⑪「正常认证用户结果不减少」一致）。

### V5 —— 反例（改坏即红）：**两条独立注入**

**V5a：把兜底改回空条件集**（`src/services/request-context.ts`）
```diff
-    return { conditions: [{ field: DENY_ALL_FIELD, operator: 'EQ', value: DENY_ALL_SENTINEL }] };
+    return { conditions: [] }; // BREAK-IT-RED (#984 V5a): 空集 = knowledge-store 短路 = fail-open
```
```
 × 无上下文 ⇒ conditions 非空（空集 = knowledge-store.ts:335 短路 = fail-open）
 × 无上下文 ⇒ 条件集是**钉死的**拒绝型三元组（字段名不存在于任何权限列）
 × 无上下文 ⇒ 与 resourceType 无关（边界: 多资源类型一律拒绝）
 × 有 user、无 authProvider ⇒ 同样非空 deny-all + RBAC_DENIED
 × 有 user、无 authProvider ⇒ 上下文确实已建立（非「没跑进 runWithContext」的假绿）
 Test Files  1 failed (1)
      Tests  5 failed | 4 passed (9)
```

**V5b：删掉 `im.ts` 的 `authProvider`**（只传 user ⇒ 落回 deny-all）
```diff
     const result = await runWithContext({
       user: imUser,
-      authProvider: {
-        getPermissionFilter: async (ctx) => ({ conditions: [{ field: 'access.sensitivity', operator: 'IN' as const,
-          value: allowedSensitivities(ctx.auth.roles[0], ctx.auth.sensitivity) }] }),
-      },
+      // BREAK-IT-RED (#984 V5b): 删掉 authProvider（只传 user ⇒ 落回 deny-all）
     }, async () => {
```
```
 × 已认证飞书入站：路由实际传入的 ctx 带**可用的** authProvider
 × 把路由用过的 ctx 重进真漏斗：得到 sensitivity 条件，而非 deny-all
 Test Files  1 failed (1)
      Tests  2 failed | 8 passed (10)
```
恢复：两文件各自 `git checkout --` ⇒ `diff -q` 与运行前副本一致（`request-context.ts RESTORED-IDENTICAL` / `im.ts RESTORED-IDENTICAL`）⇒ 回绿（`19 passed (19)`）。
⇒ **V5 成立**（两条反例分别覆盖"漏斗本体"与"装配面"两处修复点）。

---

## §2 三态对照

| 态 | 触发 | 结果 |
|---|---|---|
| ① GREEN | 未改动 | `2 files / 19 passed (19)` · exit 0 |
| ② RED-a | 兜底改回 `conditions: []` | `1 file failed / 5 failed \| 4 passed (9)` |
| ③ RED-b | 删 `im.ts` 的 `authProvider` | `1 file failed / 2 failed \| 8 passed (10)` |
| ④ GREEN（恢复） | 两处 `git checkout --` | `2 files / 19 passed (19)` · exit 0 |

---

## §3 结论、边界与未解决项

**结论：通。** V1（未认证 0 行 + `degraded=true`）/ V2（`RBAC_DENIED` + `reason=no_request_context` 留痕）/ V3（非空拒绝型三元组，哨兵值钉死）/ V4（有 user 无 authProvider 同样拒绝）/ V5（两条反例各自红）/ V6（exit 0、19 passed）**全部成立**。

**边界（诚实声明）**：
1. 验证级别 = **L2-真跑通**（真 HTTP + 真 JWT + 真语料路径；漏斗本体为纯函数面，测试用 `runWithContext` 真进真出）。
2. 本件为**回归锁复跑取证**，非新实现：修复本体在 `#1011`（MERGED 2026-10-04）之后的 main 上；**本件零产品代码改动**（两处注入已还原）。
3. 卡面 §⑪ 的"负面体验预告"（白名单路径无上下文时也 0 行）在本件实测中**复现为预期行为**（`未认证：… 200 + deny-all（0 条 + degraded=true）`）——**不得回退**（卡面明示）。
4. 0-9（#983）/1-7（#1051）的"过滤真实现/多岗位执法"**不在本卡范围**，本件不主张其状态。

**未解决/待裁**：无新增。本卡 `CLOSED` 且 **0 条评论** ⇒ 本件即 §⑦ 要求的原始输出（由 K3/CTO 核可，执行方不自关）。

---

## §4 复现（自足）

```bash
git worktree add --no-track -b evidence/D9209-984-repro .synova-wt-984-repro origin/main
ln -sfn /Users/wane/SynovaAgent/node_modules .synova-wt-984-repro/node_modules
cd .synova-wt-984-repro && export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"

node_modules/.bin/vitest run tests/security/request-context-failclosed.test.ts tests/routes/im-authprovider.test.ts ; echo "exit=$?"   # ① ⇒ 19 passed

python3 - <<'PY'    # ② V5a：兜底改空集
import io; p='src/services/request-context.ts'; s=io.open(p,encoding='utf-8').read()
old="    return { conditions: [{ field: DENY_ALL_FIELD, operator: 'EQ', value: DENY_ALL_SENTINEL }] };"
assert old in s; io.open(p,'w',encoding='utf-8').write(s.replace(old,"    return { conditions: [] };",1))
PY
node_modules/.bin/vitest run tests/security/request-context-failclosed.test.ts ; echo "exit=$?"      # ② ⇒ 5 failed
git checkout -- src/services/request-context.ts

python3 - <<'PY'    # ③ V5b：删 authProvider（按 §1 的 diff 逐行删除该块）
import io; p='src/routes/im.ts'; s=io.open(p,encoding='utf-8').read()
start=s.index("      authProvider: {"); end=s.index("      },\n    }, async () => {", start)+len("      },\n")
io.open(p,'w',encoding='utf-8').write(s[:start]+s[end:])
PY
node_modules/.bin/vitest run tests/routes/im-authprovider.test.ts ; echo "exit=$?"                    # ③ ⇒ 2 failed
git checkout -- src/routes/im.ts                                                                     # ④ 恢复（禁 git stash）
node_modules/.bin/vitest run tests/security/request-context-failclosed.test.ts tests/routes/im-authprovider.test.ts ; echo "exit=$?"   # ④ ⇒ 19 passed
```

---

## §5 本目录文件清单

```
984-0-10fail-open兜底-取证报告.md   （本件）
984-原始输出-三态.log.txt           （8 段 verbatim：run-meta / GREEN 日志 / V5a 注入 diff / V5a RED 日志 /
                                     V5b 注入 diff / V5b RED 日志 / 恢复 GREEN 日志 / 不变量与留痕片段；
                                     段内标注各原文件 sha256）
```
