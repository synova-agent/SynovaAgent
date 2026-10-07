---
name: windows-compat
description: 控制塔 Windows 跨平台模式库——subprocess 调 bash 的自包含环境、PATH 差异、UTF-8 强制、静默吞错门禁。改 scripts/ 下脚本或写测试时使用。历史：D313-D316 全程踩坑。
---

# windows-compat — Windows 跨平台模式库

> ✅ **《DSH 权威手册 v1（2026-09-17）》复核结论：本技能全文仍成立，无节被取代**（`docs/synova/research/DSH权威手册-v1-20260917.md`，见其 §6.6）。
> 复核范围：模式 1（subprocess 调 bash 的自包含环境 `_find_bash`/`_bash_env`）、模式 2（PATH 差异与受限 PATH 确定性测试）、模式 3（UTF-8 强制头块 + `.py` reconfigure + CRLF 的 "0\n0"）、模式 4（静默吞错门禁与 swallow-ok 豁免表）、以及文末 4 条验证命令——**均未见漂移**。
> 与手册的交叉点：本技能模式 3 的 UTF-8 头块检查器 `check-silent-swallow.sh --utf8` 与 pre-commit 组 2 的 `--diff` 模式，在手册 §3.4「门禁链」中列为现行有效门禁。
> **本技能模式的普适价值**（手册 §4.2 已收录为「探针陷阱」的同类问题）：文档里的路径/字符串在复制时容易丢失不可见字符或转义——复核任何锚点时**先确认字面量精确形态**（手册附录 A 记录了一次真实假失效：`route on this, never by parsing \`message\`` **不带反引号 grep 会零命中**）。

## 使用时机
修改 scripts/control-tower/、scripts/workflow/、scripts/hooks/ 下的 bash/python 脚本，或写涉及 subprocess/UTF-8 的测试时。

## 模式 1: subprocess 调 bash 必须自包含环境（D316 核心设计）

只解析 bash 路径**不够**——hook/脚本的依赖链（bash + cat/grep + python3）都要显式可达，否则子进程静默失败（更糟：误报成功状态）：

```python
def _find_bash() -> str | None:
    found = shutil.which("bash")
    if found:
        return found
    for cand in (r"C:\Program Files\Git\bin\bash.exe",
                 r"C:\Program Files\Git\usr\bin\bash.exe"):
        if os.path.exists(cand):
            return cand
    return None

def _bash_env(bash: str) -> dict:
    """自包含 subprocess 环境。MSYS bash 的 PATH 分隔符是 ':'（Windows ';' 被当普通字符）。"""
    root = Path(bash).parent.parent
    if root.name == "usr":
        root = root.parent
    paths = [str(root / "usr" / "bin"), str(root / "bin"), str(root / "cmd"),
             str(root / "mingw64" / "bin"),
             str(Path(sys.executable).parent),          # python3（系统 Python）
             str(Path.home() / "AppData" / "Local" / "Microsoft" / "WindowsApps")]  # python3 shim
    msys = []
    for p in paths:
        s = p.replace("\\", "/")
        if len(s) > 1 and s[1] == ":":
            s = "/" + s[0].lower() + s[2:]              # C:/... → /c/...
        msys.append(s)
    env = dict(os.environ)
    env["PATH"] = ":".join(msys + [env.get("PATH", "")])
    return env

# 调用: bash = _find_bash(); bash is None → return degraded（fail-open，绝不静默）
# subprocess.run([bash, script], ..., env=_bash_env(bash))
```

注意：python docstring/字符串里 `Git\usr\bin` 的 `\u` 是 unicode 转义 → SyntaxError（写 `Git usr/bin` 或 `\\u`）。

## 模式 2: PATH 环境差异（误诊重灾区）

- **注册表 PATH**（`reg query "HKCU\Environment" //v Path`）：git 安装默认只写 `C:\Program Files\Git\cmd`——**无 bash.exe**
- **Git Bash 会话 PATH**：启动时前置 `Git\mingw64\bin` + `Git\usr\bin` → `shutil.which("bash")` 能找到
- 从纯系统环境启动的 python（CI runner / 任务计划 / VSCode 任务 / 其他 agent）→ bash 不可找 → `subprocess.run(["bash",...])` 抛 WinError 2
- **测试要确定性**：不依赖运行环境。构造受限 PATH：
  ```bash
  PYBIN=$(command -v python3)
  env PATH="/c/Windows/system32:/c/Windows" "$PYBIN" tool.py verify ...
  ```
  修复前 → degraded；修复后（_find_bash fallback）→ 正常。断言这个差异 = red→green 确定性测试

## 模式 3: UTF-8 强制（D313 M5）

- **.sh 头块**（每脚本前 3 行，检查器 `check-silent-swallow.sh --utf8` 扫 scripts/ci+control-tower+workflow+hooks+checks）：
  ```bash
  # D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
  export PYTHONIOENCODING=utf-8
  export LC_ALL=C.UTF-8 2>/dev/null || true
  ```
- **.py**：`sys.stdout.reconfigure(encoding="utf-8")` 包 try/except (AttributeError, ValueError)
- **CRLF 坑**：`grep -c` 无匹配输出 "0" 且 exit 1，`|| echo 0` 追加成 "0\n0" → 变量变两行 → `[: integer expected`。修法：管道 `| tr -d '\r'` 或 `grep -c ... || true` 后 `tr -d '\n'`
- 批量加头块后**必须提交**（D315: 38 文件改了没提交 = 声称完成实未交付）

## 模式 4: 静默吞错门禁（pre-commit 组 2 silent-swallow --diff）

新增行含 `2>/dev/null` 时，以下任一可豁免，否则**必须**加 `# swallow-ok: 原因` 注释：

| 模式 | 示例 | 豁免方式 |
|------|------|---------|
| 同行 fallback | `x 2>/dev/null \|\| true` | 自动（`2>/dev/null.*\|\|`） |
| 续行链 | `cmd 2>/dev/null \` 换行 `\| sed ... \|\| true` | 自动（扫描器拼接 `\` 续行链查 `\|\|`） |
| 探测型 | `if grep -q ... 2>/dev/null; then` / `cmd 2>/dev/null \| python3` | 自动 |
| 显式豁免 | `cmd 2>/dev/null  # swallow-ok: 解析失败降级` | 注释（不能加在 `\` 续行后——会断行；`; then` 后安全） |

## 验证命令
```bash
bash -n scripts/xxx.sh                                  # bash 语法
python3 -m py_compile scripts/xxx.py                    # python 语法
bash scripts/workflow/check-silent-swallow.sh --utf8    # UTF-8 头块全量
bash scripts/workflow/check-silent-swallow.sh --diff    # 新增行吞错扫描（pre-commit 组 2）
```
