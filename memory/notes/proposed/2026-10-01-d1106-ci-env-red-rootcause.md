---
状态: proposed
日期: 2026-10-01
决策: 把「门禁的 CI 独有红」定性为环境依赖问题，出单交治理线，不自己改测试
理由: 测试即判据 ⇒ 改判据者不自判（红线 R-6）。且今天实证：一条环境依赖的红已挡 5 个 PR 重开，属"存量红"不应由碰它的 PR 承担阻断（决策镜头原则 4）。
---

# D1106 · CI 独有红根因定性

## 触发

本日 5 个 PR（#915/#922/#924/#927/#929）因门禁/环境问题反复重开。
其中 `Control Tower Gate Tests` 里的 `check-preset-bundles.test.sh` 呈**本机绿 / CI 红**。

## 实测（两侧并列）

```
本机：bash tests/control-tower/check-preset-bundles.test.sh      → PASS=39 FAIL=0
本机：bash tests/control-tower/simulate-ci.test.sh               → 7 通过 0 失败，exit 0
CI  ：Control Tower Gate Tests (ubuntu-latest)                   → PASS=37 FAIL=3
      ❌ T1 汇总行正确（缺少串: --repo 汇总: 发现 1 个预设, 违规 0 个）
      ❌ T2 --consistency exit 0 (got rc=1, want rc=0)
      ❌ M3b legacy 退役后 exit 0 (got rc=1, want rc=0)
```
两次 run（#927 / #929）**完全一致** ⇒ 稳定复现，非 flaky。

## 三条定性判据

1. 同一测试同断言两侧相反 ⇒ 差异只能来自环境；
2. 触发 PR **零改动该域**（`git diff --name-only origin/main...HEAD` 对 `presets|check-preset-bundles` 零命中）；
3. 该测试自带 mktemp 沙箱 + `SYNO_*` 注入缝，CI 日志**自证隔离有效**（"注入缝全部指向 mktemp 副本"）。

## 决策

- **出单交治理线**（治理卡 G-1），给三方案（补无-profile分支 / CI 补夹具 / 拆 job）+ 改坏即红判据；
- **不自己改测试**：测试＝判据，改判据者不自判（红线 R-6）；
- **不声称任何红已修**：本件治的是"说不清哪里红"，不是"红本身"。

## 依据

- 裁定「存量红不该由本次改动承担阻断」（决策镜头原则 4）
- V3.9 教训的反面：**误拦同样致命** —— 一条总在别处红的门禁 ⇒ 全队绕过 ⇒ 等于没有门禁
