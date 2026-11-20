---
状态: implemented
日期: 2026-11-20
决策: host 侧新增 runtime-bundle sha256 生产者脚本，由 Start-DshSandbox 注入 SandboxLifecycle；lifecycle 只在 FINISHED 收尾记录该值，不自己算业务产物哈希。
理由: #1434 的 handoff 被 HANDOFF_ORCHESTRATION 阻塞，根因是 orchestration.runtimeBundleSha256 全链无生产者；计算留在 host 侧、状态机只传值，既补上生产者又不让状态机承担产物语义。
---

# build 侧 runtimeBundleSha256 生产者（#1446）

- **现状**（base `851b8900`，`git grep -n` 复核）：`New-DshSandboxConfig.ps1:270` 置 `null`（PREPARED）→ `SandboxLifecycle.psm1:224` 复制 `$state.runtimeBundleSha256` → `New-Orchestration :75` → 写盘 `:342`（FINISHED）`/:374`（DESTROYED）；全链无赋值。消费侧 `Complete-DshBuildHandoff.ps1:116` 要求非空、`:183` 校验 bundle 哈希，故 build 段每次都在 handoff 处被拒（#1434 评论 13751）。
- **决定**：新增 host 侧脚本 `scripts/dsh-sidecar/sandbox/Get-DshRuntimeBundleSha256.ps1`（`-OutgoingDir` ⇒ 存在 `runtime-bundle.zip` 时输出 64 位小写 hex，不存在不输出任何值）；`Start-DshSandbox.ps1` 在 build 模式注入 `-RuntimeBundleSha256ProviderPath`，probe 模式不注入（probe 的值来自 `handoff.json`，见 `New-DshSandboxConfig.ps1:276`）；`SandboxLifecycle.psm1` 仅在 `state=FINISHED` 时调用该生产者并把返回值写进 `runtimeBundleSha256`，生产者给非 64-hex 值 ⇒ 状态 FAILED + `failure.json` 的 `RUNTIME_BUNDLE_HASH_INVALID`（不写伪造值）。
- **依据**：Issue #1446 §3 分工（计算在 host 侧收尾、lifecycle 只写值、handoff/probe/Test-DshEvidence 校验不动、PREPARED `null` 语义不动）；`git grep -n 'runtimeBundleSha256'` 复核了 224/75/342/374、103/116/183/220、91/104/125/137/148 全部行号与 #1446 正文一致。
- **生效时点**：本 Note 随 #1446 实现提交后生效；#1434 重跑（Fetch→build→handoff→probe→Test）须等本 PR 合并进 main 后由 CTO 重发 Mandate，本票不自行重跑 build。
- **证据**：`npx vitest run tests/runtime/dsh` ⇒ 21 files / 149 tests passed（基线 21/143，新增 6 条：生命周期 3 + 生产链 3）；`npx tsc --noEmit` ⇒ exit 0。改坏必红：①生产者写常量 ⇒ 2 红；②计算移进沙箱入口脚本、host 无生产者 ⇒ 5 红；③放宽 handoff 校验 ⇒ 3 红（`HANDOFF_COPY_HASH`/`HANDOFF_BUNDLE_MISSING` 替代原期望码），逐条还原后复跑 21/21 绿。
- **边界**：不改 `Complete-DshBuildHandoff.ps1`、`Test-DshEvidence.ps1`、`Invoke-DshSandboxProbe.ps1`、`Invoke-DshSandboxBuild.ps1`（沙箱内脚本零改动）、`New-DshSandboxConfig.ps1` 的 PREPARED null 语义、`src/**`、`electron-renderer/**`、门禁与迁移；未碰 #1434 任何证据与 `~/.dsh*`。
