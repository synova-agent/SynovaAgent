---
状态: proposed
日期: 2026-10-20
决策: 门禁 0-2 补 remote 维度：只拦「gitea 的 refs/heads/main」；「mirror 的 refs/heads/main」放行，但带三条硬约束（ff-only／mirror-sync.log／推后核 SHA）。
理由: 旧判据只看 ref 不看 remote（pre-push-check.sh:75），把"同步只读镜像"与"直推真源 main"混为一谈——mirror 推送被自己人拦死（现场 dry-run 实测 exit 1，而 GitHub SSH 通道是通的）。
---

# 决策 Note — #657 门禁 0-2 补 remote 维度（裁 223）

## 九问（pre-plan-thinking，逐问有证据）

1. **问题**：0-2 判据对象错位——`PUSH_BRANCH_REF == refs/heads/main` 即拦，不看 remote；推 mirror（只读镜像）与推 gitea（真源）同罪。
2. **现状证据**：旧 `scripts/pre-push-check.sh:75-80` 只判 ref；卡 #657 现场 `git push --dry-run mirror HEAD:refs/heads/main` ⇒ exit 1；GitHub SSH 认证成功。
3. **有没有现成**：`grep -rn "mirror" scripts/` 无既有放行逻辑；0-1 已有"按被推 ref 判"（#617），remote 名 `$1`/`PUSH_URL` 已传入 ⇒ **扩展现有 0-2**，不新建脚本。
4. **最小改动**：0-2 分支内加 remote 判定 ＋ ff 校验 ＋ 日志 ＋ pending/verify 模式；**不动 0-1 与其余门禁**。
5. **最危险假设**：① remote 名 = `mirror`（`SYNO_MIRROR_REMOTE` 可覆盖）；② stdin 第 4 字段 remote sha 可信（#617 已建立契约）；③ ls-remote 可达（不可达 ⇒ 判失败，不静默）。
6. **失败路径**：non-ff ⇒ 1；删 main ⇒ 1；日志写失败 ⇒ 1（fail-closed）；核 SHA 不等/不可达 ⇒ 1；pending 缺失 ⇒ 1。
7. **边界**：只放行 `mirror` 的 `refs/heads/main`；gitea main 仍禁（含逃生舱语义不变）；feat/ 分支零影响；不改 0-1。
8. **可观测**：`mirror-sync.log`（ALLOW/REJECT(non-ff)/VERIFIED/VERIFY-FAIL）、`mirror-sync.pending`、stdout、三态退出码。
9. **拆步**：① 0-2 remote 判定 ② 日志 ③ pending＋`--verify-mirror-sync` ④ 夹具（六判据＋两变异）⑤ 回归（push-sync-guard 21/0）。

## 决定
- remote == mirror ∧ ref == refs/heads/main ⇒ ① ff-only（remote sha 全零=新建，视为 ff；删除拒）② 写 mirror-sync.log（时间|verdict|from|to|remote|user）③ 写 pending ＋ 提示推后核。
- 推后核：`bash scripts/pre-push-check.sh --verify-mirror-sync` 读 pending → `git ls-remote <url> refs/heads/main` → 等 ⇒ 0（清 pending）；不等/不可达 ⇒ 1。
- 其他 remote 的 main ⇒ 旧行为（拒，逃生舱保留）。

## 依据
- 卡 #657（裁 223，A 类 CTO 已批）＋六判据＋改坏必红。
- 夹具 `tests/control-tower/pre-push-mirror.test.sh`：24 通过 / 0 失败；M1（remote 判断写反）→ mirror 变拒；M2（去掉 ff 检查）→ 0-2 理由消失（0-1 兜底）⇒ 判别力成立。

## 影响面
- 只动 `scripts/pre-push-check.sh`（0-2 段）＋新增夹具；0-1/其他门禁零改动；mirror 推送从"误拦"变"可控放行"。
