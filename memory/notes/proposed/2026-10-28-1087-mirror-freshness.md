# #1087 / W5：镜像新鲜度检查器（旧树假绿检测）

- **状态**: proposed（待 L1 收件闸 ＋ K3 抽检后转 implemented）
- **日期**: 2026-10-28
- **批次**: 门禁治理 v2.0 · W5（创始人 2026-10-28 批准规格）｜分支 `feat/1087-mirror-freshness`（base `a32efef5b`）
- **依据**: Issue #1087 ｜ 创始人规格 §3 W5 / §4 G5 / §5 M-5（sha256/16 `e13b4ecc2e5929a3`，**该件当前未入库**）｜ 裁 422-R2（判不了 ⇒ exit 2）

## 一、现状（做之前是什么样）

`git ls-remote origin refs/heads/main` = `1ca0d4dfc`，`git rev-parse gitea/local-main` = `a32efef5b`，
`git rev-list --count 1ca0d4dfc..a32efef5b` = **117**。GitHub 侧任何"已通过门禁"结论都对应 117 提交之前的树，
而**没有任何机器判据能看见这件事**——镜象状态只存在于人的记忆里。

## 二、决定（做了什么）

新增 `scripts/control-tower/check-mirror-freshness.sh`：只读比较 canonical 与镜象，三态输出。

- 0 = 新鲜（sha 相同）；1 = 不新鲜（behind / diverged / mirror-ahead）；**2 = 判不了**（ref 缺失 / 镜象不可达 / 镜象无 main / **对象不可见** / git 异常如 128）。
- 镜象两种取法：`--mirror-url`（live，`git ls-remote`，权威）与 `--mirror-ref`（离线 tracking ref，结论行显式标注"可能过期"）。
- 只报告不阻断（W5 原文：落后时周报标黄）。不 fetch、不 push、不写仓库内容；唯一落盘＝降级日志。

**不做**：不判"落后多少天"（不拿时钟当判据）、不看 main 以外分支/标签、不替代 CI。

## 三、依据（为什么这样）

- **判据必须机器可判**：W5 的敌人是"人在旧树上宣布通过"，不是"人不知道"——所以只回答"这棵树是不是最新的"。
- **判不了必须 exit 2**：裁 422-R2 同源。本批新增 `E_MIRROR_OBJECT_MISSING`：`ls-remote` 只给 sha 不搬对象，
  对象不在本仓时"落后 vs 分叉"不可分辨 ⇒ 不许猜（实测用例 ⑤b 覆盖）。
- **`@mutate-point` 判别力自证**：测试第 ⑨ 例把 fresh 判定改成恒真，落后用例随即变绿 ⇒ 证明第 ② 例的断言真的能抓改坏。

## 四、生效时点

PR 合入 `local-main` 后生效（脚本只读，无迁移、无回滚数据面）。未合入前本 Note 保持 proposed。
