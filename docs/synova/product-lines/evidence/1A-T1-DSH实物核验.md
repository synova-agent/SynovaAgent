# 1A-T1 DSH 实物核验（只读取证）

> **本文件 = T1 只读取证；没有执行安装、未停止任何进程、未读凭据、未外发。**
>
> - 取证时间：2026-11-15T10:02:52+08:00（China Standard Time）
> - 取证工作树：`D:\novis-backup-20260526\Novis\.synova-wt-1395-1a`（分支 `feat/1395-1a-dsh-sidecar`，HEAD `8abdaa7cf9e11ef27f49682e77e86c0d12ffed12`）
> - 出证 shell：`C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe`（Windows PowerShell 5.1；本次命令由 DSH 的 `dsh-subprocess-local` runner 以只读 PowerShell 启动，见 §1 进程 39796/40096）
> - 写入边界：本会话**只写入本文件**；未执行 `git add/commit/checkout/fetch`，未修改 git 状态；仅按任务允许把 app.asar 内容抽取到 `%TEMP%\synova-1a-t1-asar-20261114`（不进入仓库）。
> - 出证纪律：结论只来自命令原始输出；无法证明的项标 `NOT_AVAILABLE` / `SOURCE_NOT_AVAILABLE` / `COMMIT_UNVERIFIED`，不猜测、不用旧版本冒充。

## 结论速览

| 项 | 实测结论 | 证据节 |
|---|---|---|
| 运行中的 DSH 宿主 | Electron 主进程 PID 23856；DSH node 宿主 PID 21240；监听 `127.0.0.1:61019` | §1 |
| 运行宿主安装目录 | `C:\Users\Administrator\AppData\Local\Programs\DeepSeek Harness` | §1 |
| 已安装 DSH（AppData） | **0.2.2-rc.1**（不是 rc.2） | §2 |
| PATH 全局 dsh | **0.2.1-alpha.2**，来自 `D:\Program Files\npm-global`，是另一套安装 | §3 |
| rc.2 安装包 | **不存在/NOT_AVAILABLE**（指定路径、updater 缓存、TEMP、Downloads、D: 深度 3 搜索均无） | §4 |
| Node | PATH node `v24.16.0`（仓库/测试用）；DSH 内置 node `v24.21.0` | §5 |
| 仓外源码断面 `D:\dsh-ref` | **0.2.1-rc.2** 源码断面（不是 0.2.2-rc.2） | §6 |
| 已安装 app.asar 内 ACP | `@deepseek-ai/dsh-acp@0.2.2-rc.1` 存在；`agentInfo.name="deepseek-harness-acp"`；`protocolVersion=1`；会话方法字符串见 §7 | §7 |
| ACP stdio 帧格式来源 | SDK 1.4.0 `ndJsonStream`：`JSON.stringify(message) + "\n"`（NDJSON）；标「源码断面/同族 SDK 证据」，不是 rc.2 安装包内实物 | §8 |

---

## 1. 本机运行中的 DSH 宿主

### 1.1 进程（只读）

命令原文：

```powershell
$p = Get-CimInstance Win32_Process | Where-Object { $_.Name -match '(?i)dsh|deepseek|harness' -or $_.CommandLine -match '(?i)dsh|deepseek' }
"COUNT=$($p.Count)"
$p | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | Format-List
"PS_OK=$?"
```

原始输出摘要（`COUNT=9`）：

```text
ProcessId 23856  ParentProcessId 10776  Name "DeepSeek Harness.exe"
ExecutablePath : C:\Users\Administrator\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe
CommandLine    : "C:\Users\Administrator\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe"

ProcessId 21240  ParentProcessId 23856  Name "DeepSeek Harness.exe"
ExecutablePath : C:\Users\Administrator\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe
CommandLine    : "...\DeepSeek Harness.exe" --expose-internals "...\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\index.js" "...\resources\app.asar\dsh" C:\Users\Administrator\.dsh\profiles\desktop "...\resources\runtime\primary-runtime" "...\primary-runtime\dependencies\pnpm\bin\pnpm.mjs" "...\resources\runtime\bin"
```

同一命令命中的其余进程（摘要）：

```text
7268  nssm.exe                    D:\deepseek-harness\tools\nssm-2.24\win64\nssm.exe
23672 ChatGPT.exe                C:\Program Files\WindowsApps\OpenAI.Codex_26.1106.6628.0_x64__2p2nqsd0c76g0\app\ChatGPT.exe（Codex 应用，非 DSH 宿主）
25496 DeepSeek Harness.exe       --type=gpu-process（23856 子进程）
20504 DeepSeek Harness.exe       --type=utility --utility-sub-type=network.mojom.NetworkService（23856 子进程）
21500 DeepSeek Harness.exe       --type=renderer --app-path="...\resources\app.asar"（23856 子进程）
39796 DeepSeek Harness.exe       app.asar\dsh\node_modules\@deepseek-ai\dsh-subprocess-local\lib\runner.js（本次取证命令的 runner）
40096 powershell.exe             本次取证命令进程（39796 子进程）
```

`PS_OK=True`；该 PowerShell 命令外壳 exit code = 0（工具未报非零）。

**宿主判定**：PID 23856 是 Electron 主进程；PID 21240 是实际 DSH node 宿主（`--expose-internals` 加载 `app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\index.js`）。二者可执行文件与安装目录一致。

### 1.2 监听端口（只读）

命令原文：

```powershell
$pids = 23856,21240,39796,25496,20504,21500,7268
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $pids -contains $_.OwningProcess } | Select-Object LocalAddress,LocalPort,OwningProcess | Sort-Object LocalPort | Format-Table -AutoSize
"NET_EXIT=$?"
"---PORT_61019---"
Get-NetTCPConnection -LocalPort 61019 -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,State,OwningProcess | Format-Table -AutoSize
"PORT_OK=$?"
```

原始输出：

```text
LocalAddress LocalPort OwningProcess
------------ --------- -------------
127.0.0.1        61019         21240

NET_EXIT=True
---PORT_61019---
LocalAddress LocalPort       State OwningProcess
------------ ---------       ----- -------------
127.0.0.1        61019 Established         21240
127.0.0.1        61019 Established         21240
127.0.0.1        61019 Established         21240
127.0.0.1        61019      Listen         21240
```

`NET_EXIT=True`、`PORT_OK=True`；命令外壳 exit code = 0。

