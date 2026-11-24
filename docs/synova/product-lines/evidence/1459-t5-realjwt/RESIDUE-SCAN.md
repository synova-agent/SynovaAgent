# RESIDUE-SCAN — #1459 M1/M2 收尾批（残留扫描，命令原始输出为据）

> 生成 2026-11-24T20:49:33.8938494+08:00 ｜ 执行者：coding session

## 1 端口（应为全部 closed）
- port 18790: closed (netstat LISTENING 零命中)
- port 5173: closed (netstat LISTENING 零命中)
- port 9222: closed (netstat LISTENING 零命中)

## 2 本次启动的进程（按 worktree 路径匹配 command line；应为 0）
- remaining_matched = 0
- 停止记录（stop-all.ps1 → logs/stop-killed.txt）：
  - node.exe stopped pid=6720
  - node.exe stopped pid=8448
  - node.exe stopped pid=2068
  - electron.exe stopped pid=21048
  - electron.exe stopped pid=15320
  - electron.exe stopped pid=17356
  - electron.exe stopped pid=10684

## 3 主树（禁写）
- git rev-parse HEAD 前 = 77eb430658a693f5e8a6adbe7001abc5f1ff8852
- git rev-parse HEAD 后 = 77eb430658a693f5e8a6adbe7001abc5f1ff8852
- 分支 = main
- 主树 data/synova.db: 12959744 B ｜ LastWriteTime = 2026-10-09T03:34:59.1484334+08:00（未触碰）
- 主树根下 3 小时内被改的文件数 = 0
- 主树 status 行数 = 223（会话前的既有脏项，未新增本批产物）

## 4 仓外一次性文件
- `_r3chain-20261123\ops\t5-admin-password.txt`：已删除（见 CREDENTIAL-CLEANUP.md）
- 复核 Test-Path = False

## 5 隔离库
- `%TEMP%\1459-scan\synova.db` **保留**（T0 产物，按手册不删）；本批只新增 1 个 `USER` 节点与 DSH 会话（在一次性 dsh-home，已删）
- 隔离库存在 = True

## 6 本次 worktree 内未提交残留
```
?? .codex/heartbeat.json
?? .tmp-m1m2/
?? docs/synova/product-lines/evidence/1459-contract-sampling/
?? docs/synova/product-lines/evidence/1459-t5-realjwt/
```

## 7 收尾后复核（final，`commit` 之后）

- 复核时间 = 2026-11-24T20:58:09.4069072+08:00
- port 18790: closed
- port 5173: closed
- port 9222: closed
- 本次 worktree 相关 node/electron 进程 = 0
- 主树 HEAD（复核）= 77eb430658a693f5e8a6adbe7001abc5f1ff8852
- 一次性临时目录 <wt>\.tmp-m1m2\：**已整目录删除**（删除前扫描 sk-*/JWT/64hex 模式 0 命中）；可复跑脚本已入库到两个 unner/ 子目录
- worktree 工作区最终状态：
```
?? .codex/heartbeat.json
```
- 本批提交：137525566（证据包）＋ a28e56be（README 指向 runner/）；分支 1459-closeout-m1m2 已推送 gitea（未改 main）
