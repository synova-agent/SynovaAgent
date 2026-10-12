---
状态: proposed
日期: 2026-10-11
决策: 探针批以「自声明判据依赖 + 自声明目标件 + 全部可独立跑红」为交付判据载体；ladder 只表达测量件健康度，个别探针 FAIL 不拉低其退出码，改以末行词元 + 计数显式披露
理由: K12-21 的判据件必须能回答「加了吗/接上了吗/生效了吗」。实测三条防线缺口（自洽假绿漏网 5/12、退出码与判定同码不可分、探针同进程互相污染致 ladder SIGABRT）若不沉淀成机制，同类漂移下次仍无门禁可察（铁律 35：能自动化不靠 review）。
---

# K12-21 交付测量梯子：12 探针 + ladder + 契约自测（卡 #205 · 登记件 K12-21）

- 性质：**横切测量件**（不在产品架构任一块内；不改产品代码）⇒ 本文为决策沉淀，走 `proposed/`。
- 定位：CTO 派单 批1·测量梯子 + 登记件 `docs/synova/coordination/施工项登记.ts` 的 `K12-21`。
- 交付判据（机器可判唯一权威）：
  `npx tsx scripts/control-tower/probe-ladder.ts --all` ⇒ **exit 0**
  ＋ `bash tests/control-tower/probe-contract.test.sh` ⇒ **exit 0**。

## 一、三条实测缺口与对应机制（本批存在的全部理由）

| # | 缺口（实测） | 机制 |
|---|---|---|
| ① | **自洽假绿**：把"目标不存在却 `RESULT=PASS`+exit 0"的探针换到 5 件上，整套契约自测**仍全绿** | 探针 `export const TARGETS`（自声明判据依赖）＋ ladder 不变式 **报 PASS ⇒ TARGETS 非空 ∧ 全部存在** |
| ② | **词元级假绿**：末行 `RESULT=PASS … fail=2` 同行自相矛盾，只 grep `PASS` 的消费者被骗 | 末行词元三态 **PASS / DEGRADED / ERROR**（退出码不变，仍守 `expectExit:0`） |
| ③ | **进程互相污染**：探针真起 HTTP 服务后，同进程再 import 下一个探针 ⇒ Node `RemoveEnvironmentCleanupHook assert (env) != nullptr` ⇒ ladder **SIGABRT(134)** | ladder 一律**子进程真跑**（仍是 L2，非静态检查；代价 = 每探针一次 tsx 启动） |

## 二、退出码语义（🔴 本批的判据澄清，供 K3/CTO 复核）

- **探针**三态：`0`=PASS ｜ `1`=FAIL（目标件在但断言不成立）｜ `2`=未实现 或 自身无法判定。
- **ladder** 语义 = **测量件自身是否健康**，**不是** K12 交付是否完成：
  `0` = 13 探针全执行完且判定都在契约域内；`1` = 测量件自身有问题；`2` = ladder 自身异常。
  **个别探针 FAIL（产品代码真红）不拉低它** —— 否则在 21 张卡做完前 ladder 恒非 0，
  登记件 `expectExit:0` 永远无法满足 ⇒ 本卡无法收口（判例 P-03 断言不变性）。
  真实判据落在**各探针自己的退出码**上（逐卡、可独立复跑）。

## 三、如实披露的边界（不算通过，供复核对账）

1. **假绿防护的强度 = 探针自声明的诚实度**：若有人把 `TARGETS` 换成"现存但不相关"的路径，
   不变式仍会被绕过。已实测取证（第一版修复即被此形态绕过）⇒ **残余盲区，未封死**。
2. **既有件 `probe-content-registry.ts` 豁免 TARGETS 不变式**：卡面 §Q2 明写「已存在，不建」⇒
   无权给它补声明；不豁免则 `--all` 恒非 0。**代价 = 放弃对它的假绿防护**（其自身四段断言仍是防线）。
3. **10/12 探针的 L2 断言在现态从未执行**（目标件缺失 ⇒ 走存在性闸 exit 2）⇒
   只能证"12 件可执行 + 三态契约正确"，**不能**证这 10 件的 L2 判据本身跑通。
4. **`scripts/**` 无类型门**：`tsconfig.json` 的 `include` 只有 `src/**` ⇒ `npx tsc --noEmit`
   对 `scripts/**` **完全无覆盖**；本批一律以**定向 strict tsc**（`--noUnusedLocals --unusedParameters`）取证。
   实测该命令抓出 2 处真死代码（`ProbeOutput.label` 未用、选手 B 的 `readText` 未用）。
5. **本件不被任何门禁自动执行**：`ct-test-gate.sh` 只配对 `scripts/**/<name>.{sh,py}` ↔
   `tests/control-tower/<name>.test.sh`；本件测的是 `.ts` ⇒ 可手动复跑的验收件，**非 CI 自动门禁**。

## 四、判据载体（逐条可复跑）

```
npx tsx scripts/control-tower/probe-ladder.ts --all         # 13 行清单 + 末行 RESULT= 披露
npx tsx scripts/control-tower/probe-ladder.ts --targets <名> # 该探针自声明的 TARGETS（单一解析实现）
npx tsx scripts/control-tower/probe-<名>.ts --all            # 逐探针独立跑红
bash tests/control-tower/probe-contract.test.sh              # T1–T8 契约自测 + 端到端元层反证
```

## 五、关联

- 卡面：`.claude/task-briefs/2026-10-11-205-K12-21-测量梯子-12-个探针-全员前置.md`
- 交付 brief：`.claude/task-briefs/2026-10-11-205-probe-ladder.md`
- 反证夹具：`.claude/fixtures/probe-always-green.ts`（故意做坏的假绿件，供 V-07 证伪）
- 判例依据：V-01（L1≠L2）/ V-02（grep 不作验收）/ V-07（假绿证伪）/ V-09（未核须列出）/ M-02（三态）/ M-04（单一事实源）
