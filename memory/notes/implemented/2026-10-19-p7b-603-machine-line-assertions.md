---
状态: implemented
日期: 2026-10-19
决策: 「③ 机器行必须带 attested 级别」（裁 B3-1）从**只钉 needle** 升级为**输出级反例断言** —— 任一 `MERGE-COND` 行出现裸 `③=ok` 即失败；同时删 `MACHINE_TAIL` 的 ③/④ 死代码。
理由: #597 合并后由 fresh 会话独立复核判 FAIL，抓到 ③ 在 `NO:` 分支的**活路径**机器行由 `tok3` 运行时拼接 ⇒ 把 `tok3="ok(attested)"` 改坏成 `tok3="ok"` 时 `--selfcheck` 仍 12/12、W2 仍 12 通过（L1 验收漏判：只测了 `can` 行与 MACHINE_TAIL **死代码**）。且交付自述的「源码 `grep -Ec '③=ok[^(:]'` 兜底」实测不存在（4 文件 0 命中），按源码 grep 也抓不住拼接形态。修法＝把 DS-5 的反例 grep 落成自动化断言（输出级），并补 ① `state==success` 的零覆盖边界 K9。红绿证据：改坏 `tok3` ⇒ 修后 `SELFCHECK-FAIL: B`（修前全绿）；去掉 `state==success` ⇒ K9 红（12 通过 1 失败）。依据：创始人裁 B3-1（声明≠证明）、铁律 35/37、P7 守则 §八之三②（判别力自检）。
---

# #603 交付：③ 机器行输出级断言 ＋ 死代码收口

## 一句话

给 #597 的四条件检查器补上**回归护栏**：③ 的机器行形态（必须 `ok(attested)`）从"靠人读"变成"改坏必红"，并删掉两处永不输出的死代码。

## 现状（改之前）

- `--selfcheck` 12/12、W2 12 通过 —— 但把 `tok3="ok(attested)"` 改坏成 `tok3="ok"` 后**两层测试仍全绿**（`NO:` 分支机器行出现裸 `③=ok`，违反裁 B3-1）。
- `MACHINE_TAIL` 的 ③/④ 赋值是死代码：只有 `die_degraded` 打印它，而 ③ 赋值之后无降级点、`cond4` 全程无 degrade ⇒ 永不输出（铁律 37）。
- 交付自述的「源码 grep 兜底」不存在；且源码是拼接，按源码 grep 也抓不住。

## 决定

1. `run_case`（自检侧）与 `judgment`（W2 侧）各加**输出级**断言：`grep -Eq '③=ok([^(:]|$)'` 命中即该子例失败。
2. E/G 两条判定的 needle 补 `③=ok(attested)`（它们的机器行 ③ 为 ok 态）。
3. 新增边界 **K9**：`state=failure` 且 statuses 全 success ⇒ exit 1（此前该判据零覆盖）。
4. 删 `MACHINE_TAIL` 的 ③/④ 赋值（死代码）。

## 生效时点

合并即生效（PR #604 合入 `local-main` 起）；本 Note 随该 PR 同批落盘。

## 依据（实跑）

- 红绿 1：改坏 `tok3` ⇒ 修前 `SELFCHECK-OK: 12/12` / 修后 `SELFCHECK-FAIL: B`（`机器行出现裸 ③=ok（缺 attested 级别）`）。
- 红绿 2：去掉 `state==success` 判据 ⇒ K9 红（`结果: 12 通过, 1 失败`）。
- 不改判定语义：修后 `--selfcheck` 仍 `12/12`、W2 仍 `12 通过, 0 失败`；`git status --porcelain` 空（只读）。