**结论**：DSH 宿主仅监听 `127.0.0.1:61019`（OwningProcess = 21240），与运行时上下文给出的 Web GUI URL `http://127.0.0.1:61019` 一致；该端口仅绑回环地址，未绑 `0.0.0.0`。

### 1.3 安装目录与相关服务边界

命令原文：

```powershell
$root='C:\Users\Administrator\AppData\Local\Programs\DeepSeek Harness'
"ROOT_EXISTS=$(Test-Path -LiteralPath $root -PathType Container)"
Get-Item -LiteralPath "$root\DeepSeek Harness.exe" | Select-Object FullName,Length,LastWriteTime | Format-List
(Get-Item -LiteralPath "$root\DeepSeek Harness.exe").VersionInfo | Select-Object FileVersion,ProductVersion,FileDescription | Format-List
"EXE_OK=$?"
Get-CimInstance Win32_Service | Where-Object { $_.PathName -match 'nssm|deepseek-harness' } | Select-Object Name,DisplayName,State,StartMode,PathName | Format-List
"SVC_OK=$?"
```

原始输出摘要：

```text
ROOT_EXISTS=True
FullName      : C:\Users\Administrator\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe
Length        : 246343656
LastWriteTime : 2026/11/4 17:30:40
FileVersion     : 0.2.2-rc.1
ProductVersion  : 0.2.2.0
FileDescription : DeepSeek Harness
EXE_OK=True

Name        : DeepSeekHarness
DisplayName : DeepSeekHarness
State       : Paused
StartMode   : Auto
PathName    : D:\deepseek-harness\tools\nssm-2.24\win64\nssm.exe
SVC_OK=True
```

命令外壳 exit code = 0（`$? = True`）。

**边界说明**：运行中的 GUI 宿主安装目录为 `C:\Users\Administrator\AppData\Local\Programs\DeepSeek Harness`，其 exe 文件版本也是 `0.2.2-rc.1`。另有 nssm 服务 `DeepSeekHarness`（State=Paused，PathName=`D:\deepseek-harness\tools\nssm-2.24\win64\nssm.exe`）；本次**未启动/停止/查询其内部命令，也未操作该服务**，只记录其存在，且它不是监听 61019 的宿主（61019 的 OwningProcess 是 23856 子进程 21240）。

---

## 2. 已安装 DSH：`C:\Users\Administrator\AppData\Local\Programs\DeepSeek Harness`

### 2.1 CLI 版本

命令原文：

```powershell
$root='C:\Users\Administrator\AppData\Local\Programs\DeepSeek Harness'
$dsh="$root\resources\runtime\cli\bin\dsh.cmd"
"CMD=$dsh"
"CMD_EXISTS=$(Test-Path -LiteralPath $dsh -PathType Leaf)"
& $dsh --version 2>&1 | ForEach-Object { $_.ToString() }
"DSH_VERSION_EXIT=$LASTEXITCODE"
```

原始输出：

```text
CMD=C:\Users\Administrator\AppData\Local\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd
CMD_EXISTS=True
0.2.2-rc.1
DSH_VERSION_EXIT=0
```

**结论**：已安装 DSH = **`0.2.2-rc.1`**（exit code 0），**不是 rc.2**。§1.3 的 exe `FileVersion` 同为 `0.2.2-rc.1`，互相印证。

### 2.2 `runtime.json` 全文

命令原文：

```powershell
Get-Content -LiteralPath "$root\resources\runtime\primary-runtime\runtime.json" -Raw
"RUNTIME_JSON_EXIT=$?"
```

原始输出（全文）：

```json
{
  "desktopVersion": "0.2.2-rc.1",
  "platform": "win32",
  "arch": "x64",
  "payloadDigest": "0881fbf610a9a8ef344a9e650f3a4c1b7724260a74eeaefaa9ec31355907374f",
  "python": "3.12.14",
  "node": "24.21.0",
  "pnpm": "11.28.5",
  "pythonPackages": {
    "numpy": "2.3.5",
    "pandas": "3.0.1",
    "python-dateutil": "2.9.0.post0",
    "six": "1.17.0",
    "tzdata": "2025.2",
    "python-docx": "1.2.0",
    "python-pptx": "1.0.2",
    "openpyxl": "3.1.5",
    "Pillow": "12.3.0",
    "lxml": "6.1.3",
    "XlsxWriter": "3.2.9",
    "typing_extensions": "4.16.0",
    "et_xmlfile": "2.0.0"
  }
}
```

`RUNTIME_JSON_EXIT=True`（`$?`，Get-Content 成功）；命令外壳 exit code = 0。

**要点**：`desktopVersion = 0.2.2-rc.1`；`node = 24.21.0`；`pnpm = 11.28.5`；`python = 3.12.14`；`payloadDigest = 0881fbf610a9a8ef344a9e650f3a4c1b7724260a74eeaefaa9ec31355907374f`（该字段是 runtime payload 摘要，不是 rc.2 安装包 SHA512）。

### 2.3 `app-update.yml`（channel）

命令原文：

```powershell
Get-Content -LiteralPath "$root\resources\app-update.yml" -Raw
"APP_UPDATE_EXIT=$?"
```

原始输出（全文）：

```yaml
provider: generic
url: https://download.deepseek.com/dsh-desk/feeds/win-x64/
channel: nightly
updaterCacheDirName: '@deepseek-aidsh-desktop-updater'
publisherName:
  - CN=Hangzhou\20DeepSeek\20Artificial\20Intelligence\20Co.\2c\20Ltd.,O=Hangzhou\20DeepSeek\20Artificial\20Intelligence\20Co.\2c\20Ltd.,C=CN
```

`APP_UPDATE_EXIT=True`；命令外壳 exit code = 0。

**结论**：channel = **`nightly`**；更新源为 `https://download.deepseek.com/dsh-desk/feeds/win-x64/`；`updaterCacheDirName = '@deepseek-aidsh-desktop-updater'`（注意该字面量没有 `@deepseek-ai/` 斜杠分隔，与任务书给出的候选目录名不同，二者在 §4 均已核对）。

---

## 3. PATH 全局 `dsh`

### 3.1 解析与版本

命令原文：

```powershell
$c = Get-Command dsh -ErrorAction SilentlyContinue
"FOUND=$([bool]$c)"
if ($c) { $c | Format-List Name,CommandType,Source,Path }
"---DSH_VERSION---"
& dsh --version 2>&1 | ForEach-Object { $_.ToString() }
"DSH_GLOBAL_EXIT=$LASTEXITCODE"
```

