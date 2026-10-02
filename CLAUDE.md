# CLAUDE.md — 已退役（指针件）

> **V5.2.7** | 2026-09-02 | **本文件已退役，内容并入 `AGENTS.md`**

## 一句话

**这是 Claude Code 时代的配置文件。** 2026-10-02 起：
- **全部有效内容已并入 [`AGENTS.md`](./AGENTS.md)** —— 铁律、项目身份、TUI 铁律 40–45、架构完整性 46/47、L0 进化、数据安全四级
- **变更史已移入 [`LOOP-ENGINEERING-CHANGELOG.md`](./LOOP-ENGINEERING-CHANGELOG.md)** —— Loop Engineering 全版本演进（v2.5 → V4.5.1）
- **本文件不再承载任何规则**；**改规则请改 `AGENTS.md`**

## 为什么退役（创始人 2026-10-02 定）

> 「**CLAUDE.md 是 Claude Code 的配置文件，之前遗留的。可以吸取一些历史教训，但 CLAUDE.md 出现在你这里，感觉不合适。**」

**机理**：`@deepseek-ai/dsh-agent-instructions` 的候选清单是 `['AGENTS.md', 'CLAUDE.md']`
（`packages/context/agent-instructions/src/config.ts:12`），**内容不同的兄弟文件各注入一份** ⇒
706 行的 `CLAUDE.md` 与 328 行的 `AGENTS.md` **同时进 system prompt**，
**占满 65,536 字节预算的 89%**，导致域级 `AGENTS.md` 装不进去。

## 兼容说明（两处机器依赖仍靠本文件满足）

| 门禁 | 依赖 | 本文件如何满足 |
|---|---|---|
| `scripts/doc-system/check-doc-truth.sh:39` | 从本文件取首个 `V#.#.#` 与 `AGENTS.md`/`LOOP.md` 对齐 | 头部保留 **V5.2.7** |
| `scripts/check-brief-vs-code.sh:29` | 从本文件取 `流程约束` 行的版本号 | 下方保留该行 |

**流程约束: V5.2.7** — 全文见 `AGENTS.md`（本文件不再重复）

🔴 **后续（归治理线）**：把 `check-doc-truth.sh` 的 C1/C3 与该两处改为**两件对齐**，
并立**版本号单一真源**（`AGENTS.md` 头部 1 处），届时本文件的兼容行可删。
