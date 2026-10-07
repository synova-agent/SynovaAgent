# V5 · `verifier` 字段与「判据落地方 ≠ 实现者」实测

## 命令

```bash
$ node --experimental-strip-types docs/synova/product-lines/evidence/V3V4V5/v5-verifier-sample10.ts
```

## 原始输出

```
| # | item | worker(派给谁) | verifier(判据落地方) | ≠ ? |
|---|------|---------------|---------------------|-----|
| 1 | 0-1 | win | cto | YES |
| 2 | 0-5 | win | mac | YES |
| 3 | 0-11 | win | mac | YES |
| 4 | 1-3 | win | mac | YES |
| 5 | 1-8 | win | cto | YES |
| 6 | 2-3 | win | mac | YES |
| 7 | 3-1 | win | mac | YES |
| 8 | 3-6 | win | mac | YES |
| 9 | 3-10 | win | mac | YES |
| 10 | RB-01 | win | k3 | YES |

抽样下标 = [0, 4, 9, 13, 18, 23, 27, 32, 36, 41]（等距，非手挑）
verifier !== worker : 10/10 = 100%
阈值 80% ⇒ PASS

全量口径（46/46 项）= 100%；`none` 计数 = 0（本字段无 `none`：`none` 是风险标记，不是达标手段）
```

## 字段语义（登记件 JSDoc 逐字）

- `worker` = **派给谁做**（实现者；CTO 派单时指定）
- `verifier` = **判据由谁落地**（核验者；跑判据、签结论的那一方）—— 必须 ≠ 实现者（判例 V-03）
- 取值域 `'cto' | 'win' | 'mac' | 'k3' | 'gov' | 'none'`；`'none'` = 尚未指派独立核验方 ⇒ **风险标记**，不得读作"已独立验证"

## 赋值规则（可复核，实现在 evidence 目录 `assign-verifier.codemod.mjs`）

依据 **TASK-ROUTING.md v4 §一「模块所有权表（唯一权威）」**：

| 规则 | 触发 | verifier | 依据 |
|------|------|----------|------|
| R1 | block = K11，或判据件在 `tests/security/**` | `k3` | 审计线：验收（第三方审）；`scripts/audit/` 归 K3 |
| R2 | 总闸 0-1 / 0-2，或承重件 1-8 / 1-9 / 2-1a / 2-1b / 2-6 | `cto` | 方向级（主 CTO 盯全局） |
| R3 | 判据件在 `scripts/control-tower/**` ｜ `docs/synova/coordination/**` ｜ `scripts/golden-scenarios/**` | `mac` | 该三目录模块所有者 = Mac DSH |
| R4 | 其余（`tests/**` 或数据断言） | `mac` | 异机独立跑（≠ 实现者 win） |

## 🔴 诚实边界（必读）

1. `verifier` 是**登记值**（登记 ≠ 派单）—— 由 CTO 派单时确认或覆盖；本卡不改派单决定。
2. 阈值「`verifier !== worker` ≥ 80%」只是"未自我认证"的**必要不充分**条件：
   比值达标 **不等于** 判据有效 —— 判据是否成立由 `verification`（L1/L2 + baseline）承载。
3. 全 46 项 `worker` 均为 `win`（实测），故本比值恒等于"非 win 占比"；本卡取值 0 个 `none`，
   **未用 `none` 抬高比值**（若用 `none` 充数，比值达标但语义为空 —— 判例 P-04）。
