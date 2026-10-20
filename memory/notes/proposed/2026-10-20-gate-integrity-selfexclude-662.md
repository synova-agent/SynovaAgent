---
状态: proposed
日期: 2026-10-20
决策: Gate Integrity 对账时排除自身（--exclude-check 可重复；fail_all 先减排除清单）。自身红不再算「未登记 CI 失败」；非自身未登记红仍必红。
理由: 自指死锁——检查器把自己的红算成未登记失败 ⇒ VIOLATION(1) ⇒ 红一次永远红，无法自愈（GitHub #118477514050 实测）。
---

# 决策 Note — #662 Gate Integrity 自指死锁

## 九问（pre-plan-thinking，逐问有证据）

1. **问题**：检查器把自己的红算成「未登记 CI 失败」⇒ 判自己违规 ⇒ 红一次永远红。
2. **现状证据**：GitHub check-run `118477514050` 的 `CI-RED-CHECK: SKIPPED` / `VIOLATION(1)`；本地用 `/tmp/cr.json`（21 条含自身红）复现 exit 1；`/tmp/cr_noself.json`（20 条）⇒ exit 0（CTO 已实测，我复核一致）。
3. **有没有现成**：`--ci-reds`/`--base-ref` 参数与 python 对账块已存在（`check-gate-integrity.sh:813` 调用、`:838` fail_all）⇒ **扩展**，不新建脚本。
4. **最小改动**：`fail_all` 生成后一行过滤 ＋ `--exclude-check` 参数 ＋ ci.yml 传参一行。
5. **最危险假设**：排除按**名字逐字**匹配（不是前缀/模糊）；workflow 的 job `name:` 与传参逐字相等（测试反4 把守）。
6. **失败路径**：排除名不存在 ⇒ 不排除 ⇒ 原红仍现（exit 1）；非自身红 ⇒ 仍红（安全阀）；排除清单为空 ⇒ 行为与旧版一致。
7. **边界**：只影响 CI-reds 对账面；PATTERN-SENTINEL / PATTERN-BASELINE / CI-REGISTRY 三段零改动；三态 0/1/2 不变。
8. **可观测**：`CI-RED-EXCLUDE: 对账时排除 N 个检查…`（info）；base 注解/证据链不变。
9. **拆步**：① fail_all 过滤 ② 参数 ③ ci.yml 传参 ④ 新夹具（六判据＋四反例）⑤ 回归（949 行 73/0＋本地 12 组）。

## 决定
- `--exclude-check <name>`（可重复）/ `--exclude-check=<name>`；并入 `EXCLUDE_CHECKS[]` → 写 `$TMPD/exclude_checks.txt` → python 第 3 参 → `fail_all = [n for n in fail_all if n not in excl]`。
- ci.yml:1255 尾加 `--exclude-check "Gate Integrity (pattern sentinel + injection fixture + ci-reds)"`。
- ❌ 不把 Gate Integrity 塞进 `ci-red-baseline.txt`（掩盖结构缺陷）。

## 依据
- 卡 #662 评论「根因已定位并实测验证」＋「P4 施工单」（CTO 2026-10-20 14:04/14:09）。
- 新夹具 `tests/control-tower/check-gate-integrity-selfexclude.test.sh`：12/0（正＋反1–4＋重复＋改名变异）。
- 回归：既有 949 行夹具 PASS=73 FAIL=0；本地 12 组 exit 0；三段行为实测不变（381/0/905 口径同）。

## 影响面
- 只影响 CI-reds 对账面；自指解除后 GitHub Gate Integrity 可自愈（不等新红出现即可绿）。
