---
状态: proposed
日期: 2026-10-17
决策: 新增 M6b「bundle 形态内容面判据件」probe —— 同 SHA 换形态（dev tsx / bundle dist/backend.mjs），主判据 hard = registered == E 且 errors == 0、soft = total >= E（E 由 extensions/sentinels/ 目录集派生，排除 shared 与 _ 前缀），不判 total === E；builtin 面单列另立；本 probe 不接 CI（接入时机 = P0 修法合并后）
理由: dev 绿 / bundle 红是「形态决定数字」（教训 123），而全仓此前不存在「bundle 形态真跑一次并数哨兵」的判据；/api/sentinel/reports 恒空无判别力，必须用 /api/sentinel/health 的 .summary.total；期望值写死会重犯 probe-content-registry 写死 20 的教训（裁定 150③）；total === E 会在 builtin 修好后误红，故降为 soft。
---

# Note: M6b bundle 形态内容面判据件（probe）

## 触发场景

- CTO 裁定 161（P0 评估验收）：dev 形态 registered=46/errors=0、bundle 形态 registered=5/errors=41；MVP「能测」明确红。
- CTO 裁定 162-D：先做 probe（可观测、不阻断），接入阻断的时机 = P0 修法合并之后。
- 派单件：`派单件/2026-10-17-派单-M6b-bundle形态判据件.md`（handbook 941a7fe）。

## 决策（口径，写死）

1. **期望值 E 由目录集派生**：`extensions/sentinels/` 顶层目录，排除 `shared` 与 `_` 前缀（`_extinct` 属之），且每目录须有可解析 `manifest.json`；代码内不出现期望值字面量。
2. **主判据（CTO 2026-10-17 放行修正 1）**：**hard** `registered === E ∧ errors === 0`；**soft** `total >= E`；**不判 `total === E`**（dev 的 total 含 builtin；bundle 现 builtin=0；`total === E` 会阻止未来 builtin 修复）。探针另行打印 `total` 与 `builtin 差`（`total − registered`）。
3. **builtin 面单列（放行修正 2）**：`builtins.ts` 按 `import.meta.url` 推 `adapters/` ⇒ bundle 下 builtin=0，独立于内容面；C4 只修 `extensions/` ⇒ 修好后 bundle.total = E+0 vs dev = E+4，两形态仍差 4；M6b 只判内容面，builtin 面另立。
4. **判别力自检**：dev 定标（scan/registered/errors 与 E 一致）＋ `--counterexample` 从已装载哨兵中**动态取**一个目录临时移走 ⇒ total/registered 各 −1，finally 恢复并核 manifest 哈希；看不到 / 解析不了 / 定标不一致 / 反例不成立 ⇒ **exit 2**。
5. **三态退出码** 0/1/2；**不接 CI**（bundle 当前红，接入会阻断全部 PR；接入时机按裁 162-D）。
6. **反例边界**：当前红态在册仅 5 个 ⇒ `5→4` 是**弱证明**；强证明（46→45）待 P0 修法合并后复跑。

## 依据（实测，as_of 44a30a572）

- 目录集派生：48 个顶层目录 − `_extinct` − `shared` = 46，且 46 个目录均有 manifest.json。
- dev：total=50（46 文件驱动 ＋ 4 builtin）／registered=46／errors=0。
- bundle：total=5／registered=5／errors=41（`builtinUnavailable=true`，动态 import 失败行 82）。
- 反例：移走 `competitive-moat` ⇒ total 5→4、registered 5→4、scan 46→45；恢复后 manifest sha256 一致。

## 相关件

- `scripts/control-tower/probe-bundle-content.ts`（本 probe，M6b 写集）
- `.claude/task-briefs/2026-10-17-M6b-bundle形态判据件.md`（卡面）
- 同族范式：`probe-exile-compile.ts`（自足/三态/fail-closed）、`probe-content-registry.ts`（期望值派生）

## 生效时点与后续

- 生效：probe 入工作树/PR 后即可复跑；当前默认模式 **exit 1**（记录红态），反例模式 exit 0（弱证明）。
- P0 修法合并后：复跑判定转绿；反例升级为强证明（46→45）；届时按裁 162-D 另开卡接 CI（先 warn 再阻断）。
