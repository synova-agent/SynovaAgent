# _extinct/ — 退役哨兵归档（M1b）

- 本目录为**归档**，不参与编译、不参与装载（AGENTS.md §5.1：「卸 = 移 `_extinct/` ＋ 重扫」；CTO 裁 157 选 ②）。
- 归档件**内部相对引用未随移动调整**（从 `extensions/sentinels/<name>/` 移入本目录后少一层 `../`），因此其 `../../../src/...` 形式的 import 在本位置**不可解析**——这是归档态的已知状态，非待修 bug。
- **禁止**从在世代码（含 `src/sentinel/types.ts` 的契约 import 与各哨兵的动态 `import()`）再引用本目录；tsc 会沿 import 边（含动态）把归档件拉回编译域并报错。
- 如需恢复某哨兵：移回 `extensions/sentinels/<name>/`，**人工核对**所有内部相对路径层级（多数需补一层 `../`），并重扫（content-reload）。