原始输出：

```text
FOUND=True

Name        : dsh.ps1
CommandType : ExternalScript
Source      : D:\Program Files\npm-global\dsh.ps1
Path        : D:\Program Files\npm-global\dsh.ps1

---DSH_VERSION---
0.2.1-alpha.2
DSH_GLOBAL_EXIT=0
```

**结论**：PATH 上的 `dsh` 解析到 `D:\Program Files\npm-global\dsh.ps1`，版本 = **`0.2.1-alpha.2`**（exit code 0）。

### 3.2 它指向的包

命令原文：

```powershell
$pkg='D:\Program Files\npm-global\node_modules\@deepseek-ai\dsh\package.json'
"PKG_EXISTS=$(Test-Path -LiteralPath $pkg -PathType Leaf)"
Get-Content -LiteralPath $pkg -Raw
"PKG_READ_OK=$?"
```

原始输出摘要（全文很大，取关键字段；`PKG_EXISTS=True`、`PKG_READ_OK=True`）：

```json
{
  "name": "@deepseek-ai/dsh",
  "description": "dsh CLI: profile launch, plugin management, and configuration inspection",
  "version": "0.2.1-alpha.2",
  "type": "module",
  "bin": {
    "dsh": "lib/bin.js"
  }
}
```

同时读到 shim 的实际入口（`dsh.ps1` 原文）：

```powershell
& "$basedir/node$exe"  "$basedir/node_modules/@deepseek-ai/dsh/lib/bin.js" $args
```

**结论**：PATH 全局 dsh 来自 `D:\Program Files\npm-global`（npm 全局 prefix 也在 §5 复核为 `D:\Program Files\npm-global`），包名 `@deepseek-ai/dsh`、版本 **`0.2.1-alpha.2`**；它与 §2 的 AppData 安装（`0.2.2-rc.1`）是**另一套安装**。

---

## 4. 候选 rc.2 安装包

### 4.1 指定路径与候选目录（只读）

命令原文：

```powershell
$exact='C:\Users\Administrator\AppData\Local\@deepseek-aidsh-desktop-updater\pending\deepseek-harness-0.2.2-rc.2-win-x64.exe'
"EXACT_1=$exact => $(Test-Path -LiteralPath $exact)"
"LOCALAPPDATA=$env:LOCALAPPDATA"
"TEMP=$env:TEMP"
$cands=@(
 "$env:LOCALAPPDATA\@deepseek-ai\dsh-desktop-updater",
 "$env:LOCALAPPDATA\@deepseek-aidsh-desktop-updater",
 "$env:LOCALAPPDATA\@deepseek-ai",
 "$env:TEMP\synova-1a-20261114",
 "$env:USERPROFILE\Downloads"
)
foreach ($c in $cands) { "EXISTS=$c => $(Test-Path -LiteralPath $c)" }
"---UPDATER_DIR_LISTING---"
foreach ($c in @("$env:LOCALAPPDATA\@deepseek-ai\dsh-desktop-updater","$env:LOCALAPPDATA\@deepseek-aidsh-desktop-updater")) {
  if (Test-Path -LiteralPath $c) { "DIR=$c"; Get-ChildItem -LiteralPath $c -Recurse -ErrorAction SilentlyContinue | Select-Object FullName,Length,LastWriteTime | Format-List }
}
"---UPDATE_INFO---"
foreach ($c in @("$env:LOCALAPPDATA\@deepseek-ai\dsh-desktop-updater","$env:LOCALAPPDATA\@deepseek-aidsh-desktop-updater","$env:TEMP\synova-1a-20261114")) {
  Get-ChildItem -LiteralPath $c -Recurse -Filter 'update-info.json' -ErrorAction SilentlyContinue | Select-Object FullName,Length | Format-List
}
"---DOWNLOADS_RC2---"
Get-ChildItem -LiteralPath "$env:USERPROFILE\Downloads" -Filter '*0.2.2-rc.2*' -Recurse -File -ErrorAction SilentlyContinue | Select-Object FullName,Length,LastWriteTime | Format-List
"DL_OK=$?"
```

原始输出：

```text
EXACT_1=C:\Users\Administrator\AppData\Local\@deepseek-aidsh-desktop-updater\pending\deepseek-harness-0.2.2-rc.2-win-x64.exe => False
LOCALAPPDATA=C:\Users\Administrator\AppData\Local
TEMP=C:\Users\ADMINI~1\AppData\Local\Temp
EXISTS=C:\Users\Administrator\AppData\Local\@deepseek-ai\dsh-desktop-updater => False
EXISTS=C:\Users\Administrator\AppData\Local\@deepseek-aidsh-desktop-updater => False
EXISTS=C:\Users\Administrator\AppData\Local\@deepseek-ai => False
EXISTS=C:\Users\ADMINI~1\AppData\Local\Temp\synova-1a-20261114 => False
EXISTS=C:\Users\Administrator\Downloads => False
---UPDATER_DIR_LISTING---
（无输出；两个 updater 目录均不存在）
---UPDATE_INFO---
（无输出；三个候选目录均不存在，故未找到 update-info.json）
---DOWNLOADS_RC2---
（无输出）
DL_OK=False
```

`DL_OK=False` 是因为 `C:\Users\Administrator\Downloads` 目录本身不存在，`Get-ChildItem` 无法枚举；命令外壳 exit code = 0。

补充确认 `%USERPROFILE%\Downloads` 及本地化变体：

```powershell
"USERPROFILE=$env:USERPROFILE"
Get-ChildItem -LiteralPath $env:USERPROFILE -Force | Select-Object Name,Mode | Format-Table -AutoSize
foreach ($d in @("$env:USERPROFILE\Downloads","$env:USERPROFILE\OneDrive\Downloads","$env:USERPROFILE\下载")) { "$d => $(Test-Path -LiteralPath $d)" }
```

原始输出摘要：

```text
USERPROFILE=C:\Users\Administrator
C:\Users\Administrator\Downloads => False
C:\Users\Administrator\OneDrive\Downloads => False
C:\Users\Administrator\下载 => False
```

用户目录列表中存在 `Desktop`、`Documents`、`OneDrive` 等，但**没有 `Downloads` 目录**。命令外壳 exit code = 0。

