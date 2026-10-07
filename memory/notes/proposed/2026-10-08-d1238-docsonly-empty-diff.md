# docs-only 判定：push 下 base 解析 + 空变更集第三态（D1238 · 卡 #1323）

- 状态: implemented · 编号 **D1238** · 卡 **#1323**（Lead 原写 #1236，已更正留痕）
- 属**门禁语义变更** ⇒ 编入 **K3 批六**；作者不自行合并。

## 一、现象与机理（定位到行）

`ci.yml` 的 `Detect docs-only change (D515)` step：
```bash
elif git diff --name-only origin/main...HEAD | grep -qvE "$DS_RE"; then
```
`push` 到 main ⇒ `HEAD == origin/main` ⇒ 变更集**空** ⇒ `grep -qvE` **无行命中返 1** ⇒ 落 `else`
⇒ `docs_only=true` ⇒ **该 job 早退**（Gate Integrity / Control Tower 等随之 skip）。

**代理证据（本次实测）**：近 5 个 main run 的 `GATE-INTEGRITY-CHECK` 出现次数 = `0, 0, 0, 0, 2`
⇒ **间歇性失明**：取决于 runner 内 `origin/main` 是否已被 fetch 成"推送后"的值
（若为推送前值则 diff 非空 ⇒ 正常全量）。**间歇性 = 更难发现** ⇒ 解释其长期存活的根因。

## 二、两条必须引用的定位事实

1. **`:74` 原注释已写下该行为**：「空变更集（合并提交 diff 为空）⇒ 无行命中 grep -v ⇒ 仍按 docs-only
   （原语义保留）」⇒ 这是「**已知行为 + 其分支后果从未被检验**」，**不是**"漏了个边界"。
2. **不对称是最强论据**：同一段对「判据文件不可读」「origin/main 不可解析」**都**已补 fail-closed，
   唯独「空变更集」没有 ⇒ **修它 = 补齐既有原则**，方向与那两处完全一致（不可判 ⇒ 全量，绝不误跳）。

## 三、修法

```bash
if [ "${GITHUB_EVENT_NAME:-}" = "push" ] && [ -n "${GITHUB_EVENT_BEFORE:-}" ] \
   && [ "$GITHUB_EVENT_BEFORE" != "0000000000000000000000000000000000000000" ]; then
  DS_BASE="$GITHUB_EVENT_BEFORE"
else
  DS_BASE="origin/main"
fi
```
- 保留原 `origin/main` fail-safe（**原文未动**，见 §四）；新增 `$DS_BASE` fail-safe；
- **空变更集 = 显式第三态**：`::warning title=docs-only empty-diff` + `docs_only=false`（铁律 11）。

## 四、结构性发现：不是"一处源"，是 **9 处内联**

派单前提「45 处引用同一判定 ⇒ 改一处源」**不成立**：该判定块在 `ci.yml` 内**内联 9 份**
（9 个 job 各一个同名 step，**逐字节同源**：sha `3836d02b73a7`）。
⇒ 本次**9 份同改**（机械、可校验：替换前断言 `count == 9`）。
⇒ 副作用与规避：`docs/synova/product-lines/evidence/D1023-861-docsonly-guard.sh`（**线 B 写集**）
按字面量 `git rev-parse --verify -q origin/main` 计数**恰 9**（`struct-failsafe-count-9`）。
我第一版把该行改成 `"$DS_BASE"` ⇒ 计数 **0** ⇒ 守卫 **29/1 FAIL**。
**规避 = 保留原行不动 + 新增一行** ⇒ 守卫回到 **30 PASS / 0 FAIL**，且**无需触碰线 B 文件**。
⇒ **去重（9 → 1）属另卡**：它需同时改守卫的计数断言，跨线。

## 五、夹具（零副本：从 ci.yml 提取判定块原文执行）

`tests/control-tower/docsonly-diff-base.test.sh`（**新文件**，避开在飞 #1168 的夹具写集）：
| 用例 | 内容 | 实测 |
|---|---|---|
| 提取 | 本分支块 + `origin/main` 版块（旧语义基准） | ✅ 28 行 / 13 行 |
| **A 先红** | push-to-main 形态（HEAD==origin/main）：旧语义 | ✅ `docs_only=true`（**缺陷复现**） |
| **A 后绿** | 同场景：新语义 | ✅ `docs_only=false` |
| **B 反例** | **真 docs-only** 推送 | ✅ 仍 `true`（早退语义未被改坏） |
| **C 边界** | 全零 SHA（首次 push / force push） | ✅ `false`（显式全量）+ `empty-diff` 告警在位 |
| **D 结构** | push 下 base **不是** origin/main（D1206 同口径，防改回去无人知） | ✅ ×2 |
| **E 回归** | `pull_request` ⇒ 维持 `origin/main` 语义 | ✅ `false` |

**零副本机制**：夹具 `awk` 提取判定块原文执行 ⇒ 判据漂移会直接暴露（提取即失败），
不会出现"夹具与真值各说各话"。**首跑即踩**：我起初用 `git show HEAD:` 取"新版" ⇒ 本地未提交时
HEAD 仍是旧版 ⇒ 静默测到旧语义（4 条断言转红抓住了它）。

## 六、空白窗口登记（Lead 要求）

修好前 main 上这些 job 一直（间歇）跳过 ⇒ **该窗口内合入的提交未经这些检查**。
⇒ **登记**：窗口 = 自该 docs-only 判定引入以来至本卡合并前（代理证据：近 5 个 main run 中 4 个为 0 次）。
⇒ **补验动作**（合并后执行，正向判据）：
```bash
# 该 workflow 已内置手动强制输入（D1039 安全网②），用它做一次 main 全量回扫
gh workflow run ci.yml --ref main -f force_control_tower_tests=true
# 随后核验: main 上 GATE-INTEGRITY-CHECK 出现次数 > 0
```

## 七、变更点 / 旧口径 vs 新口径 / 回滚（K3 批六）

| 项 | 旧 | 新 |
|---|---|---|
| push base | `origin/main`（⇒ 空集 ⇒ 早退） | `github.event.before` |
| 全零 SHA | 未覆盖 | 显式全量 + 告警 |
| base 不可解析 | origin/main 版（保留）+ 新增 `$DS_BASE` 版 | 显式全量 + 告警 |
| **空变更集** | **静默归 docs-only** | **显式第三态：告警 + 全量** |
| PR/merge_group | `origin/<base_ref>` | **不变**（夹具 E） |
| 真 docs-only | 早退 | **仍早退**（夹具 B） |
| 回滚 | — | 9 份块改回 `elif git diff --name-only origin/main...HEAD \| grep -qvE "$DS_RE"` |
