---
状态: implemented
日期: 2026-10-28
任务: "#1075"
决策: P2-1 审批门（v3 契约＋记录侧审批＋出厂锚＋未审批不生效）落地时，对规格 §2.4 写集作 5 项经 L1 逐条裁定的显式扩写（triviality triage 行／probe-knowledge-scope V6(ii) 夹具／plan.json phase 4／WIRING 仅 +1 条纯追加（原 entries[11] 修复已按裁定 B 回滚）／CI ①d 豁免件 gate-exemptions＋DOCS-REGISTRY DOC-0323 登记），并如实记录 2 项「守则不可达」的已批偏差（dev-doc 写集对账对删除项必红；规格 §3-E7 陈旧计数）。
理由: 五项扩写各由一条物理门禁或判据仪器逼出，非实现可选择：① CI ①g 测试义务闸 O2 对新 src 模块（≥100 有效行＋export）要求 triage 行；② P2-1 语义使 probe-knowledge-scope V6(ii)「非仓库形状＋出厂 roleId 改内容」的夹具必然 fail-closed（探针红不是实现跑偏，修后端回基线 PASS=13）；③ pre-commit 组 4a 要求新 export 有跨文件 src 消费者，而 readApprovalRecord 的唯一消费者在同文件（P1 phase 3 先例＝wiring deferred）；④ WIRING 预存损坏（E_YAML／缺 owner）原拟 2 行最小修复，**L1 2026-10-28 裁定 B 回滚**（四条件②：该件须恢复纯追加、删除行=0）⇒ 该预存缺陷留待独立 PR，本批只 +1 条 `content.rolePackApproval`；⑤ CI ①d 门禁本体自检：`scripts/control-tower/**` 属受保护路径，须同 diff 带合规豁免行（新增豁免件首行须 `# review: <PR#>`），且 D2 登记门禁要求该 .md 登记进 `docs/authority/DOCS-REGISTRY.yaml`（DOCS-REGISTRY 与 `gate-exemptions/**` 亦在受保护清单 ⇒ 各需豁免行）。5 项均经 L1 2026-10-28 逐条裁定，并在回执披露。
---
# 2026-10-28 · #1075 P2-1 审批门（写集外 5 项经 L1 裁定）

## 背景（锚 gitea/local-main 6f194d32c）
规格 `.handbook/派单件/2026-10-28-规格-1075-P2-审批门.md`（handbook d0790a3，gate-A 三轮通过）的写集 = 14 条路径。实施中实测到 5 处「写集之外但门禁/仪器必需」的依赖，逐条由 L1 裁定：
| # | 文件 | 逼出它的门禁/仪器 | 裁定 |
|---|---|---|---|
| 1 | tests/contract/triviality-manifest.yaml（+1 行 triage） | CI ①g check-test-obligations.py 规则 O2 | L1 2026-10-28 裁定 A |
| 2 | scripts/control-tower/probe-knowledge-scope.ts（V6(ii) 夹具；断言一字不改） | 探针在 P2-1 语义下必然 fail-closed（before 13 PASS → after 12 PASS+1 FAIL） | L1 裁定 A |
| 3 | .claude/plan.json（phase 4：readApprovalRecord wiring deferred） | pre-commit 组 4a 新 export 须被跨文件引用 | L1 裁定 A（P1 phase 3 先例） |
| 4 | docs/authority/WIRING-REGISTRY.yaml（仅 +1 条 content.rolePackApproval，删除行=0） | 原拟修 entries[11] 预存损坏（E_YAML／缺 owner）→ **L1 裁定 B 回滚**；四条件②要求该件恢复纯追加，预存缺陷留待独立 PR | L1 裁定 B（回滚） |
| 5 | gate-exemptions/2026-10-28-1075-p2-approval-gate.md（＋ docs/authority/DOCS-REGISTRY.yaml 的 DOC-0323 登记） | CI ①d 门禁本体自检：`scripts/control-tower/**` 受保护路径须带同 diff 合规豁免行（新增豁免件首行 `# review: <PR#>`）＋ D2 登记门禁（`gate-exemptions/**` 与 `DOCS-REGISTRY.yaml` 亦受保护 ⇒ 各自豁免行） | L1 2026-10-28 裁定 |

## 已批但「守则不可达」的偏差（如实记录，本批不改守则）
1. scripts/workflow/check-dev-doc-write-set.sh 只做「声明路径必须存在于磁盘」⇒ 规格 §2.4 的删除项（role-pack-v2.schema.json，git mv 后不存）必红；L1 裁定 A：按「已批准显式偏差」推进并写进回执（建议后续由守则 owner 增加删除语义）。
2. 规格 §3-E7 计数陈旧（knowledge-scope 写 25、实测基线 23；tests/presets/role-pack.test.ts 实测 16）；判据按实测基线执行并在回执列偏差。

## 证据指针
- 回执（R2）：J1–J10 命令＋原始输出、独立 python 指纹三行、6 探针三段、写集对账（porcelain 17 行＝18 条路径）。
- L1 裁定原文：本会话 ask_user_question 五问（triviality／probe／WIRING／plan.json／写集偏差）。
- 判据：tests/init/role-pack-approval.test.ts 39｜role-pack-schema 38｜preset-loader 25｜knowledge-scope-wiring 27｜config-pack-generator 26｜onboarding-mount 6。

## 失效条件
- 守则支持删除语义（或规格把删除项移出对账）⇒ 偏差 1 失效。
- probe V6(ii) 改为不依赖审批门的独立合成包 ⇒ 扩写 2 的决策失效。
- P3 审批写入器真正消费 readApprovalRecord ⇒ plan.json phase 4 的 deferred 应改 enforce 并删该 phase。
