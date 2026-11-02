# K12-ENG P1-1：content-registry 探针去硬编码（#304/#305 修法）

- **状态**: implemented（2026-11-02）
- **任务**: #1271（K12-ENG）· 关联 #197（K12-14，已撤销）/ #304 / #305
- **决策**: 删除 `probe-content-registry.ts` 的硬编码"应为 20 项"，改为**注册表项集 == extensions 顶层目录集**的不变式
  （双向相等 + 项数相等）；配对测试防回归（禁 `!== N` 硬编码）。
- **理由**: 内容目录已 22，探测恒红（判据漂移）；DSH rc.5 "one home per fact"——目录集真源只有磁盘。
- **证据**: `probe-content-registry` ⇒ 退出码=0（四段全绿）；反例：临时加 `extensions/zz-probe-extra/manifest.json`
  ⇒ 退出码=1（"漏登记顶层目录" + "项数(22) ≠ 目录数(23)"）；配对测试 6/0。
- **回滚**: 还原探针单文件＋删配对测试。