### 4.2 `D:\` 深度 3 搜索 `*0.2.2-rc.2*`

命令原文：

```powershell
$sw=[Diagnostics.Stopwatch]::StartNew()
$hits = Get-ChildItem -LiteralPath 'D:\' -Filter '*0.2.2-rc.2*' -Recurse -Depth 3 -File -ErrorAction SilentlyContinue
"COUNT=$($hits.Count)"
$hits | Select-Object FullName,Length,LastWriteTime | Format-List
"SEARCH_SECONDS=$([math]::Round($sw.Elapsed.TotalSeconds,1))"
"SEARCH_OK=$?"
```

原始输出：

```text
COUNT=0
（无匹配文件输出）
SEARCH_SECONDS=4.1
SEARCH_OK=True
```

命令外壳 exit code = 0。

### 4.3 `update-info.json` 与 rc.2 文件的更广搜索（LocalAppData / AppData，深度 4）

命令原文：

```powershell
$hits=@()
foreach ($root in @($env:LOCALAPPDATA,$env:APPDATA)) {
  $hits += Get-ChildItem -LiteralPath $root -Recurse -Depth 4 -Filter 'update-info.json' -File -ErrorAction SilentlyContinue
}
"UPDATE_INFO_COUNT=$($hits.Count)"
$hits | Select-Object FullName,Length,LastWriteTime | Format-List
$hits2=@()
foreach ($root in @($env:LOCALAPPDATA,$env:APPDATA)) {
  $hits2 += Get-ChildItem -LiteralPath $root -Recurse -Depth 4 -Filter '*0.2.2-rc.2*' -File -ErrorAction SilentlyContinue
}
"RC2_COUNT=$($hits2.Count)"
$hits2 | Select-Object FullName,Length | Format-List
"SEARCH_OK=$?"
```

原始输出：

```text
UPDATE_INFO_COUNT=1
FullName      : C:\Users\Administrator\AppData\Local\kimi-desktop-updater\pending\update-info.json
Length        : 167
LastWriteTime : 2026/11/15 6:53:35

RC2_COUNT=0
SEARCH_OK=True
```

命令外壳 exit code = 0。

**要点**：深度 4 范围内唯一的 `update-info.json` 属于 **Kimi 桌面更新器**，不是 DeepSeek/DSH；DeepSeek 相关 updater 缓存目录不存在（§4.1）。LocalAppData/AppData 深度 4 内 **rc.2 文件数 = 0**。

### 4.4 结论

**`NOT_AVAILABLE`**：

- 候选 rc.2 安装包 `...\pending\deepseek-harness-0.2.2-rc.2-win-x64.exe`：指定路径不存在；
- `%LOCALAPPDATA%\@deepseek-ai\dsh-desktop-updater`、`%LOCALAPPDATA%\@deepseek-aidsh-desktop-updater`、`%LOCALAPPDATA%\@deepseek-ai`：均不存在；
- `%TEMP%\synova-1a-20261114`：不存在；
- `%USERPROFILE%\Downloads`：目录本身不存在；
- `D:\` 深度 3：rc.2 文件 0 个；
- LocalAppData/AppData 深度 4：rc.2 文件 0 个；DeepSeek `update-info.json` 不存在。

因此本次**无法现场核验** rc.2 安装包实物、其 **SHA512**、其**包内 `runtime.json`**。`DEV DOC v4 §2.1` 记录的 rc.2 SHA512/尺寸只是**历史记录**，本次没有实物可对照，**未复核**。

---

## 5. Node 版本

命令原文：

```powershell
node --version
"NODE_EXIT=$LASTEXITCODE"
Get-Command node | Format-List Name,CommandType,Source,Path
"NODE_CMD_OK=$?"
"---NPM_PREFIX---"
npm prefix -g
"NPM_PREFIX_EXIT=$LASTEXITCODE"
```

原始输出：

```text
v24.16.0
NODE_EXIT=0

Name        : node.exe
CommandType : Application
Source      : C:\Program Files\nodejs\node.exe
Path        : C:\Program Files\nodejs\node.exe

