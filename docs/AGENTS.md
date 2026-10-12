# AGENTS.md · docs/（文档体系）

> 归属：**治理线** ｜ 承载包：**K1/K3/K5/K10/K12**（与根件 §0 表逐字一致）｜ as_of `38d77034b`（PR2/4）

## 是什么
全仓最高频域（30 天 765 commits / 924 文件）。分层按根件 §6 与 `DOC-CONTRACT.md`：**A 入口重写式｜B 决策六段（`decisions/`）｜C 长期**；过程件一律走 handbook 仓。

## 谁改
- 文档体系/registry＝治理线；`docs/synova/coordination/`（K5 工具与契约草稿）、`docs/synova/presets/`（K12）、`docs/synova/product-lines/evidence/`（K1/K3 证据）、`docs/synova/coordination/提案/`（K1）归对应块作者。
- 新文件须登记 `docs/authority/DOCS-REGISTRY.yaml`。

## 怎么算完成
- A 件：入口可用（命令可复跑）；B 件：六段齐；C 件：`check-doc-truth.sh` 绿。
- 任何"数量"表述给枚举命令，不给手写数（引用纪律 2026-09-26）。

## 红线
版本号单一真源在文件头部｜ 决策必须沉淀（非平凡变更引 `memory/notes/` 四态 Note）｜ 与根件零重复。
