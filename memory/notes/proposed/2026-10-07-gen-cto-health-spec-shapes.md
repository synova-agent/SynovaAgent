# gen-cto-health 配对测试存量红：根因是数据形态漂移 + 测试静默中止

- 状态: proposed（执行中，卡 **#1268** / 编号 D1215）
- 决策人: Lead（2026-10-07 确认修法三件）
- 依据: 实测复现 + 铁律 11（静默降级禁止）+ 铁律 48（测试不可为空壳）+ #1268 Done①

## 问题（第一性原理：失败必须可见）

`tests/control-tower/gen-cto-health.test.sh` 在 `origin/main` 与本地**同为 rc=1**，
在第 2 步「连续运行 → 幂等不写」处中止，**只留 8 行输出、零诊断**。

由于 U7 配对门禁要求 control-tower 脚本必须带**绿的**配对测试，该测试恒红 ⇒
**任何人对 `gen-cto-health.py` 的任何改动都提交不了** —— 不只本批线，全部 agent 被卡。

## 根因（两层，均已 file:line 复现）

1. **被测脚本数据形态漂移**（答 #1268 Done①：**不是环境依赖**）：
   `gen-cto-health.py:305` 写 `spec_path = (d.get("spec") or {}).get("path")`，
   只容纳 `spec` 为 `dict`/`null`。实测 `task-state/*.json` 的 `spec` 三形态分布：
   ```
   str = 171   null = 189   dict = 83
   ```
   命中任一 `str` ⇒ `AttributeError: 'str' object has no attribute 'get'` ⇒ 生成器 rc=1。
   （archive 干净树同样中止 ⇒ 佐证：数据在仓里，非环境。）

2. **测试静默中止**（铁律 11 同型）：
   `gen-cto-health.test.sh:43` 的 `OUT1=$(python3 "$GEN" 2>&1)` 在 `set -euo pipefail` 下
   遇 rc≠0 **立即中止整个脚本**，traceback 被 `2>&1` 收进变量、**永不打印**
   ⇒ 故障被伪装成「门禁在正常工作」。**失败无声比失败本身更贵。**

## 决策

1. **容纳三形态，不迁移历史数据**：只有 `dict` 提供 json path；`str`/`null` 一律「无 json path」，
   回落到既有 glob 派生（`has_spec`）。
2. **不削弱既有守卫**：`D399/D412` 的「json spec.path 必须**工作区存在** ∧ **已提交 HEAD**」
   双守卫原样保留；本卡只放宽「把不是 dict 的 spec 当 dict 取属性」这一步。
3. **测试禁静默**：全部生成器调用改走 `run_gen()`（显式收 rc + 失败即 `dump_tail` 打印原始输出）。
4. **不给配对门禁加豁免、不动任何判据** —— 加豁免会打开「存量红可绕过配对门禁」的口子，
   正是 v2.0 要消灭的形态。
5. **夹具覆盖三形态**（铁律 48）：沙箱镜像仓内相对结构 + 真 git 仓（生成器依赖 git 取
   `head_files`，无 git 则 fail-closed exit 2 —— 那是「环境不完整」，不是本卡要测的形态）。

## 改前 / 改后对照（实测）

```
改前（旧码）: bash tests/control-tower/gen-cto-health.test.sh
              → 8 行输出即中止，rc=1，**零诊断**（traceback 被吞）
改后（本卡）: bash tests/control-tower/gen-cto-health.test.sh
              → 结果: PASS=14 FAIL=0，rc=0
判别性（改坏即红）: 把 :305 还原为旧码 ⇒ 测试 rc=1 且**显式点名**
              ❌ 三形态共存仍崩 (rc=1)  + 打印 AttributeError traceback
              ⇒ 证明夹具承重，且静默中止已被消除
```

## 同族第二缺陷（Lead 裁决②：本卡内修）

`gen-cto-health.py` **4 处**用三位正则 `D(\d{3})`（`:254` commit 主体 / `:276`·`:284` 工件文件名 / `:298` task_id）：
4 位 D# 被截成 3 位；且 `:254` 的 `\(D(\d{3})\)` 要求数字后紧跟 `)` ⇒ commit 主体 `feat(D1215):` 里
**完全匹配不上** ⇒ 该任务的 impl 提交被**静默漏掉** ⇒ 仪表盘**少报交付状态**。

实测对照（同一沙箱，唯一变量 = 正则）：
```
旧 \d{3}  : | D1215 | claimed   | — | — | — |
新 \d{3,} : | D1215 | impl_done | — | ✅ | — |
```
改法 = 4 处统一 `D(\d{3,})`（Lead 给的「更稳」选项，兼容未来 5 位）。
**语义已验证为严格增补**：对 `D393` / `(D393)` / `D383-impl` 等 3 位输入，新旧正则逐例**同值**；
只有 ≥4 位输入才改变 ⇒ 不改变非 4 位行为（Lead 的停止条件未触发）。
夹具 §7 锚定之；**变异体**（还原三位）⇒ §7 两条断言转红、rc=1（已实证）。

## 已知未改（明确留痕）

- 未迁移历史台账数据、未改其余正则（`数据源指纹: ([0-9a-f]{12})` 等）。
- 测试**设计上会改写** `docs/synova/CTO-HEALTH.md`（其头注释即「直接对真实产物测试」）。

## 相关

- 卡 **#1268**（本卡）· 触发方：线 A 在 #1267（E4 消费者迁移）上报
- 修好后需通知**线 A** 补 E4 第 6 条消费者（`gen-cto-health.py` 的迁移期显式降级）
