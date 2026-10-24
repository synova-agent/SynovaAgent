# 2026-10-24 · #932 PR-2b K3 审计判据升级（C＋D，裁 348 补正）

## 现状（实测，锚 `ct/932-k3b` = `a3c192255` + 本批）

1. **同一件事两个数**：K3 预设「L1 → 15 项清单」；`synova-audit/SKILL.md`「语义审计清单（14 项）」。
2. **判据与标准脱钩**：G1–G6 出生证（标准 v1）已落 main，但审计面零引用。
3. **登记在册 ≠ 可落位**：仓内 `synova-k3-audit/` 只有 `README.md`／`persona-block.yml`／`preset.yml`，
   **无 `package.json`／`cordis.patch.yml`** ⇒ `install-dsh-preset.sh --install` 无法落位；
   运行时副本仍是 2026-09-23 迁移生成的旧 bundle（`:66` 仍「15 项清单」、`:77/:78` 仍旧路径）。
4. **仓内件落后于运行时**：运行时 K3 persona 含一段「团队通用规则（创始人 2026-10-04 批准）」共 23 行，
   仓内 `persona-block.yml` **完全没有** ⇒ 若直接以仓内件覆盖运行时，会**删掉在跑的规则**。

## 决定

- **L1 换轴**：主判据 = **G1–G6 出生证**；**任一轴缺失或证据不足 ⇒ 结论不得 PASS**（P0／FAIL 语义，裁 348-①）；
  P1 仅留"建议修复"。命令与红条件**只引**标准节号，不复制规则。
- **§Q 表进 skill**（裁 348-③）：`synova-audit` 内补 Q-1..Q-15 可查表（与 #918 B 表同源，附一句话摘要）；
  预设只写「深查见 skill §Q 表」，**不点 Q 号**（避免跨件悬空）。
- **L3 补两块**：写入核验四条件 ＋ 复核链位置（子代理 → CTO 抽核 → K3 终审，裁 319/332）。
- **仓内补成真 bundle**（选 A）：`+package.json` ＋ `+cordis.patch.yml`（persona 段由 `persona-block.yml` 生成）；
  同源性由 `tests/control-tower/k3-preset-bundle-sync.test.sh` 机械断言（禁两份正文各写）。
- **回填运行时的团队通用规则块（23 行）**：仓内件此前缺该块，直接覆盖会删活在跑规则 ⇒ 原文回填，出处标注。
- **生效链**（裁 348-④）：`--install` → `--consistency`（期望 CONSISTENT）→ **重启 DSH**；仓内↔安装副本不一致记红。
- **夹具可复跑**（裁 348-⑤）：`tests/control-tower/k3-birthcert-fixture.test.sh`（4 例，含"缺 G3 ⇒ 不得 PASS"）。

## 依据

Issue #932｜裁 334（A 类先提案）｜裁 336（批）｜**裁 348（补正：P1→不得 PASS；Q 不悬空；生效链；夹具可复跑）**。

## 生效时点

本 PR 合入 `local-main` 后，按 §生效链执行 `--install` ＋ 重启 DSH 才真正生效；回滚＝`git revert` ＋ 重装旧 bundle。

## 已知限制

- 回填的「团队通用规则」块含「合完等 GitHub 重算」等旧表述，且与 裁 328（合并由 CTO 点）并存 ⇒ 未改原文，待 CTO 裁是否更新。
- Q 表是**指针＋摘要**，判据真源仍是 #918 B 表；台账改版时需同步本表（失效条件见提案）。
- `check-preset-bundles.sh --consistency` 需在有 `package.json` 的 bundle 源上才有判定；本 PR 补齐后首次可用。
