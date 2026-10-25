# #1002 纪律落地批（裁 421）

## 1) CI 空绿兜底（修假绿）
`local-gates.yml`：新增 `N_SRC_TS`（变更集中 `src/**.ts` 个数）。
判据：`N_VITEST==0 且 N_SRC_TS>0` ⇒ **exit 1**（生产代码改动必须带测试），不再落入"合法跳过（不可测面）"。

## 2) Q-10 接线（①g）
新增 CI 步 `①g 测试义务闸`：`check-test-obligations.py --base "$BASE"`；回滚点 `SYNO_TEST_OBLIGATIONS=0`。
（baseline 已在 #1001 修为 470）

## 3) 裁 409 降级机制
`pre-commit-check.sh` 新增 `_downgraded()`：Task Brief／文件驱动架构／V3 流水线健康度／技能同步一致性
在 `SYNO_CI=1` 下**只报不拦**；回滚 `SYNO_GATE_STRICT_LEGACY=1`。

## 已知限制（如实）
P3 的两态判别证据**尚未取得**：我造的 `export type DemoOntologyType = 'a'|'b'` 未能触发组 8，
故"降级前红/降级后黄"的对照**未复现**——需在 #1002 后续用真实夹具补。