NODE_CMD_OK=True
---NPM_PREFIX---
D:\Program Files\npm-global
NPM_PREFIX_EXIT=0
```

DSH 内置 node（只读执行版本号）：

```powershell
$node='C:\Users\Administrator\AppData\Local\Programs\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe'
"EXISTS=$(Test-Path -LiteralPath $node -PathType Leaf)"
& $node --version
"BUILTIN_NODE_EXIT=$LASTEXITCODE"
```

原始输出：

```text
EXISTS=True
v24.21.0
BUILTIN_NODE_EXIT=0
```

命令外壳 exit code = 0。

**结论**：

- PATH `node` = **`v24.16.0`**，`C:\Program Files\nodejs\node.exe`；npm 全局 prefix = `D:\Program Files\npm-global`。它是本机仓库/测试用 node，**不是** DSH 内置 node。
- DSH `runtime.json` 的 `node` = **`24.21.0`**；DSH 内置 node 实物 `...\primary-runtime\dependencies\node\bin\node.exe` 实测 `v24.21.0`（exit code 0），两者一致。
- `runtime.json` 同时记录 `pnpm = 11.28.5`、`python = 3.12.14`（见 §2.2 全文）。

---

## 6. 仓外源码断面 `D:\dsh-ref`

### 6.1 HEAD / describe / log / package.json

命令原文：

```powershell
$r='D:\dsh-ref'
"REF_EXISTS=$(Test-Path -LiteralPath $r -PathType Container)"
git -C $r rev-parse HEAD
"HEAD_EXIT=$LASTEXITCODE"
git -C $r describe --tags --always
"DESCRIBE_EXIT=$LASTEXITCODE"
git -C $r log -1 --format='%H %ad' --date=iso
"LOG_EXIT=$LASTEXITCODE"
Get-Content -LiteralPath "$r\package.json" -Raw
"PKG_OK=$?"
```

原始输出：

```text
REF_EXISTS=True
687f282e8625c6b8d11ff58211a90524be2e4317
HEAD_EXIT=0
687f282e
DESCRIBE_EXIT=0
687f282e8625c6b8d11ff58211a90524be2e4317 2026-10-17 15:22:43 +0800
LOG_EXIT=0
```

根 `package.json` 摘要（全文很大，取关键字段；命令已读完原文，`PKG_OK=True`）：

```json
{
  "name": "@deepseek-ai/dsh-root",
  "version": "0.2.1-rc.2",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.28.5",
  "engines": {
    "node": "^22.19.0 || >=24.0.0"
  },
  "workspaces": [
    "vendor/*",
    "packages/*/*",
    "native/system",
    "native/system/packages/*",
    "apps/*",
    "website"
  ]
}
```

命令外壳 exit code = 0（各 `$LASTEXITCODE` 均为 0）。

### 6.2 候选 commit `ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c`

命令原文：

```powershell
git -C $r cat-file -t ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c
"CATFILE_T_EXIT=$LASTEXITCODE"
git -C $r cat-file -e ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c
"CATFILE_E_EXIT=$LASTEXITCODE"
```

原始输出：

```text
CATFILE_T_EXIT=128
CATFILE_E_EXIT=1
[stderr]
fatal: git cat-file: could not get object info
```

**结论**：

- `D:\dsh-ref` HEAD = `687f282e8625c6b8d11ff58211a90524be2e4317`，describe = `687f282e`（无 tag 命中，退回短 SHA），根包 `@deepseek-ai/dsh-root@0.2.1-rc.2`；这是 **0.2.1-rc.2 源码断面，不是 0.2.2-rc.2**。
- `ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c` 在 `D:\dsh-ref` 对象库中**不存在**（`cat-file -t` exit 128，`cat-file -e` exit 1）⇒ 标 **`COMMIT_UNVERIFIED`**；DEV DOC 记为“rc.2 候选 commit”这一点本次无法物理核实。
- 0.2.2-rc.2 的源码断面：**`SOURCE_NOT_AVAILABLE`**（`D:\dsh-ref` 不是该版本）。

---

## 7. 已安装 app.asar 内 ACP 事实

> 取证对象：`C:\Users\Administrator\AppData\Local\Programs\DeepSeek Harness\resources\app.asar`（213,202,918 B）。
> 工具：worktree 内 `node_modules\.bin\asar.cmd`（`@electron/asar`），**未执行 npm install / npx 下载**。
> 抽取目标：`%TEMP%\synova-1a-t1-asar-20261114`（任务允许的仓外临时目录）。

### 7.1 `@deepseek-ai/dsh-acp` 是否在 app.asar 内

命令原文：

```powershell
$asar='D:\novis-backup-20260526\Novis\.synova-wt-1395-1a\node_modules\.bin\asar.cmd'
$appAsar='C:\Users\Administrator\AppData\Local\Programs\DeepSeek Harness\resources\app.asar'
$all = & $asar list $appAsar 2>&1
"TOTAL=$($all.Count)"
$m = $all | Where-Object { $_ -match 'dsh-acp' }
"COUNT=$($m.Count)"
$m | Select-Object -First 40
"LIST_OK=$?"
```

原始输出摘要：

```text
TOTAL=25418
COUNT=35
\dsh\node_modules\@deepseek-ai\dsh-acp-app
...
\dsh\node_modules\@deepseek-ai\dsh-acp
\dsh\node_modules\@deepseek-ai\dsh-acp\LICENSE
\dsh\node_modules\@deepseek-ai\dsh-acp\README.i18n.yaml
\dsh\node_modules\@deepseek-ai\dsh-acp\README.md
\dsh\node_modules\@deepseek-ai\dsh-acp\README.zh.md
\dsh\node_modules\@deepseek-ai\dsh-acp\lib
\dsh\node_modules\@deepseek-ai\dsh-acp\lib\index.js
\dsh\node_modules\@deepseek-ai\dsh-acp\locale
\dsh\node_modules\@deepseek-ai\dsh-acp\locale\de.json
\dsh\node_modules\@deepseek-ai\dsh-acp\locale\en.json
\dsh\node_modules\@deepseek-ai\dsh-acp\locale\es.json
\dsh\node_modules\@deepseek-ai\dsh-acp\locale\fr.json
\dsh\node_modules\@deepseek-ai\dsh-acp\locale\ja.json
\dsh\node_modules\@deepseek-ai\dsh-acp\locale\pt.json
\dsh\node_modules\@deepseek-ai\dsh-acp\locale\ru.json
\dsh\node_modules\@deepseek-ai\dsh-acp\locale\zh.json
\dsh\node_modules\@deepseek-ai\dsh-acp\package.json
LIST_OK=True
```

**存在性结论**：`@deepseek-ai/dsh-acp` **存在于 app.asar 内**，含 `lib/index.js` 与 `package.json`。35 条命中中：`dsh-acp` 自身 17 条、`dsh-acp-app` 18 条。

**取证过程中的一次口径修正（如实记录）**：首次用正斜杠模式 `Select-String -SimpleMatch '@deepseek-ai/dsh-acp'` 对 `asar list` 输出过滤得到 0 行；原因是 `asar list` 在 Windows 上输出的是反斜杠路径（如 `\dsh\node_modules\@deepseek-ai\dsh-acp`）。改用 `-match 'dsh-acp'` 后得到 35 条命中。这不是“包不存在”，是匹配串分隔符错误。

命令外壳 exit code = 0（`TOTAL` 命令 `$LASTEXITCODE=0`；`LIST_OK=True`）。

### 7.2 抽取 `dsh-acp` 包清单与入口

命令原文（注意：`asar extract-file` 的包内路径必须用**反斜杠**；正斜杠会报 `was not found in this archive`，exit 1）：

```powershell
$asar='D:\novis-backup-20260526\Novis\.synova-wt-1395-1a\node_modules\.bin\asar.cmd'
$appAsar='C:\Users\Administrator\AppData\Local\Programs\DeepSeek Harness\resources\app.asar'
$t=Join-Path $env:TEMP 'synova-1a-t1-asar-20261114'
New-Item -ItemType Directory -Path "$t\acp-pkg" -Force | Out-Null
Push-Location "$t\acp-pkg"
& $asar extract-file $appAsar 'dsh\node_modules\@deepseek-ai\dsh-acp\package.json' 2>&1 | Out-String
"EX_ACP_PKG=$LASTEXITCODE"
Pop-Location
Get-Content -LiteralPath "$t\acp-pkg\package.json" -Raw
"PKG_OK=$?"
```

原始输出（全文）：

```json
{
  "name": "@deepseek-ai/dsh-acp",
  "description": "Automation-only Agent Client Protocol server for driving DeepSeek Harness agents over JSON-RPC stdio",
  "version": "0.2.2-rc.1",
  "publishConfig": {
    "access": "public"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/deepseek-ai/deepseek-harness.git",
    "directory": "packages/acp/acp"
  },
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": {
      "types": "./lib/types/index.d.ts",
      "default": "./lib/index.js"
    },
    "./src/*": "./src/*",
    "./locale/*.json": "./locale/*.json",
    "./package.json": "./package.json"
  },
  "files": [
    "locale/*.json",
    "lib/index.js",
    "lib/types/**/*.d.ts"
  ],
  "license": "MIT",
  "dependencies": {
    "@agentclientprotocol/sdk": "1.4.0",
    "@deepseek-ai/dsh-brand": "0.2.2-rc.1",
    "@deepseek-ai/schemastery": "~3.19.0"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "~4.1.0",
    "@deepseek-ai/dsh-agent": "0.2.2-rc.1",
    "@deepseek-ai/dsh-attachment": "0.2.2-rc.1",
    "@deepseek-ai/dsh-llm": "0.2.2-rc.1",
    "@deepseek-ai/dsh-mcp-client": "0.2.2-rc.1",
    "@deepseek-ai/dsh-session": "0.2.2-rc.1",
    "@deepseek-ai/dsh-session-persistence": "0.2.2-rc.1",
    "@deepseek-ai/dsh-token-meter": "0.2.2-rc.1",
    "@deepseek-ai/dsh-user-approval": "0.2.2-rc.1"
  },
  "peerDependenciesMeta": {
    "@deepseek-ai/dsh-token-meter": {
      "optional": true
    }
  }
}
```

`EX_ACP_PKG=0`、`PKG_OK=True`；命令外壳 exit code = 0。

同时抽取 `dsh/package.json`（app.asar 内 dsh 安装根清单）与 `dsh/desktop-runtime.json`：

```powershell
Push-Location "$t\root"
& $asar extract-file $appAsar 'dsh/package.json' 2>&1 | Out-String
"EX_ROOT_PKG=$LASTEXITCODE"
& $asar extract-file $appAsar 'dsh/desktop-runtime.json' 2>&1 | Out-String
"EX_ROOT_RT=$LASTEXITCODE"
Pop-Location
Get-Content -LiteralPath "$t\root\package.json" -Raw | Select-String -Pattern '"(name|version|@deepseek-ai/dsh|@deepseek-ai/dsh-acp)"\s*:' -AllMatches | ForEach-Object { $_.Line }
```

原始输出关键行：

```text
"name": "@deepseek-ai/dsh-desktop-runtime",
"version": "0.2.2-rc.1",
"@deepseek-ai/dsh": "0.2.2-rc.1",
"@deepseek-ai/dsh-acp": "0.2.2-rc.1",
EX_ROOT_PKG=0
EX_ROOT_RT=0
```

**结论**：已安装 app.asar 内的 ACP 包为 **`@deepseek-ai/dsh-acp@0.2.2-rc.1`**，其依赖 **`@agentclientprotocol/sdk@1.4.0`**；app.asar 内 dsh 安装根清单 `@deepseek-ai/dsh-desktop-runtime@0.2.2-rc.1` 同样记录 `@deepseek-ai/dsh@0.2.2-rc.1`、`@deepseek-ai/dsh-acp@0.2.2-rc.1`。抽取成功，命令外壳 exit code = 0。

### 7.3 `agentInfo` / `protocolVersion` / session 方法字符串

命令原文（计数部分为本节最后一次逐项复核；上下文与唯一列表来自同一文件的只读取证）：

```powershell
$t=Join-Path $env:TEMP 'synova-1a-t1-asar-20261114'
$f="$t\acp\index.js"   # 由 dsh\node_modules\@deepseek-ai\dsh-acp\lib\index.js 抽出，54,860 B
$txt=Get-Content -LiteralPath $f -Raw
foreach ($pat in @('agentInfo','protocolVersion','session/new','session/prompt','session/update','session/cancel','session/load','session/list','session/set_mode','session/set_model','session/resume','session/event','authenticate','initialize')) {
  "$pat = $([regex]::Matches($txt,[regex]::Escape($pat)).Count)"
}
$i=$txt.IndexOf('agentInfo'); $txt.Substring([Math]::Max(0,$i-200), [Math]::Min(900, $txt.Length-[Math]::Max(0,$i-200)))
$j=$txt.IndexOf('protocolVersion'); $txt.Substring([Math]::Max(0,$j-200), [Math]::Min(700, $txt.Length-[Math]::Max(0,$j-200)))
([regex]::Matches($txt,'session/[a-zA-Z_]+') | ForEach-Object { $_.Value } | Sort-Object -Unique)
"GREP_OK=$?"
```

原始输出（逐项计数为真实回填值）：

```text
agentInfo = 1
protocolVersion = 1
session/new = 3
session/prompt = 0
session/update = 1
session/cancel = 0
session/load = 0
session/list = 2
session/set_mode = 0
session/set_model = 0
session/resume = 4
session/event = 1
authenticate = 3
initialize = 3

