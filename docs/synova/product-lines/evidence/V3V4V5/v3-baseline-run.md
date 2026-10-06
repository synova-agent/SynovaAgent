# V3 · B 判据实测 —— 「修复前基线须红」

## 基线

```
$ git -C /tmp/regown/base rev-parse --short HEAD
74eb6c44c            # = origin/main（未做任何修复的基线）
$ git -C /tmp/regown/base status --porcelain | wc -l
0                    # 干净检出（除 node_modules 软链）
```

> 判据件实况在 `origin/main` 与栈式 base `docs/D1144-registry-unbundle` 上**完全相同**（D1144 只加了登记件本身）：
> `analyze.ts` 对两 ref 输出逐行一致，见 `v4-criteria-existence.md`。

## 口径

判据 = 登记件 `acceptance` 里引用的**现成判据件**（6 项 / 6 步）。
其余 40 项的判据件不在 ref ⇒ 记 `unrunnable`（B **无从判**）——**既不算红也不算绿**。

## 命令与原始输出（逐项）

### 0-5 — `tests/growth/goal-sentinel.test.ts`

```
$ cd /tmp/regown/base && node ./node_modules/vitest/vitest.mjs run tests/growth/goal-sentinel.test.ts --reporter=dot
Test Files  1 passed (1)
      Tests  14 passed (14)
   Start at  14:10:50
   Duration  141ms (transform 34ms, setup 0ms, import 51ms, tests 6ms, environment 0ms)
EXITCODE=0
```

### 0-7 — `tests/routes/chat-feedback.test.ts`

```
$ cd /tmp/regown/base && node ./node_modules/vitest/vitest.mjs run tests/routes/chat-feedback.test.ts --reporter=dot
Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  14:10:51
   Duration  308ms (transform 116ms, setup 0ms, import 119ms, tests 103ms, environment 0ms)
EXITCODE=0
```

### 0-10 — `tests/security/request-context-failclosed.test.ts`

```
$ cd /tmp/regown/base && node ./node_modules/vitest/vitest.mjs run tests/security/request-context-failclosed.test.ts --reporter=dot
Test Files  1 passed (1)
      Tests  9 passed (9)
   Start at  14:10:52
   Duration  143ms (transform 35ms, setup 0ms, import 53ms, tests 4ms, environment 0ms)
EXITCODE=0
```

### 1-7 — `tests/security/rbac-all-routes.test.ts`

```
$ cd /tmp/regown/base && node ./node_modules/vitest/vitest.mjs run tests/security/rbac-all-routes.test.ts --reporter=dot
Test Files  1 passed (1)
      Tests  46 passed (46)
   Start at  14:10:55
   Duration  395ms (transform 148ms, setup 0ms, import 246ms, tests 58ms, environment 0ms)
EXITCODE=0
```

### 2-4 — `tests/security/file-guard.test.ts`

```
$ cd /tmp/regown/base && node ./node_modules/vitest/vitest.mjs run tests/security/file-guard.test.ts --reporter=dot
Test Files  1 passed (1)
      Tests  12 passed (12)
   Start at  14:10:56
   Duration  135ms (transform 22ms, setup 0ms, import 33ms, tests 3ms, environment 0ms)
EXITCODE=0
```

### 3-12 — `tests/evolution/global-analyzer.test.ts`

```
$ cd /tmp/regown/base && node ./node_modules/vitest/vitest.mjs run tests/evolution/global-analyzer.test.ts --reporter=dot
Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  14:10:57
   Duration  209ms (transform 79ms, setup 0ms, import 109ms, tests 6ms, environment 0ms)
EXITCODE=0
```

## 合并跑（与 S5 尽调数字对照）

```
$ cd /tmp/regown/base && node ./node_modules/vitest/vitest.mjs run \
    tests/growth/goal-sentinel.test.ts \
    tests/routes/chat-feedback.test.ts \
    tests/security/request-context-failclosed.test.ts \
    tests/security/rbac-all-routes.test.ts \
    tests/security/file-guard.test.ts \
    tests/evolution/global-analyzer.test.ts --reporter=dot
Test Files  6 passed (6)
      Tests  87 passed (87)
   Start at  14:00:40
   Duration  688ms (transform 996ms, setup 0ms, import 1.55s, tests 204ms, environment 9ms)
EXITCODE=0
```

> S5 尽调记 `6 passed / 87 passed / exit 0`；本次自复跑**逐字一致**（61 = 逐项和 14+2+9+46+12+4 = 87 ✓）。

## 结论

```
B(green)      = 6     # 判据件存在，但在未修复基线上全绿 ⇒ B 不成立
B(unrunnable) = 40    # 判据件不在 ref ⇒ B 判不了
B(red)        = 0     # 无一项以断言失败的方式红
⇒ B 满足率 = 0/46
```

## 附：1-1 改指向后的实跑（本会话未取得判据结论）

```
$ cd /tmp/regown/base && bash scripts/golden-scenarios/GS-08-report-readable/run.sh
[GS-08] JWT_SECRET 已自举（长度 48），token 已签发
[GS-08] 临时数据目录: 
scripts/golden-scenarios/GS-08-report-readable/run.sh: line 58: /tsx.log: Operation not permitted
EXITCODE=1
```

> 该 exit 1 **不是断言失败**：`fresh-db.ts` 直跑可返回临时目录（见下），但在本会话沙箱下 `npx` 写日志路径解析成 `/tsx.log` 被拒 ⇒ 属环境受限。
> 故 1-1 记 `L1 / unrunnable / 未验`，**不记为红**（判例 P-04：不为让上级安心而做假动作）。

```
$ cd /tmp/regown/base && npx tsx scripts/golden-scenarios/common/fresh-db.ts
/var/folders/bs/ltqkv_rd45z6b7p5wq90vv500000gn/T/synova-gs-aTNvja
EXITCODE=0
```
