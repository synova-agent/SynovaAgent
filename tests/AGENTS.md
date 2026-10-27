# AGENTS.md · tests/（测试域）

> 归属：产品线（各包验收件）＋治理线（`tests/control-tower`）｜ as_of `6c85b1925`

## 是什么
`tests/{acceptance,l3,sentinel,control-tower,extensions,…}`：验收件（A/M 判据）与控制塔配对自测。验收件是**判据载体**，不是实现的镜子。

## 谁改
验收件由对应包负责人改；**不得改被测实现来让测试变绿**（改坏必红）。控制塔自测归治理线。

## 怎么算完成（机器可判）
- `npx vitest run <file>` → 0 failed；**禁 skip 冒充通过**（环境不满足 ⇒ throw）
- 每文件至少 1 条 `expect`（铁律 48，禁空壳）
- 验收件：判据号逐条有具名用例（如 A1–A14 逐号 ≥1）；期望值经 `expected` 单一源；裸 testid/魔法值 = 0
- 反例：删/改对应实现 ⇒ 对应断言必红（变异留原始输出）

## 红线
- 测试不得 mock 被测管线（铁律 12）
- 不得把「看不见」写成通过；三态：0 通过／1 真红／2 环境或检查自身失败
- 不 `--no-verify`；不改门禁来迁就测试

## 改本域涉及的包
各包验收件随包走；`tests/control-tower/**` 归治理线（P4）。
