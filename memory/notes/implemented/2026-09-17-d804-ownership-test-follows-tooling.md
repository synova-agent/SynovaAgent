---
状态: implemented
日期: 2026-09-17
决策: ownership.yaml 增补两条 mac 规则 —— `tests/golden-scenarios/**` 与 `tests/electron/**` 随**其被测工具链**归属（`scripts/golden-scenarios/**` 与 `electron/**`，二者早已显式归 mac）；`.github/CODEOWNERS` 按 drift 门禁同步重生成
理由: D804（M1 线1 桌面端 + 线6 首诊端到端）spec §12.1 写集 13 条在补规则前横跨 mac/win 两域，D734「一个 PR 只许一个域」会把该卡**全部 6 片**逐片拦死——而这是**兜底误判**（两条 tests 路径未被显式列出 → 落 `**` 兜底判 win），不是真跨域：干活的是 mac 线，测试只是同一工具链的测试。既有派生先例已两次确立「测试随被测工具归属」（tests/control-tower/** L106、tests/doc-system/** L85），本条只是把同一派生补齐到 golden-scenarios/electron 两侧。
---

## 触发场景

D804 切片 0 交付前跑 CI 等价门禁（`SYNO_CI=1 SYNO_DIFF_BASE=origin/main bash scripts/pre-commit-check.sh`），13 组中 12 组全绿，唯一红 = D734「② 变更跨域」：

```
mac  scripts/golden-scenarios/**        (7 个)
mac  electron/**、scripts/product-lines/**
win  tests/golden-scenarios/**          ← 落 ** 兜底
win  tests/electron/**                  ← 同上
win  scripts/desktop/**、docs/synova/runbooks/**
```

## 判定过程（D333 四步）

1. **第一性原理**：D734 的目的是回答「这条 PR 属于哪条线」。测试不是独立信号——它跟随被测工具链。`scripts/golden-scenarios/**` 与 `electron/**` 归 mac 已无争议，其测试却因**未被显式列出**落兜底判 win，属类型错误而非真跨域。
2. **Anthropic 工程基线**：fail-closed 应保留真跨域拦截。验证：`tests/control-tower/check-ownership.test.sh` 的 D728/D729 真回归用例（Win 源码派给 mac）在补规则后**仍全红**（51 项测试全过，含「豁免不掩盖真跨域」）。
3. **开源/仓库实证**：同族先例两次——`tests/control-tower/**`（L106）与 `tests/doc-system/**`（L85，注释明写「D782 PR-2/PR-4 CI 实测落兜底误判 win」→ 同 PR 内补规则）。
4. **收敛**：三条参考系同向 → 按 D782 先例补规则。

## 范围收窄（刻意，非疏漏）

仅补 **切片 0-2 实际需要**的两条。另两条经实测**不补**：

- `docs/synova/runbooks/**` —— 该目录**同时含** `founder-demo-mac.md` 与 `founder-demo-win.md`，整体改判 mac 会**错判 Win 线文档**。需按文件粒度或另行设计，属切片 3 范围（且切片 3 与 D747 claimed 写集重叠，待 CTO 裁决）。
- `scripts/desktop/**` —— 内容确为 mac 桌面端工具链（含从 Mac 侧驱动的 `win-install-verify.ps1`），归属清晰；但切片 0-2 **不修改**该目录，故本次不补，留待授权切片 3/5 时一并处理。

## 参考

- D782 先例：`ownership.yaml` L85-87（tests/doc-system 派生 + CI 实测误判记录）
- D758 先例：`docs/synova/product-lines/evidence/**` 域判定豁免（同族「路径归属跟干活那条线走」）
- 相关 D#: D804（本卡）· D733（ownership.yaml 机器化）· D734（PR 预算/单域门禁）· D782 · D758
