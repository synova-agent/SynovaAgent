---
状态: proposed
日期: 2026-10-20
决策: 注入夹具加"探针文件不许泄漏"闭环（判据⑧）：cleanup 兜底 reset+clean；进入 #665 探针段前 reset；夹具末尾 reset 后断言 `git -C "$CLONE" status --porcelain` 为空；异常退出由 trap 清 clone。
理由: GitHub annotations 显示夹具克隆里残留探针 brief（`2026-10-20-d1148-decl-probe.md`）⇒ 自造文件泄漏、被后续门禁抓到（CI 红且不可复现）。
---

# 决策 Note — #665d 判据⑧ 探针文件不许泄漏

## 九问（pre-plan-thinking，逐问有证据）

1. **问题**：夹具自造探针文件（`*-decl-probe.md`/`*-excl-probe.md`/`*-side-brief.md`/`m9-fixture-*.sh`）在克隆里残留 ⇒ CI 里被后续门禁抓到（annotation 指到 probe brief）。
2. **现状证据**：CTO 从 annotations 看到 `/tmp/tmp.xxx/repo/.claude/task-briefs/2026-10-20-d1148-decl-probe.md`；本机删掉清理后能复现"克隆残留 10 行"（含 side-brief 与三个探针脚本）。
3. **有没有现成**：`reset_clone`（reset --hard+clean -fdx）与 `trap cleanup` 已存在；缺口是 **#665 探针段前无 reset**、末尾无 status 断言、异常退出未清 clone。
4. **最小改动**：cleanup 加 clone reset；#665 探针段前与末尾各加 reset；末尾加 status 断言（期望产物=无）。
5. **最危险假设**：`git status --porcelain` 会把**预期产物**算成残留 ⇒ 本夹具不声明任何预期残留（声明为空）。
6. **失败路径**：删清理 ⇒ 断言红（10 行）；去 trap＋中途 exit ⇒ clone 残留（1 行，`A src/m9-fixture-g1.ts`）；正常 ⇒ 空。
7. **边界**：只动清理/断言；⑥ env -i、⑦ annotation、所有既有断言零改动。
8. **可观测**：末尾 `✅ 判据⑧: status --porcelain 为空` / `❌ …残留 N 行`；summary 加 `clone_status=clean|DIRTY(n)`。
9. **拆步**：① cleanup 兜底 ② 段前/段末 reset ③ status 断言 ④ 两变异验证 ⑤ 正常回归。

## 决定
- `cleanup()`：clone 存在则 reset --hard + clean -qfdx 再 rm TMP。
- 进 #665 探针段前 `reset_clone`；夹具末尾 `reset_clone` 后断言 status 为空（RESIDUE_FAIL=1 若脏）。
- summary 增 `clone_status`。

## 依据
- 卡 #665d（判据⑧ + 三变异）。本机实测：正常空；删清理 10 行残留；去 trap+中途 exit 1 行残留。
- 说明（诚实）：CI 里那条 `[check-brief-parseable] ❌ brief 不可解析` 的确切文案本机未复现（本机门禁对同一未跟踪探针 brief 不打印该行）；本批以"克隆 status 为空"为本地判据，CI 复现由镜像重跑验证。

## 影响面
- 只动夹具清理逻辑（1 文件）＋豁免/DOC/Note/brief；门禁判据零改动。