---AGENTINFO_CONTEXT---
		async initialize(_params) {
			imagePromptEnabled = await supportsAcpImagePrompts(ctx, config.provider, config.model);
			return {
				protocolVersion: PROTOCOL_VERSION,
				agentInfo: {
					name: "deepseek-harness-acp",
					version: "0.0.1"
				},
				agentCapabilities: {
					mcpCapabilities: { http: true },
					promptCapabilities: {
						image: imagePromptEnabled,
						audio: false,
						embeddedContext: false
					},
					sessionCapabilities: {
						close: {},
						list: {},
						resume: {}
					}
				},
				authMethods: []
			};
		},

---SESSION_METHODS_UNIQUE---
session/event
session/list
session/new
session/resume
session/update
GREP_OK=True
```

命令外壳 exit code = 0。

**`protocolVersion` 取值来源**：`dsh-acp/lib/index.js` 第 9 行 `import { PROTOCOL_VERSION, RequestError, agent, methods, ndJsonStream } from "@agentclientprotocol/sdk";`，第 1121 行 `protocolVersion: PROTOCOL_VERSION,`。该常量在 SDK 的 `dist/schema/index.js` 中定义：

```powershell
Push-Location "$t\sdk\schema"
& $asar extract-file $appAsar 'dsh\node_modules\@agentclientprotocol\sdk\dist\schema\index.js' 2>&1 | Out-String
"EX_SCHEMA_INDEX=$LASTEXITCODE"
Pop-Location
Select-String -LiteralPath "$t\sdk\schema\index.js" -Pattern 'PROTOCOL_VERSION' | ForEach-Object { "LINE=$($_.LineNumber): $($_.Line.Trim())" }
Select-String -LiteralPath "$t\sdk\schema\index.js" -Pattern 'session/prompt|session/new|session/load|session/list|session/cancel|session/update' | ForEach-Object { "LINE=$($_.LineNumber): $($_.Line.Trim())" }
```

原始输出：

```text
EX_SCHEMA_INDEX=0
LINE=51: export const PROTOCOL_VERSION = 1;
LINE=8: session_new: "session/new",
LINE=9: session_load: "session/load",
LINE=12: session_prompt: "session/prompt",
LINE=13: session_cancel: "session/cancel",
LINE=15: session_list: "session/list",
LINE=34: session_update: "session/update",
```

命令外壳 exit code = 0。

**§7 结论**：

- app.asar 内 `@deepseek-ai/dsh-acp` **存在**，版本 **`0.2.2-rc.1`**；
- `agentInfo.name = "deepseek-harness-acp"`，`agentInfo.version = "0.0.1"`（返回体见上）；
- `protocolVersion = PROTOCOL_VERSION`，SDK 常量实测 **`1`**；
- dsh-acp `lib/index.js` 内出现的会话方法字符串：`session/new`、`session/resume`、`session/list`、`session/update`、`session/event`；**未**在该入口出现 `session/prompt` 字面量（`session/prompt` 定义在 SDK 的 `dist/schema/index.js` 方法表中，行 12）。
- 以上是 app.asar 静态字符串证据；**未**启动 ACP 会话、**未**做 initialize/session 运行时握手。

---

## 8. ACP stdio 帧格式的协议来源

### 8.1 文件、版本与 `ndJsonStream` 实现

命令原文：

```powershell
$sdk='C:\Users\Administrator\AppData\Local\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Roaming\io.github.hairyf.deepseek-harness-desktop\dependencies\dsh'
$f="$sdk\node_modules\@agentclientprotocol\sdk\dist\stream.js"
"FILE_EXISTS=$(Test-Path -LiteralPath $f -PathType Leaf)"
"FILE_SIZE=$((Get-Item -LiteralPath $f).Length)"
"LAST_WRITE=$((Get-Item -LiteralPath $f).LastWriteTime.ToString('o'))"
Get-Content -LiteralPath $f -Raw
"READ_OK=$?"
Select-String -LiteralPath $f -Pattern 'ndJsonStream|JSON.stringify|\\n' -AllMatches | ForEach-Object { "LINE=$($_.LineNumber): $($_.Line)" }
"GREP_EXIT=$?"
Get-Content -LiteralPath "$sdk\node_modules\@agentclientprotocol\sdk\package.json" -Raw
"SDK_PKG_OK=$?"
```

原始输出（`stream.js` 全文关键部分；文件 3,857 B）：

```text
FILE_EXISTS=True
FILE_SIZE=3857
LAST_WRITE=2026-09-08T15:11:02.0940979+08:00
READ_OK=True

