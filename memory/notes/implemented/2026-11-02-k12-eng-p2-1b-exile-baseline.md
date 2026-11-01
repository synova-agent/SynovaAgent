# K12-ENG P2-1b：content-exile 探针内容类型基线改为注册表派生

- **状态**: implemented（2026-11-02）
- **任务**: #1271（K12-ENG）· 关联 #203（K12-20）／#480（content-exile）
- **背景**: P2-1 把 `content-layer` 转 reachable ⇒ 真装配类型 12→13；`probe-content-exile` 硬编码
  `CONTENT_TYPE_COUNT = 12`（as_of b8edf9860）⇒ 基线漂移红（与 K12-14 硬编码 20 同类病灶）。
- **决策**: 内容类型数**从 `describeContentRegistry()` 的 `reachable && loader!==undefined` 项数派生**
  （单一真源）；哨兵基线 46/45 仍保留（哨兵面未变）。测试同步派生（不再硬编码 12）。
- **理由**: DSH rc.5 "one home per fact"；判据应判「装配是否完整」，不是「恰好 12」。
- **证据**:
  - `probe-content-exile --case main` ⇒ 退出码=0；`[CHILD] sentinels=45 types=13`（派生值）；COVERAGE PASS=8
  - `vitest tests/control-tower/probe-content-exile.test.ts` ⇒ 12 passed
- **回滚**: 还原探针＋测试两文件（单点常量/断言）。
- **边界**: 只改基线来源；exile/restore/锁/子协议逻辑零改动。
