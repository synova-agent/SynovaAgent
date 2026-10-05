# D1155 — K3 报告指针落库：门禁治理波次（#1075–#1107）（proposed）

- **日期**: 2026-10-05 ｜ **线**: 治理线（govl）｜ **分支**: `docs/D1155-k3-report-pointer`
- **状态**: proposed（PR 开，待复核/合并）

## 决策

1. **指针式落库，不复制正文**
   - 载体：`docs/synova/audit-reports/INDEX.md` **追加一行**（该文件头自述的维护规约）：
     `| 2026-10-05 | 门禁治理波次-D1145-D1149 | CONDITIONAL PASS×3 + PASS×2 | k3-repo@d17d389:audit-reports/2026-10-05-k3-审计报告-门禁治理波次-D1145-D1149.md | 2026-10-05 |`
   - **不在本仓新增报告正文**（避免本仓第二真相源；正文在 K3 独立仓 `~/synova-k3-audit`）。
   - 另加「最近批次溯源」块：K3 仓 commit `d17d389`、报告 123 行、五个审计对象锚点、审计环境（macOS bash 3.2.57，Windows 未实测）、复核命令。
2. **本件天然不触共享登记表**（关键结构事实）
   - `docs/synova/audit-reports/` ① 已被 `DOC-0101` 登记为目录；② 在 D2 登记门禁的 `EXCLUDE` 正则内
     （`scripts/doc-system/doc-registry-gate.sh:46`）⇒ **本 PR 无需改 `DOCS-REGISTRY.yaml`**
     ⇒ **不受"共享登记表零重叠不可达"（本波次跨线冲突）影响**，可独立合并。
3. **不在 K3 独立仓写任何文件**（K3 只读红线）；本件只读该仓取锚点。

## 环境/事实（实测）

- K3 仓报告确切路径 = `audit-reports/2026-10-05-k3-审计报告-门禁治理波次-D1145-D1149.md`（`git ls-files` 实测；**非**旧索引里的
  `docs/synova/audit-reports/…` 镜像形态——独立仓布局与旧镜像不同，故指针写作 `k3-repo@d17d389:audit-reports/…`）。
- `#1077` 已合并：merge commit `afde93eae`（`gh pr view 1077 --json mergeCommit`，且在 `origin/main` 上）。
- 索引陈旧度：入索引的最后一批为 2026-09-25；10-03/10-04 三批（D1132/D1137/全仓五面/W4A）**均未入索引**——
  本件只补本波次一行，不代其它批次补录（避免越权）。

## 验收证据

- `grep -c 'k3-repo@d17d389:audit-reports/2026-10-05' docs/synova/audit-reports/INDEX.md` → 1
- `git -C ~/synova-k3-audit log -1 --format=%h -- 'audit-reports/2026-10-05-*'` → `d17d389`
- `git diff --name-only origin/main...HEAD -- docs/synova/audit-reports/` → 仅 `INDEX.md`
- `bash scripts/doc-system/doc-registry-gate.sh` → rc=0
