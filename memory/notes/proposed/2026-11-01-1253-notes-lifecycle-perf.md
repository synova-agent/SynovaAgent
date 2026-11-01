# #1253 notes 生命周期门禁：逐文件 spawn → 单进程解析（P0 性能修复）

- **状态**: proposed
- **日期**: 2026-11-01
- **批次**: P4 门禁自身可靠性批次 **T1**（#1255）｜分支 `ct/1253-notes-fast`
- **授权**: CTO 会话（创始人外出前口令「长时任务」）｜判据源：GATE-STANDARD v3.1 §十二 ⑨（墙钟）

## 一、现状（修前实测）

- `check-notes-lifecycle.sh` 逐文件 spawn 子进程（每文件 6 次 `grep`/`head`）：
  本机 **219 条** note ⇒ 约 **1300 次**进程启动。
- `bash -x` trace：**45 s 仅处理 18 个文件**；带 `timeout 90` 实测 **rc=124（未跑完）**。
- 后果：每次 `git commit`（含 merge 提交的 pre-commit）被拖到**分钟级**；今日 #1242 的 merge 提交实测约 20 分钟，
  被迫用 `SYNO_NOTES_DIR` 注入缝绕行（裁定 429-E）。脚本头自述「保持 <1s」——它违反了自己的契约。

## 二、决定

- 核心改**一次 python 进程**解析全部文件（枚举/D#提取/task-state 读取全在一次进程内）；
- 补 `timeout`（`SYNO_NOTES_TIMEOUT`，默认 30 s）：超时 ⇒ **exit 2 + `degraded: E_TIMEOUT`**；
- 缺 python（三级探测）⇒ **exit 2 + `degraded: E_NO_PYTHON`**；
- **契约不动**：0/1/2 三态、四态输出文案、`ROOT`/`TASK_STATE_DIR`/`SYNO_NOTES_DIR` 注入缝全保留。

## 三、依据与证据

| 场景 | 修前 | 修后 |
|---|---|---|
| 真实仓库 219 note | >90 s（rc=124） | **1.11 s**（rc=0） |
| 200 note 沙箱 | 5.4 s（且随文件增大线性恶化） | **0.49 s** |
| `grep` 启动次数（200 note） | ≥600 | **0** |
| `timeout` 注入 rc=124 | 无该分支 | **exit 2 + E_TIMEOUT** |

配对测试 `tests/control-tower/check-notes-lifecycle.test.sh`：**23 通过 / 0 失败**
（原 18 例全保留 ＋ 新增 5 例：性能回归用**进程启动次数**断言＝跨平台确定，超时降级用假 `timeout` 注入）。

## 四、边界与失效条件

- 本件只改**实现与降级路径**，不改僵尸判定口径（D# 提取／status 白名单 `impl_done|spec_done` 一字未动）。
- `timeout` 不在 PATH 时退化为裸跑（已知限制，写入脚本头）；Windows 由 Git for Windows coreutils 提供，CI（mac）自带。
- 若将来 notes 量级到万级，单进程 Python 仍成立（O(N) 读文件），但目录枚举可能需分片 —— 届时另卡。
