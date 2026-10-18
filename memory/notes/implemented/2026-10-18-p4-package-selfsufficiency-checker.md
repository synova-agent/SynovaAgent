---
状态: implemented
日期: 2026-10-18
决策: 包守则自足性审查由手工矩阵改为机器判（十项逐包 10 格）＋ CT-40 强制配对测试 ＋ 四态 Note，三态退出码 fail-closed。
理由: 十包守则的自足性此前只靠人工逐包核对；真实矩阵随包守则修复即漂移、且无配对测试拦截。机器判十项 ＋ 判别力自检（改坏必红、空仓信号量==0 ⇒ exit 2）让「判错」与「看不见」都当场暴露，符合铁律 35（能变门禁的不靠文档）与控制塔三态退出码口径。
---

# P4 交付 0：包自足性审查脚本（十项机器判 · Issue #566）

## 现状（改之前）

- `agents/P1..P10-*/AGENTS.md` 的十项自足性只靠 CTO 手工矩阵（裁定 185 §B）核对；矩阵随包守则修复而变，无机器复跑、无配对测试。
- 控制塔脚本缺配对测试即无人拦截 ⇒ CT-40（`scripts/control-tower/ct-test-gate.sh`）要求 `scripts/control-tower/<name>.py ↔ tests/control-tower/<name>.test.sh` 强制配对。

## 决定

- 新增只读审查脚本 `scripts/control-tower/check-package-selfsufficiency.py`（W1）：十项判据逐包出 10 格矩阵；三态退出码 `0/1/2`，🟡 与 🔴 同为 exit 1（fail-closed，🟡 不视为通过），信号量==0 ⇒ exit 2。
- 新增配对测试 `tests/control-tower/check-package-selfsufficiency.test.sh`（W2）：系统临时目录沙箱 fixture 断正常/改坏/缺节/信号量==0/坏 ref/`--json`/`--packages` 过滤/只读；真实仓只跑 `--selfcheck`（快照式 exit 1 ＋ `SELFCHECK-OK`），**不硬编码真实矩阵**（dev doc §10）。
- 本 Note 即该非平凡变更的决策沉淀（铁律 49 · commit-msg 门禁要求引用）。

## 依据

- 冻结 dev doc：`docs/plans/codex/implementation/SYNOVA-IMPL-566-p4-package-selfsufficiency-checker-20261018.md`（commit `b3e400201`；blob `3858456fa`；sha256 前 16 位 `60694f266818891e`）§5 契约、§6 边界值、§7 三路径、§11 DS-1…DS-11。
- CTO 裁定 188（Q1–Q4 口径，dev doc §4bis 原样照录）：Q3 逐条无用途只记信息级备注不阻断；Q4 落点 ②③ 引用必须存在、④ 目标父目录在即可。
- handbook《包自足性审查-协议 v2》§六（十项判据以「文本节」承载）。
- 判别力口径：根 `AGENTS.md` §8「判据三态退出码」「判据须有判别力自检（含信号量==0 ⇒ exit 2）」。

## 生效时点

- **随本 PR 合并生效**：CT-40 配对门禁此后对该脚本强制跑本测试（缺配对/测试红 = exit 1 阻断）。
- **失效判据**（dev doc §8）：协议升 v3 且判据编号/语义变更，或包守则改为机器可读结构化格式 ⇒ 删脚本 ＋ 配对测试 ＋（若有）pre-commit 接线，并在包守则 §十一 记一次审查记录；前提变了不得带病续跑。
