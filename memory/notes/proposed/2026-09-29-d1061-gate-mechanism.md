---
状态: proposed
日期: 2026-09-29
决策: D1061 PR-B 落地三项门禁机制 —— ①**门禁熔断 + 元监控**（`gate-incident-registry.json` 到期棘轮 + `gate-circuit-breaker.sh` 三态 `--should-skip` / `--selfcheck` / `--report` / 冻结格式 `--health-line`，熔断口径 = **连续 2 次同因失败才告警**）；②**推前四件套** `scripts/workflow/pre-push-preview.sh`（`--fast` 默认 ≤10s = brief 三判据 + D708 写集对账 + 夹具真 MARK 三面自测；`--full` 追加 `SYNO_CI=1 pre-commit-check`）并接线 `scripts/pre-push-check.sh` 门禁 8（原门禁 0-7 一条不删）；③建卡器骨架初始化 `write_set: []`（喂 D708 的 S1 声明源）+ `brief_parser.py` **路径形状优先**修「路径尾括号」截断根因。
理由: ① **门禁自身故障会连带拖红所有 PR**，而红不来自 PR 改动 ⇒ 作者只能重试或绕过（绕过 = 门禁归零）。给一条**显式、带 owner/expires/evidence、且过期自动失效**的熔断通道，比"每次都硬红"更安全；② 单次失败不足以判"门禁坏了"——`baseline=FAIL` 实测是间歇（1/5，见 `docs/synova/product-lines/evidence/D1061/00-前提实测-原始输出.md` P5）⇒ 阈值定 2 次同因，既不被噪声触发，也不淹没真故障；③ 「路径尾括号」实测致全 PR 假红（#878：`.claude/task-briefs/…-docs（系统性假红修复）.md` 被截断成 `…-docs` → D708 判夹带），属**卡面 §〇② 四条格式摩擦**之一；④ 推前闸的立论来自存量实测：`brief_parser.py:198` 只认 `- [ ]` checkbox，存量 **9/150 = 6.0%** 判红，全部是**手写件绕过生成器**（生成器 `- [ ] 入口可触达:` 自 2026-06-14 `37abc153` 起从未回退），8/9 同时缺 `#CRITERIA` ⇒ 门禁只在提交/CI 时判红、推前无秒级闸 = 结构性缺口。
---

# 决策 Note — D1061 PR-B 门禁机制线（熔断 / 推前预演 / write_set / 路径尾括号）

> 任务: D1061 ｜ 小队编码 `coder-b` ｜ 分支 `chore/d1061-b-gate-mechanism`
> 规格源：`docs/synova/dispatch/2026-09-29-D1061-CT提速-门禁机制修正.md`
> 状态：proposed（待 K3 复审 + CTO 收件闸后 `git mv` 到 `implemented/`）

## 一、决策参考系（D333 四步）

参考：Anthropic/DeepSeek/第一性原理 + 结论

1. **第一性原理**：门禁的价值 = 拦住真问题 ÷ 误拦。误拦率一旦高到"重跑就过"，作者就会绕过（V3.9 教训：软机制 0% 有效；V4.5.1 教训：pre-commit 122s 超时迫使 `--no-verify`）。故本卡的方向不是"再加一道红"，而是**降低误拦 + 把可本地判定的红前移**。
2. **Anthropic 工程基线**：快反馈回路优先于慢反馈回路（本地秒级 > CI 35 分钟）；降级必须显式且留痕，不得静默通过。
3. **开源实证**：熔断器（circuit breaker）的标准形态是"**到期自动失效**"而非"永久豁免"——本卡直接沿用本仓 `gate-integrity-baseline.txt` 既有的到期棘轮语义，**不造新范式**（同类第二次不许再发明第二套）。
4. **收敛检查**：三项都收敛到同一条纪律 —— **"跳过/降级必须显式、带责任人、带到期、留痕"**，与既有 `degraded-events.log`（铁律 11）和 `gate-integrity-baseline.txt` 同源，无新增范式。

## 二、被否决的替代方案

| 替代 | 否决理由 |
|---|---|
| 永久豁免（白名单，不带 expires） | 棘轮会腐烂：门禁修好后没人删条目 ⇒ 故障被静默放行（本仓 M9 族已完成该收敛） |
| 阈值 = 连续 1 次失败即告警 | `baseline=FAIL` 实测间歇 1/5 ⇒ 噪声告警淹掉真故障（CTO 2026-09-29 裁定阈值 = 2） |
| `--fast` 里直接跑 `precommit-groups-injection.test.sh`（1051s） | 违反 ≤10s 硬指标；秒级判别用同名三面 grep，真跑留给 `--full` 的 ④ |
| 把 `--health-line` 做成多行/带 ANSI 彩色的报告 | D963 工作台面板要可检索的**单行 ASCII 前缀**；彩色码会破坏检索与解析 |

## 三、落地与判据

- **熔断**：`--should-skip` 三态 = `0` 照跑 / `3` 已知故障跳过（跳过必写 `degraded-events.log` + 可见告警）/ `2` 熔断器自身故障（登记表损坏 → fail-closed，**不给熔断通道**）。`expires < 今天` ⇒ 条目失效、**不跳**且 `status=DEGRADED`。
- **健康行（冻结）**：`GATE-HEALTH: status=<OK|DEGRADED|KNOWN-FAULT> known=<n> expired=<n> sources=<n> checked_at=<ISO8601>`
- **推前四件套**：`bash scripts/workflow/pre-push-preview.sh --fast`（实测 1.09s；坏 brief 1.46s 即拦）
- **建卡器**：骨架含 `"write_set": []`，使新卡天然带 S1 声明源（不再默认三源皆空 → fail-closed）。
- **路径形状优先**：`PATH_SHAPE_RE` 命中（明确扩展名结尾 + 无空白路径体，覆盖中文/全角括号）⇒ 整体保留；未命中 ⇒ 回退既有剥括号行为（**钉住语义不回归**，`tests/control-tower/brief-parser-strip.test.sh` 30/0 保持全绿）。

## 四、已知缺口（如实登记，不掩盖）

1. `.github/workflows/ci.yml` 的接线**本 PR 未做**——ci.yml 单写者顺位为 coder-a → coder-b，须待 PR-A 合并后 rebase 再加。
2. 「推前预演」当前只覆盖三种红（brief 格式 / D708 写集 / 夹具三面）；windows 平台差异类红不在 `--fast` 面内（归 PR-A 的 windows 敏感子集）。
3. 熔断登记表当前为**空表**（无已知门禁故障）——这是诚实状态，不是"已修好所有故障"。
