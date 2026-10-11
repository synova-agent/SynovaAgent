---
状态: implemented
日期: 2026-10-11
决策: check-content-coupling 门禁的存量棘轮内置脚本内（CC-BASELINE 段），判据实现用真解析而非 grep，且 entryPoint 维度随 #1465 降为 advisory 只报不判红
理由: |
  ① 棘轮基线放进脚本内（而非独立基线文件）：本卡写集只授权 2 个文件（门禁 + 夹具），
     内置基线不扩写集、不引入第二真相源；刷新只许走 `--print-baseline`，刷新动作进 diff 可审。
     代价（已写进门禁头注释）：棘轮是**逐文件净额**口径 —— 同文件"先修 k 条又加 k' 条"且 k>k'
     时净额下降，新增可能被掩盖。取净额粒度是有意收敛（逐行清单 = 维护爆炸）。
  ② 判据用真解析：源文件注释剥离（保偏移）+ 引号形态无关 + 静态/动态/require 三形态覆盖。
     实证：院方 §3.5 记 CC2 = 27 条，实测 **94 条** —— 27 只是**单引号**形态，
     余 67 条是 `src/sentinel/types.ts:274+` 的**双引号**形态，被单引号 grep 口径整体漏掉。
     同理 CC1 值向记 28，实测 30（差 2 = adapters 里 `await import('.../src/connectors/*')`）。
     ⇒ 门禁类判据若用词法口径，会以"漏报"的形式静静失效。
  ③ entryPoint 维度降为 advisory：§3.5 原判据要求 entryPoint"双口径可解析"，
     但 #1465（ed7613c15）已裁定 entryPoint 降为**纯文档**、真源 = src/deploy/content-registry.ts
     ⇒ 复活该判据 = 重提已裁定的语义。故门禁仍**报告** entryPoint 悬空（locales 死指针 1 处、
     单口径可解析 19 处），但**不判红**，修法归 K12-18（#201）。
  ④ 不进 pre-commit 本地阻断位（规范 §3.5 ＋ 宪章 D515/D516 ＋ v2.5 教训）：
     只做 CI 权威，本地默认只报数。接入点属 CTO 域，方案落在门禁头 §接入方案。
  ⑤ CC3/CC4 与 §d 的关系：#d（check-file-driven.sh 组 d）只查 staged 新增目录，
     与 CC4（全树）**有界重叠**、范围互补；未去重，理由 = 去重会让 CI 失去存量覆盖面。
  实测存量（base 68bf57598）: CC1 113 type + 30 值 / 85 文件；CC2 94 type；CC3 0；CC4 0。
---

# K12-13（issue #196）· 内容面耦合门禁 CC1–CC4 的四个实现裁定

## 触发场景

卡面 #196 要求新建 `check-content-coupling.sh` 实现四条判据，Done 标准 = `bash scripts/check-content-coupling.sh` expectExit 0，
且**反例必须真触发门禁**（创始人 2026-10-11 明令：门禁类不许拿"扫门禁源码"当验收）。

## 决策正文

| # | 裁定 | 反向代价 |
|---|---|---|
| ① | 存量棘轮**内置**在门禁脚本（`CC-BASELINE-BEGIN/END` 段，逐文件 t=/v= 计数），刷新只走 `--print-baseline` | 逐文件净额口径可被"先修后加"掩盖（已写进头注释） |
| ② | 判据 = 真解析（注释剥离保偏移／引号形态无关／静态+动态+require 三形态） | 实现比 grep 重（引入 python3 依赖；缺失 ⇒ exit 2 fail-closed） |
| ③ | entryPoint 维度只报不判红（advisory），CC3 改为"registry 可达性"判据（登记 + status 三态 + loader/reader 在盘） | 门禁不再拦"新写一个死 entryPoint"（改由 advisory 可见 + 后续卡收口） |
| ④ | 不进 pre-commit 本地阻断位；只做 CI 权威（默认模式只报数） | 本地不阻断 ⇒ 违规可能推到 CI 才红（代价：一次往返） |
| ⑤ | 扫描面 fail-closed：源文件不可读 / 扫描根缺失 / registry 缺失 ⇒ exit 2（「读不了 = 没扫」，不许静默当通过） | 环境异常时门禁会红而非放行 —— 有意取向：假绿比误红贵 |

## 模式语义（判据源可复跑）

```
bash scripts/check-content-coupling.sh                      # 本地：报数，exit 0（存量 237 条在棘轮内）
SYNO_CI=1  bash scripts/check-content-coupling.sh           # CI：基线外新增 ⇒ exit 1
CC_STRICT=1 bash scripts/check-content-coupling.sh          # 任意违规（含存量）⇒ exit 1
bash scripts/check-content-coupling.sh --print-baseline     # 打印当前实测基线段（供下调）
bash tests/control-tower/content-coupling.test.sh           # 夹具：真触发 + 不误报 + 降级 + 参数闸 + 改坏即红（断言数以脚本实况为准）
```

## 相关

- 判据源：`docs/synova/extensions内容面规范-v0.1-镜像.md` §3.5
- 前置落地：#1465（`src/deploy/content-registry.ts` 唯一 type→loader 真源 + 4 目录 manifest + 4 项不可达裁决）
- 下游卡：K12-16（#199 四项不可达）｜K12-17（#200 adapters/notifications 归位）｜K12-18（#201 locales 死指针）｜K12-21（#205 测量梯子）
- 接入点（**已于 K12 第5批 / #340 执行**，与预案的差异逐条见门禁头 `§接入方案`）：
  · CI：`.gitea/workflows/local-gates.yml` 新 step「①c 内容面耦合 CC1–CC4」（①b 后、② 前），`|| exit 1`
  · pre-commit：`scripts/pre-commit-check.sh` 末尾附加检查块（结果汇总前），本地 v5_soft / CI 转硬

## 追加（K12 第5批 / #340 · 接入与一处假绿缺陷）

**缺陷（实测复现，已修）**：local 模式末行**硬编码** `CONTENT-COUPLING: OK（新增 0｜…）`——
即使逐条清单已列出 `CC2 NEW …:1 (值)`、逐行汇总也写「新增 1」，末行仍报 0 且 exit 0。
后果：接入点按 rc 判分支 ⇒ **本地一字不印** ⇒ 「存量只告警」的**告警面在本地也不存在**。
修法：local **exit 0 契约不变**，末行如实报 `新增 N`；接入点改按**新增数**判分支（取末行真值，
不可对整段 `grep '新增 [0-9]+' | head -1` —— 那会抓到 CC1 那行的「新增 0」，又一层假绿）。
**回归护栏**：夹具新增「local 模式报告诚实性」断言（改回硬编码 0 ⇒ 夹具必红，已实测）。
