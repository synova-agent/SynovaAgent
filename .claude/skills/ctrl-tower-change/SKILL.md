---
name: ctrl-tower-change
description: 控制塔脚本变更模式库——改 scripts/control-tower/、scripts/workflow/、scripts/pre-commit-check.sh、git hooks 时使用。门禁脚本是最高风险变更：改错 = 全线误拦/漏拦。历史：D328-D335 台账 P0 级事故一半出在控制塔。
---

# ctrl-tower-change — 控制塔脚本变更模式库

## 使用时机
修改任何门禁/工作流脚本（pre-commit-check.sh、check-*.sh、synova-commit、hooks、scripts/workflow/）。改门禁前先加载本技能 + windows-compat（跨平台是硬要求）。

## 模式 1: 门禁三态退出码（D328，fail-closed 根）
```
exit 0 = 检查通过
exit 1 = 检查发现问题（业务阻断）
exit 2 = 检查本身执行失败/降级（同样阻断, 绝不与通过混同）
```
- 禁止 `|| true` 吞崩溃（D329 P2-5: synova-commit:367 裸 python3 + || true 连崩溃都吞）
- 禁止 `command -v` 只探存在性不探可用性（D328 P1-1: 损坏 shim 静默漏拦）→ 探测后必须试运行或三态区分
- 新 export 的门禁能力必须接线 + 测试（D329 P2-2: resolver --session 零调用方）

## 模式 2: bash + 中文的变量边界（D370 新教训）
bash 在 UTF-8 locale 下把**全角标点当变量名字符**：`$DST）` 解析成变量名 `DST）` → `unbound variable`。
```bash
echo "结果（${VAR}）"   # ✅ 花括号显式边界
echo "结果（$VAR）"     # ❌ set -u 下报 unbound variable
```
排查线索：报错变量名尾部出现乱码字符（`DST�: unbound variable`）= 全角标点紧贴变量。
另：macOS BSD sed 不支持 `\+`（GNU 扩展）→ 用 `sed -E` + `+`。

## 模式 3: 条件跳过保持 <1s（组 10 CP3 同款）
新门禁组只在相关文件入暂存区时运行：
```bash
TOUCHED=$(echo "$STAGED_ALL" | grep -E "<条件模式>" || true)
if [ -n "$TOUCHED" ]; then ...硬检查...; else soft_pass "无相关变更(跳过)"; fi
```
pre-commit 超时 = 用户被迫 --no-verify = 门禁链全线失效（V4.5.1 教训：122s→50s）。

## 模式 4: grep 计数防"0\n0"（V4.5.1 正确性修复）
`grep -c` 无匹配时输出 "0" 且 exit 1，`|| echo 0` 追加成 "0\n0" → `[: integer expected`。
修法：`grep -c ... | tr -d '\n\r' || true`（CRLF 也要剥，Windows）。

## 模式 5: 测试注入与沙箱（现有 .test.sh 惯例）
- 环境变量注入覆盖真实路径（如 `SYNO_SKILLS_SRC`/`--home`），测试零真实目录零网络
- mktemp 沙箱 + trap 清理；断言三态 exit code + 输出点名
- 测试含**生产接线检查**：grep 新脚本名在 pre-commit/synova-commit 中被调用（铁律 0-2 WIRE CHECK）
- 测试命名 *.test.sh 放 tests/control-tower/，头注释写覆盖矩阵（正常/降级/边界）

## 模式 6: 改完的验收链（缺一步 = 自检不完整）
```bash
bash -n scripts/xxx.sh                       # 语法
bash scripts/workflow/check-silent-swallow.sh --utf8   # UTF-8 头块（D313 M5）
bash tests/control-tower/xxx.test.sh         # 专项测试
bash scripts/check-plan-integrity.sh         # brief 排除项
bash scripts/pre-commit-check.sh             # 12 组门禁自过（改门禁者先过门禁）
```

## 红线
- scripts/audit/ 永远禁碰（K3 专属，违反 = 事故）
- 逃生舱（SYNO_SKIP_*）必须写 degraded-events.log（铁律 11），且逃生舱本身要有测试
- 禁止 taskkill //IM node.exe（会杀死所有 Node 进程）
