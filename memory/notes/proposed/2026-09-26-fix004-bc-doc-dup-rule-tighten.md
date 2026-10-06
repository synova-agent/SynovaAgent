# 决策 Note — FIX-004 B/C（承 D964）：同类文档唯一性两处修正

- 状态: proposed（**门禁语义变更 ⇒ K3 复审通过前不得合并**）
- 日期: 2026-09-26
- 卡: 台账 FIX-004 B/C（P1）｜承接 D964（`task-state/D964.json` 的 `k3_required` 含本文件）｜分支 `fix/fix004b-doc-dup-rule`（stacked，base = `chore/cto-doc-slim-phase3-dup-rule` @ `8d8b46a3`）
- 决策: **B** 撞名判定加**同目录约束**（同目录必判；跨目录仅非通用名判；README/index/CHANGELOG 等通用名跨目录放行）；**C** 取代声明必须**指向真实存在**的被取代对象（∈ tracked 全集 ∪ 本次新增集合），否则判红并指名。

## 依据（可核）

- K3 定罪（`docs/synova/coordination/K3审计请求-D964-门禁语义变更-20260925.md` §二 B）：① 同目录不同类型的同名文档被误判重复（归一化只取 basename）；② 声明行是纯文本匹配，可被无意义声明绕过。
- 修前实测（同一夹具）：⑦⒜ 新目录 `README.md` → **rc=1 误拦**；⑧⒝ `取代: 不存在` → **rc=0 放行**（`FIX-004-BC-20260926.md` §2）。
- 代码位点：`scripts/doc-system/doc-registry-gate.sh` 嵌入 python `norm()`/撞名判定/声明判定（分支版 `:70-88`、`:113`）。

## 关键设计决定

1. **判据对象 = 「同一目录里的同一份文档」**：跨目录同名是正常结构（每目录一个 README），只有同目录撞名才是真重复。
2. **通用名白名单**（`GENERIC_NAMES`）：README/index/CHANGELOG/license/contributing/authors/makefile/todo/summary/overview —— 仅对**跨目录**生效；非通用名跨目录仍判（防止把真重复放到别目录规避）。
3. **声明必须可解析**：捕获「取代/合并/supersedes」后的目标，去引号/反引号/行内说明后校验 ∈ tracked ∪ 本次新增；不存在 → `VIOLATION ... 取代声明目标不存在`。
4. **实现坑（实测记录）**：该 python 段位于 `$( … <<'PYEOF' … )` **命令替换内的 heredoc** —— 反引号在其中仍被 bash 解析（2 个反引号即 `unexpected EOF looking for matching backtick`）。故实现零反引号（需要时用 `chr(96)`），并加 `bash -n` 冒烟。
5. **不放宽既有判据**：①/④/⑤/⑥ 原断言全部保持通过（13 → 21 断言，净增 8；修前对照 5 条失败）。

## 参考系

第一性原理（唯一性判据的对象是目录内身份，不是仓库级 basename）＋ Anthropic 工程基线（声明式豁免必须可解析 + 变异体改坏即红）＋ 仓内先例（K3 批次 4「空声明绕过」定罪；门禁不许被无声改软）→ 结论：同目录约束 + 目标存在性校验 + 成对反例。

## 夹具（改坏即红，可复跑）

```
bash tests/doc-system/doc-dup-rule.test.sh     # 21 通过 / 0 失败
```
修前对照（同夹具 + `git show <base>:scripts/doc-system/doc-registry-gate.sh` 副本）：**16 通过 / 5 失败**
- ⑦⒜ 跨目录 README 误拦（假红）
- ⑧⒝ 空声明放行（漏拦）+ 未点名

## blast radius

- 调用方：`doc-registry-gate.sh` 为文档登记门禁本体（pre-commit / 本地 `DOC_TRUTH_ROOT=` 沙箱口径），本卡只改「新增文档」判定分支，未动既有登记面（`check_file`）。
- 影响面收窄方向：假红减少（跨目录通用名不再拦）、漏拦减少（空声明不再免罚）⇒ 对既有已合文档零影响（只查新增）。
