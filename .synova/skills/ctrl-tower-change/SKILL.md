---
name: ctrl-tower-change
description: 控制塔脚本变更模式库（含 Windows 模式）——改 scripts/control-tower|workflow|hooks、pre-commit-check.sh、check-*.sh、synova-commit、git hooks，或写 subprocess/PATH/UTF-8 脚本与测试时使用。门禁是最高风险变更：改错 = 全线误拦/漏拦。历史：D328-D335 P0 级事故一半在控制塔；D313-D316 跨平台全程踩坑。
---

# ctrl-tower-change — 控制塔脚本变更模式库（含 Windows 模式）

## 使用时机
改任何门禁／工作流脚本（`pre-commit-check.sh`、`check-*.sh`、`synova-commit`、hooks、`scripts/workflow/`、`scripts/hooks/`），或写涉及 subprocess／PATH／UTF-8 的测试。**A、B 两部分都要过**（跨平台是硬要求）。

## A. 门禁模式（6 条）

### A1 三态退出码（D328，fail-closed 根）
```
exit 0 = 检查通过 ｜ exit 1 = 检查发现问题（业务阻断）｜ exit 2 = 检查本身执行失败/降级（同样阻断，绝不与通过混同）
```
- 禁 `|| true` 吞崩溃（D329 P2-5：`synova-commit:367` 裸 python3 ＋ `|| true` 连崩溃都吞）
- 禁 `command -v` 只探存在性不探可用性（D328 P1-1：损坏 shim 静默漏拦）→ 探测后必须试运行或三态区分
- 新 export 的门禁能力必须接线 ＋ 测试（D329 P2-2：`resolver --session` 零调用方）

### A2 bash ＋ 中文的变量边界（D370）
bash 在 UTF-8 locale 下把**全角标点当变量名字符**：`$DST）` 被解析成变量名 `DST）` → unbound variable。
```bash
echo "结果（${VAR}）"   # ✅ 花括号显式边界
echo "结果（$VAR）"     # ❌ set -u 下 unbound variable
```
排查线索：报错变量名尾部出现乱码（`DST�: unbound variable`）＝全角标点紧贴变量。
另：macOS BSD sed 不支持 `\+`（GNU 扩展）→ 用 `sed -E` ＋ `+`。

### A3 条件跳过保持 <1s（组 10 CP3 同款）
新门禁组只在相关文件入暂存区时运行：
```bash
TOUCHED=$(echo "$STAGED_ALL" | grep -E "<条件模式>" || true)
if [ -n "$TOUCHED" ]; then ...硬检查...; else soft_pass "无相关变更(跳过)"; fi
```
pre-commit 超时 = 用户被迫 `--no-verify` = 门禁链全线失效（V4.5.1：122s→50s）。

### A4 grep 计数防「0\n0」（V4.5.1 正确性修复；Windows CRLF 同源，见 B3）
`grep -c` 无匹配时输出 `0` 且 exit 1，`|| echo 0` 追加成「0\n0」→ `[: integer expected`。
修法：`grep -c … | tr -d '\n\r' || true`（CRLF 也要剥）。

### A5 测试注入与沙箱（既有 `*.test.sh` 惯例）
- 环境变量注入覆盖真实路径（如 `SYNO_SKILLS_SRC`／`--home`），测试**零真实目录零网络**
- `mktemp` 沙箱 ＋ `trap` 清理；断言三态 exit code ＋ 输出点名
- 含**生产接线检查**：grep 新脚本名在 pre-commit／synova-commit 中被调用（铁律 0-2 WIRE CHECK）
- 命名 `*.test.sh` 放 `tests/control-tower/`，头注释写覆盖矩阵（正常／降级／边界）

### A6 改完验收链（缺一步 = 自检不完整）
```bash
bash -n scripts/xxx.sh # bash 语法
python3 -m py_compile scripts/xxx.py # python 语法
bash scripts/workflow/check-silent-swallow.sh --utf8 # UTF-8 头块全量（B3 判据）
bash scripts/workflow/check-silent-swallow.sh --diff # 新增行吞错扫描（B4／组 2）
bash tests/control-tower/xxx.test.sh # 专项测试
bash scripts/check-plan-integrity.sh # brief 排除项
bash scripts/pre-commit-check.sh # 门禁自过（改门禁者先过门禁）
```

## B. Windows 模式（D313-D316）