export function ndJsonStream(output, input) {
    ...
    const writeJson = (message) => {
        const content = JSON.stringify(message) + "\n";
        ...
                const trimmedLine = textDecoder.decode(lineBytes).trim();
                ...
                message = JSON.parse(trimmedLine);
    ...
}
GREP_EXIT=True
LINE=13: export function ndJsonStream(output, input) {
LINE=20:         const content = JSON.stringify(message) + "\n";
```

`sdk/package.json` 关键字段（全文已读）：

```text
"name": "@agentclientprotocol/sdk",
"version": "1.4.0",
"type": "module",
"main": "dist/acp.js",
```

**帧格式事实**：ACP over stdio 使用 **NDJSON**（newline-delimited JSON）：写入端 `JSON.stringify(message) + "\n"`；读取端按行缓冲（`LineBuffer`）后对每行 `JSON.parse`，空行跳过。这是 SDK 1.4.0 的 `ndJsonStream` 实现。

### 8.2 该 SDK 所在 dsh 依赖版本

命令原文：

```powershell
Get-Content -LiteralPath "$sdk\package.json" -Raw
"BASE_PKG_OK=$?"
```

原始输出（全文）：

```json
{"name":"dsh-desktop-core","private":true,"version":"0.0.0","dependencies":{"@deepseek-ai/dsh":"0.1.3-alpha.2"}}
```

同一安装内 `@deepseek-ai/dsh-acp/package.json` 关键字段（只读）：

```json
{
  "name": "@deepseek-ai/dsh-acp",
  "version": "0.1.3-alpha.2",
  "dependencies": {
    "@agentclientprotocol/sdk": "1.4.0",
    "@deepseek-ai/dsh-brand": "^0.1.3-alpha.2",
    "@deepseek-ai/schemastery": "^3.18.2"
  }
}
```

另核对 `...\dependencies\dsh\node_modules\@deepseek-ai\dsh\package.json`：

```text
LEN=6891
FIRST_64_HEX=00 00 00 00 00 00 00 00 ...（64 字节全 0x00）
UNIQUE_BYTES=1
UNIQUE_LIST=00
```

即该 `@deepseek-ai/dsh` 自身的 `package.json` 为 **6,891 字节全 `0x00`**，无法读出 `name/version`（读取异常如实记录）。因此“该 SDK 所在 dsh 依赖版本”以**安装根** `dependencies\dsh\package.json` 的依赖声明为准：**`@deepseek-ai/dsh: 0.1.3-alpha.2`**；同一安装内 `@deepseek-ai/dsh-acp@0.1.3-alpha.2` 也依赖 `@agentclientprotocol/sdk@1.4.0`，互相印证。

### 8.3 与已安装 rc.1 app.asar 的同族比对（补充证据）

把 app.asar 内 `@agentclientprotocol/sdk` 的以下文件抽到 `%TEMP%` 后计算 SHA256，与 Codex 安装内的同一文件比对：

```powershell
Get-FileHash -LiteralPath "$t\sdk\stream.js" -Algorithm SHA256
Get-FileHash -LiteralPath "$t\sdk\acp.js" -Algorithm SHA256
Get-FileHash -LiteralPath "$t\sdk\schema\index.js" -Algorithm SHA256
# 对应 Codex 路径：
# ...\dependencies\dsh\node_modules\@agentclientprotocol\sdk\dist\{stream.js,acp.js,schema\index.js}
```

原始输出：

```text
stream.js       042E7B09F1D1D7485C75777FBC8F864F68F76E5B3C30AEB51D60DD5D4DB86AB3  （app.asar rc.1）
stream.js       042E7B09F1D1D7485C75777FBC8F864F68F76E5B3C30AEB51D60DD5D4DB86AB3  （Codex 安装）
acp.js          CC717D74B018C1FE3E1E53E31FF6355CCF52E729E753666051BDA42499BE7B9F  （app.asar rc.1）
acp.js          CC717D74B018C1FE3E1E53E31FF6355CCF52E729E753666051BDA42499BE7B9F  （Codex 安装）
schema/index.js E855A3F9B5F8E7DE952410F7B048393A16650E096EC7E51FBFEF5902BD37BC06  （app.asar rc.1）
schema/index.js E855A3F9B5F8E7DE952410F7B048393A16650E096EC7E51FBFEF5902BD37BC06  （Codex 安装）
```

三个文件逐字节一致（SHA256 相同）。

### 8.4 结论与口径

- **协议帧格式事实**：ACP stdio = **NDJSON**，编码 `JSON.stringify(message) + "\n"`，按行解码；来源文件 `...\@agentclientprotocol\sdk\dist\stream.js`（SDK **1.4.0**），`ndJsonStream` 第 13 行、编码行第 20 行，见 §8.1 原始输出。
- **该 SDK 所在 dsh 依赖版本**：安装根 `...\dependencies\dsh\package.json` 声明 `@deepseek-ai/dsh: 0.1.3-alpha.2`（§8.2）；该包自身 `package.json` 为全 0x00 不可读，已如实记录。
- **来源定性**：以上不是 rc.2 安装包内实物（§4 已证 rc.2 安装包不存在）。且该 SDK 文件与已安装 **0.2.2-rc.1** app.asar 内 SDK 1.4.0 的 `stream.js/acp.js/schema/index.js` **逐字节一致**（SHA256 相同），因此协议事实标为 **「源码断面/同族 SDK 证据」**，不标为「rc.2 实物」。
- 本文件只核对静态文件；**未**运行 ACP、**未**发任何模型请求或外发数据。

---

## UNVERIFIED / NOT_AVAILABLE 清单

| 编号 | 状态 | 项 | 依据 |
|---|---|---|---|
| 1 | **NOT_AVAILABLE** | rc.2 安装包 `deepseek-harness-0.2.2-rc.2-win-x64.exe` | 指定路径 False；`%LOCALAPPDATA%\@deepseek-ai\dsh-desktop-updater`、`%LOCALAPPDATA%\@deepseek-aidsh-desktop-updater`、`%LOCALAPPDATA%\@deepseek-ai`、`%TEMP%\synova-1a-20261114` 均不存在；`D:\` 深度 3 搜索 0；LocalAppData/AppData 深度 4 搜索 0（§4） |
| 2 | **NOT_AVAILABLE** | rc.2 安装包 SHA512 | 无安装包实物，无法计算/复核（§4） |
| 3 | **NOT_AVAILABLE** | rc.2 包内 `runtime.json` | 无安装包实物，无法抽取（§4） |
| 4 | **NOT_AVAILABLE** | rc.2 的 DeepSeek `update-info.json` | DeepSeek updater 缓存目录不存在；深度 4 唯一命中为 `kimi-desktop-updater\pending\update-info.json`，与 DSH 无关（§4.3） |
| 5 | **NOT_AVAILABLE** | `%USERPROFILE%\Downloads` 路径 | 该目录本身不存在（`C:\Users\Administrator\Downloads` False；OneDrive\Downloads/下载 亦 False），无法在该处核验 rc.2（§4.1） |
| 6 | **SOURCE_NOT_AVAILABLE** | 0.2.2-rc.2 源码断面 | `D:\dsh-ref` 实测为 `@deepseek-ai/dsh-root@0.2.1-rc.2`，HEAD `687f282e...`（§6） |
| 7 | **COMMIT_UNVERIFIED** | `ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c`（DEV DOC 记为 rc.2 候选 commit） | `git cat-file -t` exit 128、`-e` exit 1；对象不在 `D:\dsh-ref` 对象库（§6.2） |
| 8 | **未复核（历史记录）** | `DEV DOC v4 §2.1` 记录的 rc.2 SHA512/尺寸 | 本次无 rc.2 实物可对照；该记录只作历史引用，未复核（§4.4） |
| 9 | **UNVERIFIED** | Codex 安装根 `@deepseek-ai/dsh` 自身 `package.json` 的 name/version | 文件 6,891 B 全 `0x00`，不可读；只能采用安装根 `dependencies\dsh\package.json` 的依赖声明 `0.1.3-alpha.2`（§8.2） |
| 10 | **未验证（范围外）** | ACP initialize/session 运行时握手 | 本任务仅做已安装 app.asar 与 SDK 文件的静态字符串取证；未启动 ACP 会话、未做运行时验证（§7、§8） |
| 11 | **未验证（范围外）** | nssm 服务 `DeepSeekHarness` 与 AppData 运行宿主的关系/历史 | 只读记录其 State=Paused、PathName；未操作、未查服务历史（§1.3） |

---

## 自证说明（文件自身）

- 本文件写完后由 `Get-FileHash -Algorithm SHA256` 计算自身 SHA256，值在交付回执中给出；**不把该值写回本文件**（否则会改变自身摘要，形成自指）。
- 本文件是本会话唯一写入的仓库文件；`%TEMP%\synova-1a-t1-asar-20261114` 下是任务允许的 asar 抽取物，不进入仓库。
- 本次所有命令均只读（`Get-CimInstance` / `Get-NetTCPConnection` / `Test-Path` / `Get-Item` / `Get-FileHash` / `Get-Content` / `Select-String` / `git log/show/rev-parse/cat-file` / `dsh.cmd --version` / `dsh --version` / `node --version` / `npm prefix -g` / `asar list` / `asar extract-file` 到 `%TEMP%`）；**没有**安装/升级/卸载、**没有**停止/结束任何进程、**没有**读取凭据文件、**没有**模型调用或外发、**没有** npm install。
