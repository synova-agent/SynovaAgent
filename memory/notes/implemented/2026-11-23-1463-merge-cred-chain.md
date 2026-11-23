# #1463 合并凭证链路：token 第 4 来源接上 Windows GCM（甲类实现）＋ ② 移植/`E_NO_TOKEN` 送审（乙类）

- **状态**: implemented（甲类）＋ proposed（乙类 A 类送审）；2026-11-23，Issue #1463
- **任务**: #1463（CTO 2026-11-23 授权新建）：甲类＝B 类直做；乙类（② 移植修复／`E_NO_TOKEN`）只出提案、另走 A 类送审。根因：真 token 在 Windows GCM；② 在 Git Bash 恒 exit 2；`E_NO_TOKEN` 缺失
- **决策**:
  - **甲类（本分支已实现）**：`resolve_token()` 增第 4 来源 `git credential fill`（GCM）。host/protocol **从 `$API` 推导**（禁写死 `127.0.0.1:3000`，IP 会漂移）；`GIT_TERMINAL_PROMPT=0` ＋ `GCM_INTERACTIVE=never` ＋ `timeout`（`SYNO_MERGE_COND_CRED_TIMEOUT`，默认 10s，无 `timeout` 平台直跑）；取不到 ⇒ **返回非 0**（无静默空 token）。token 只走「管道→shell 变量」，不 `set -x`/不回显/不落盘；凭据助手 stderr 一律丢弃。前三来源顺序与语义**一字未改**。
  - **乙类（只提案，未改脚本）**：② 页文件路径改走 argv（MSYS 会转换）＋ API 路径改走环境变量（MSYS 不转换）＋ 合并步 rc 检查；新增 `E_NO_TOKEN`（TOKEN 空 ∧ 401/403 ∧ body 含 `Only signed in user`）。见 `docs/synova/coordination/提案-合并凭证与②移植-20261123.md`。**判定为 A 类**（改 ② 输入构造／新增降级码），未获裁定前不动。
- **理由**: 本机 `GITEA_TOKEN`/`SYNO_GITEA_TOKEN`/`$HOME/gitea/.win-push-token` **全空**（实测），真凭据只在 GCM ⇒ 原三级链必 `TOKEN=""` ⇒ API 403 ⇒ 全 PR 判不了。第 4 来源是"让门禁在本机可用"的最小改动，且 host 由 `$API` 推导可随 IP 漂移，不重蹈写死地址。
- **证据**（本机 Git Bash，真 token 真 API，均不含凭据值）:
  - **无 token ⇒ fail-closed**：禁 helper ＋ 空 HOME ＋ 非仓 cwd ⇒ `degraded: HTTP 403 on /pulls/1461 [code=E_API_HTTP]`，exit 2
  - **有 GCM ⇒ 取到并可用**：`① CI 全绿 pending=0 ......... ok (state=success total_count=1)`（API 认证已过），随后撞**既存** ② 移植 bug：`FileNotFoundError: /tmp/syno-mc.EpUFTT/pulls_p1.json` ⇒ `E_OPENPRS_EMPTY`，exit 2
  - **token 已进 Authorization 头**：假 curl（不出网）`AUTH=PRESENT`，输出/降级日志无 token 值
  - **配对测试** `tests/control-tower/check-merge-conditions-token.test.sh` ⇒ `结果: 6 通过, 0 失败`（Git Bash 与 WSL 两壳）；改坏必红：去第 4 级 ⇒ 9 失败；host 写死 ⇒ T4 红；取不到返 0 ⇒ T2 红
  - **判据未回归**（WSL 默认 `bash`）：`SELFCHECK-OK: 13/13`；`bash tests/control-tower/check-merge-conditions.test.sh` ⇒ `结果: 14 通过, 0 失败`
  - Git Bash 下 `--selfcheck`／主配对测试**既存红**（`SELFCHECK-FAIL: A`，12 处 ❌）——base `3ba60318a` 原脚本**同一条同样 12 处**（对照组实测），根因＝MSYS 把 argv 里 `/pulls/100` 转成 `C:/Program Files/Git/pulls/100`，属乙类 A-2 范围
- **回滚**: `git revert` 本提交即回三级链；`SYNO_MERGE_COND_CRED_TIMEOUT` 只影响第 4 来源；`E_*` 码与退出码语义未动。
- **边界**: 未 merge、未推 main、未碰阈值/退出码语义、未碰 `scripts/audit/**`；乙类一行代码未动；`gate-exemptions/` 新豁免文件需 `# review: <PR#>`（新文件首行强制）——待 PR 号后补，本批不伪造指针。