### B1 subprocess 调 bash 必须自包含环境（D316 核心设计）
只解析 bash 路径**不够**——依赖链（bash ＋ cat/grep ＋ python3）都要显式可达，否则子进程静默失败（更糟：误报成功状态）。
```python
def _find_bash() -> str | None:
    found = shutil.which("bash")                  # Git Bash 会话内可找到
    if found: return found
    for cand in (r"C:\Program Files\Git\bin\bash.exe",
                 r"C:\Program Files\Git\usr\bin\bash.exe"):
        if os.path.exists(cand): return cand
    return None                                   # None ⇒ degraded（fail-open，绝不静默）

def _bash_env(bash: str) -> dict:
    """自包含 subprocess 环境。MSYS bash 的 PATH 分隔符是 ':'（Windows ';' 被当普通字符）。"""
    root = Path(bash).parent.parent
    if root.name == "usr": root = root.parent
    paths = [root / "usr" / "bin", root / "bin", root / "cmd", root / "mingw64" / "bin",
             Path(sys.executable).parent,                  # python3（系统 Python）
             Path.home() / "AppData" / "Local" / "Microsoft" / "WindowsApps"]  # python3 shim
    msys = []
    for p in paths:
        s = p.replace("\\", "/")
        if len(s) > 1 and s[1] == ":": s = "/" + s[0].lower() + s[2:]   # C:/… → /c/…
        msys.append(s)
    env = dict(os.environ)
    env["PATH"] = ":".join(msys + [env.get("PATH", "")])
    return env
# 调用：subprocess.run([bash, script], …, env=_bash_env(bash))；_find_bash() 返回 None ⇒ degraded
```
注意：python docstring／字符串里 `Git\usr\bin` 的 `\u` 是 unicode 转义 → SyntaxError（写 `Git usr/bin` 或 `\\u`）。

### B2 PATH 环境差异（误诊重灾区）
- **注册表 PATH**（`reg query "HKCU\Environment" //v Path`）：git 安装默认只写 `C:\Program Files\Git\cmd`——**无 bash.exe**
- **Git Bash 会话 PATH**：启动时前置 `Git\mingw64\bin` ＋ `Git\usr\bin` → `shutil.which("bash")` 能找到
- 从纯系统环境启动的 python（CI runner／任务计划／VSCode 任务／其他 agent）→ bash 不可找 → `subprocess.run(["bash",…])` 抛 WinError 2
- **测试要确定性**：不依赖运行环境，构造受限 PATH（修复前 → degraded；修复后 `_find_bash` fallback → 正常；**断言这个差异 = red→green 确定性测试**）：
  ```bash
  PYBIN=$(command -v python3)
  env PATH="/c/Windows/system32:/c/Windows" "$PYBIN" tool.py verify …
  ```

### B3 UTF-8 强制（D313 M5）
- **.sh 头块**（每脚本前 3 行；检查器 `check-silent-swallow.sh --utf8` 扫 `scripts/ci`＋`control-tower`＋`workflow`＋`hooks`＋`checks`）：
  ```bash
  # D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
  export PYTHONIOENCODING=utf-8
  export LC_ALL=C.UTF-8 2>/dev/null || true
  ```
- **.py**：`sys.stdout.reconfigure(encoding="utf-8")` 包 `try/except (AttributeError, ValueError)`
- **CRLF 坑**：见 A4（输出两行 → `[: integer expected`）；管道 `| tr -d '\r'`
- 批量加头块后**必须提交**（D315：38 文件改了没提交 = 声称完成实未交付）

### B4 静默吞错门禁（pre-commit 组 2 `silent-swallow --diff`）
新增行含 `2>/dev/null` 时，以下任一可豁免，否则**必须**加 `# swallow-ok: 原因` 注释：

| 模式 | 示例 | 豁免方式 |
|------|------|---------|
| 同行 fallback | `x 2>/dev/null \|\| true` | 自动（`2>/dev/null.*\|\|`） |
| 续行链 | `cmd 2>/dev/null \` 换行 `\| sed … \|\| true` | 自动（扫描器拼接 `\` 续行链查 `\|\|`） |
| 探测型 | `if grep -q … 2>/dev/null; then` ／ `cmd 2>/dev/null \| python3` | 自动 |
| 显式豁免 | `cmd 2>/dev/null  # swallow-ok: 解析失败降级` | 注释（不能加在 `\` 续行后——会断行；`; then` 后安全） |

## 红线
- `scripts/audit/` 永远禁碰（K3 专属，违反 = 事故）
- 逃生舱（`SYNO_SKIP_*`）必须写 `degraded-events.log`（铁律 11），且逃生舱本身要有测试
- 禁 `taskkill //IM node.exe`（会杀死所有 Node 进程）
