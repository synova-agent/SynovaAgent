# #1459 M2 契约合格率抽样（M2a / M2b 分列）

> 生成 = consolidate.mjs（每条数据读自该 run 的 SSE 重放 + DSH 会话日志 + 桌面 DOM，无手写数字）｜2026-11-24T12:46:54.384Z

## 合格率（两种口径分开列，禁止混用）

- **形状合格** = 服务端适配器判 `hypothesis.structured`（四要素非空且类型正确）÷ **有文本的 run**。
- **内容回指** = 四要素**逐项**命中隔离库里真实存在的 `$id` / `predicate` / `source_ref`（DEV DOC v1.1 §10.1 的重点口径）。

| 段 | 记录 run | 有文本 run（分母） | 空文本 run | 形状合格 | 形状合格率 | 内容回指 | 内容回指率 |
|---|---|---|---|---|---|---|---|
| M2a（自然提问，零格式要求） | 5 | 5 | 0 | 0 | **0%** | 0 | **0%** |
| M2b（同题 + T5 形状要求） | 5 | 5 | 0 | 3 | **60%** | 0 | **0%** |

## 失败码分布

| 段 | reason.code | 条数 |
|---|---|---|
| M2a | invalid:NOT_JSON | 5 |
| M2b | invalid:MISSING_FIELDS | 2 |

## 逐条记录（每条一行；每条各问一次，无重试）

| id | runId | prompt（≤60字） | 假设事件 | reason.code | 内容回指 | textDeltas | usage.totalTokens |
|---|---|---|---|---|---|---|---|
| M2a-Q1 | `run_0241cf549dc445ec83e432187d6e87d2` | 我们今年的增长为什么慢下来了？主要卡在哪个环节？… | invalid | NOT_JSON | no | 1 | 68496 |
| M2a-Q2 | `run_9884a98caf314eae9246588e8b2cf4f8` | 交付团队的产能是不是瓶颈？如果是，具体卡在哪一步？… | invalid | NOT_JSON | no | 1 | 169758 |
| M2a-Q3 | `run_175aa36198ff42cbb6e388bfdfabfdd0` | 如果只能改一件事来提升回款速度，你会改什么？… | invalid | NOT_JSON | no | 1 | 111968 |
| M2a-Q4 | `run_97ab580057594b0b8c30dba0d5f35e13` | 我们组织里哪个团队对结果影响最大、却最容易被忽视？… | invalid | NOT_JSON | no | 1 | 374799 |
| M2a-Q5 | `run_33e836a0cac743e6ac1267c1b2f23236` | 就现在能看到的数据，有哪些地方你其实没法确认、需要我们去核？… | invalid | NOT_JSON | no | 1 | 25013 |
| M2b-Q1 | `run_e3f724d7bba1447aaa08547820957e35` | 我们今年的增长为什么慢下来了？主要卡在哪个环节？ 请只调用一次工具 synova_context_get。拿到返回 JS… | invalid | MISSING_FIELDS | no | 1 | 22722 |
| M2b-Q2 | `run_4571e32b44a6404facfb5012c4232b2f` | 交付团队的产能是不是瓶颈？如果是，具体卡在哪一步？ 请只调用一次工具 synova_context_get。拿到返回 J… | structured | - | no | 1 | 22367 |
| M2b-Q3 | `run_2c704703878f441791a35d8d325ef410` | 如果只能改一件事来提升回款速度，你会改什么？ 请只调用一次工具 synova_context_get。拿到返回 JSON… | structured | - | no | 1 | 22229 |
| M2b-Q4 | `run_865db56537ee4dcaa1d3a9107e303455` | 我们组织里哪个团队对结果影响最大、却最容易被忽视？ 请只调用一次工具 synova_context_get。拿到返回 J… | invalid | MISSING_FIELDS | no | 1 | 75468 |
| M2b-Q5 | `run_2ae4ee0b281a4bfd9c54d659ed953c2b` | 就现在能看到的数据，有哪些地方你其实没法确认、需要我们去核？ 请只调用一次工具 synova_context_get。拿… | structured | - | no | 1 | 24507 |

## M1（真实登录复跑，单列，不计入合格率）

| id | runId | auth | 假设事件 | reason.code | 内容回指 | textDeltas | usage.totalTokens |
|---|---|---|---|---|---|---|---|
| M1 | `run_74c1d3453f3945b8894417f0b77c2352` | authenticated | structured | - | yes | 1 | 22191 |

## 隔离库里的真实指代（内容回指的判据来源）

- node ids：`node-b7fd9615-380f-4508-a50c-33eb2df6af1d`、`node-8720cf4c-fa1e-43d0-5c25-d5a30d5b19c6`、`node-105362c0-6a54-45b9-075c-7f2f63947830`、`node-d303ccca-d3da-4817-1a08-0edf5ac7c6f4`
- predicate：`edge/team_executes_activity`
- evidence source_ref：`delivery_dashboard.csv#L4`、`operator-statement.json`、`delivery_batches.csv#L3`、`delivery_dashboard.csv#L2`、`delivery-policy.md#L4`、`delivery_batches.csv#L2-L3`、`delivery_batches.csv#L2`、`delivery_dashboard.csv#L3`
