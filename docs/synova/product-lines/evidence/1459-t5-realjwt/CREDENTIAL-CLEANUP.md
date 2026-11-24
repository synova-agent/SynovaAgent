# CREDENTIAL-CLEANUP — #1459 M1/M2 收尾批（一次性凭据用后删除）

> 2026-11-24T20:48:25+08:00 ｜ 执行者：coding session
> 原则：**只记路径与时间，不记值**。所有值从不打印、不进日志、不进证据、不进 PR。

## 1 本次创建并已删除

| # | 凭据/文件 | 用途 | 删除时间 | 复核 |
|---|---|---|---|---|
| 1 | `D:\novis-backup-20260526\Novis\_r3chain-20261123\ops\t5-admin-password.txt`（21 B，单行 20 位随机密码） | 任务卡指定的一次性账号密码交接文件 | 2026-11-24T20:48:25+08:00 | `Test-Path` = False |
| 2 | `<worktree>\.tmp-m1m2\out\password.working.txt`（21 B） | 驱动脚本用的同值工作副本 | 同上 | `Test-Path` = False（所在 `out\` 目录一并删除） |
| 3 | `<worktree>\.tmp-m1m2\dsh-home\.credentials.yaml`（73 B，单条 `refs.DEEPSEEK_API_KEY`） | 隔离 DSH home 的模型凭据引用 | 同上 | `Test-Path` = False（`dsh-home\` 一并删除） |
| 4 | `<worktree>\.tmp-m1m2\.jwt-secret`（64 B，随机 JWT_SECRET） | 让"真实登录"生效的签名密钥 | 同上 | `Test-Path` = False |

## 2 已删除的一次性运行状态（不含凭据）

`<worktree>\.tmp-m1m2\{dsh-home,instance,electron-userdata,out}` —— DSH 会话/存储、Electron 用户目录、pid 文件。
证据侧已先落盘：每 run 的 `*-dsh-session-log.jsonl` ＋ `*-dsh-session-report.json`（含输入 zstd 的字节数与 sha256）。

## 3 从未落盘/从未外发

- 模型 key 的**值**：只经 `place-credential.cjs` 从用户级凭据库读入并写入隔离 `.credentials.yaml`，stdout 仅输出 `refName/len/outBytes`。
- 账号密码的**值**：只写入上表两处文件，驱动脚本从文件读入，不打印。
- JWT：只存在于桌面渲染进程内存 + 驱动进程内存（用于重放该 run 的 SSE），不写入任何证据文件。
- 证据目录已扫描：`sk-*` / JWT / 64 位 hex / `DEEPSEEK_API_KEY: <值>` 模式命中 168 处，**逐条核实全为 sha256 摘要与文档占位符**（`<secret>`、正则源码），**0 处真实凭据**。

## 4 账号本身的处置

`t5-admin@synth-1459.invalid`（`role=admin`，`org-a`）**只存在于隔离库** `%TEMP%\1459-scan\synova.db`（graph `enterprise` 的 1 个 `USER` 节点），删除/重置随该库处置；**主树 `data/synova.db` 未被触碰**（LastWriteTime 仍为 2026-10-09）。
