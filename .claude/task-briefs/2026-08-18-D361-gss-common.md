# Task Brief: D361 GSS 基建 — common/ 四工具 + 断言规范 + 测试

> 生成: 2026-08-16 | 分支: main | 角色: DeepSeek Harness (Mac)
> 依据: SYNOVA-DESIGN-黄金场景与创始人驾驶舱-v1 §2.1（目录）/§2.3（断言规范）/§八 D361
> 创始人仲裁（08-16）：GS-02/03/04 场景脚本本体等 Win D366 修复合并后再写；本任务只做
> common/ 基建（纯 scripts/golden-scenarios/ 认领区，零 src/ 变更，零撞车）。

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
黄金场景证据引擎的共享基建层。为 D362-D364 场景脚本提供四件套：
bootstrap（临时端口起服务）/ fresh-db（临时库）/ inject（fixture 契约校验）/ assert（机器断言）。

### b) 文件审计（接口从代码 grep，已核实）
- 服务入口: src/index.ts（tsx 启动）；端口 env `PORT`（src/config.ts:90）
- 数据库路径 env: `SYNOVA_DATA_DIR` / `SYNOVA_DB_PATH`（src/config.ts:86-88）→ fresh-db 用临时目录重定向，**零 cp 真实库（铁律 0-4）**
- 就绪探测: GET /api/healthz（src/routes/healthz.ts）
- fixture 契约: extensions/ontology/field-mappings/*.json（externalField/prop/type，如 erp-standard.json）
- sqlite: better-sqlite3 11.10.0（package.json）
- 证据消费方: calc-progress.py 要求 {schema:1, record_type, date, verdicts:[{acceptance_point,verdict,quote}]}

### c) 决策（D333 记录，K3 可核）
- 参考：Anthropic（机器可验契约: expect-schema.json + 三态 exit 码）+ DeepSeek（最少机制:
  fresh-db 只产临时目录让 server 自建 schema，不复制任何库文件）+ 第一性原理
  （断言必须区分"真空结果"与"查询失败"——K3 P0-3 fail-open 同态教训）。
- bootstrap 参数化 --entry（测试用假服务，生产用 src/index.ts）——测试不 mock 管线（铁律 12）。

## Q1: 调研 — 决策链 + 执行约束

### a) Anthropic 决策链
① SPEC（expect-schema.json 先定义机器契约）→ ② 测试（三路径: 正常/降级/边界）→
③ 实现（四工具 ≤500 行）→ ④ 接线（D362+ 的 run.sh 将调用；本任务内测试即消费方 +
证据格式与 calc-progress.py 对接）→ ⑤ 验证。
引用：铁律 0-2/12/24/31/33/47/48；GSS 设计 §2.3 断言规范（禁止恒真/负向断言/三态语义）；
铁律 0-4（禁 cp 数据库）。

### b) 本任务执行约束
- rule: "断言必须绑定产品承诺（purpose 字段非空），禁止恒真断言（echo true 类）"
  verify: "grep -c 'purpose' scripts/golden-scenarios/common/expect-schema.json > 0；assert 引擎对缺 purpose 拒绝"
- rule: "铁律 0-4 物理防线在 bootstrap——数据目录必须在系统临时区，否则 exit 2"
  verify: "grep -n '铁律 0-4' scripts/golden-scenarios/common/bootstrap.ts"
  （实现记录 08-16: fresh-db 的环境变量守卫按实测误报移除——开发者会话常自带
  SYNOVA_DB_PATH 指向真实库，但 fresh-db 不消费该变量；物理执法 > 环境探测，测试补回归用例）
- rule: "证据输出与 calc-progress.py 契约对齐（schema=1/record_type=scenario/verdicts[]）"
  verify: "tests/golden-scenarios/gss-common.test.ts 断言证据 JSON 字段"

### c) 决策参考系
参考：Anthropic/DeepSeek/第一性原理 + 结论（见 Q0c）。

## Q2: 范围 — 正确的最简方案

做什么：
- scripts/golden-scenarios/common/bootstrap.ts
- scripts/golden-scenarios/common/fresh-db.ts
- scripts/golden-scenarios/common/inject.ts
- scripts/golden-scenarios/common/assert.ts
- scripts/golden-scenarios/common/expect-schema.json
- scripts/golden-scenarios/README.md
- tests/golden-scenarios/gss-common.test.ts
- tests/golden-scenarios/fixtures/dummy-server.ts
- .claude/task-briefs/D361-gss-common.md

不做什么：
- 不写 GS-01~GS-08 场景脚本本体（scripts/golden-scenarios/GS-*/run.sh —— 等 Win D366 合并后 D362+）
- 不改 src/index.ts（业务代码归 Win/Claude）
- 不改 extensions/ontology/field-mappings/*.json（只读消费）
- 不改 scripts/product-lines/calc-progress.py（证据契约对齐即可，消费方不动）
- 不碰 scripts/audit/audit-check.py（K3 红线）
- 不改 scripts/pre-commit-check.sh（已归 Win）

## Q3: 验收 — 入口 → 交互 → 结果

入口（用户从哪触发）：场景脚本（D362+）调用；本任务内: npx tsx scripts/golden-scenarios/common/<tool>.ts
处理（中间经过哪些步骤）：临时目录建库守卫 → 假服务 bootstrap+healthz → fixture 契约校验 → 断言三态判定
结果（最终展示在哪）：evidence JSON（calc 可消费）+ exit 0/1；tests/golden-scenarios/gss-common.test.ts 全绿

## 架构层: 基础设施
#CRITERIA: A

## Done 标准
- [ ] 入口可触达: npx tsx scripts/golden-scenarios/common/fresh-db.ts 退出 0 且产出临时目录（不在仓库内）
- [ ] 链路走通: npx vitest run tests/golden-scenarios/gss-common.test.ts 全绿（三路径）
- [ ] 结果可见: assert.ts 对 fixture expect.json 产出 evidence JSON 且 schema=1/record_type=scenario/verdicts[] 与 calc-progress.py 契约一致
- [ ] 门禁: bash scripts/pre-commit-check.sh 13 组全绿 + check-silent-swallow --utf8 全绿
