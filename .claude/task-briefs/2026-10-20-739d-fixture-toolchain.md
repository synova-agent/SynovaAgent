# Task Brief: P4 · #739 ④ 夹具统一工具链

#CRITERIA: D

## Q0: 定位（项目拼图 + 文件审计）
- 夹具依赖无声明（@requires=0）；缺依赖只报"门禁判不了"；tsx 靠 ci.yml:1183 单点补。
- 相关件：`scripts/control-tower/`（新清单/核对）｜`.github/workflows/ci.yml`（安装步）｜`tests/control-tower/`（配对夹具＋范本声明）。

## Q1: 调研（决策链 / 既有基础）
- 判据纪律⑨：验证结论要能独立复核；#665/#736 是单点，本卡升机制。
- 无既有机制；167 个 shell 夹具中 42 用 python3、3 npx、2 sqlite3、1 tsx。

## Q2: 范围（做什么 / 不做什么——含文件路径）
做什么：
- scripts/control-tower/check-fixture-requires.sh
- scripts/control-tower/fixture-toolchain.txt
- scripts/control-tower/fixture-requires-baseline.txt
- tests/control-tower/check-fixture-requires.test.sh
- tests/control-tower/precommit-groups-injection.test.sh
- .github/workflows/ci.yml
- gate-exemptions/2026-10-20-fixture-toolchain-739.md
- docs/authority/DOCS-REGISTRY.yaml
不做什么：
- scripts/audit/**
- 任何既有判据的"该红/该绿"语义

## Q3: 验收（入口 → 交互 → 结果）
- 入口：`bash scripts/control-tower/check-fixture-requires.sh`；`bash tests/control-tower/check-fixture-requires.test.sh`
- 交互：声明→清单→可执行；未声明使用静态扫；存量基线
- 结果：全仓 OK（174/0/0/79）；配对 10/0；范本夹具仍绿。

## Q4: 契约与测试
- 清单格式 `bin | kind | spec | note`；kind=npm 由 CI 安装；runner 只核对。
- 退出码 0/1/2；缺依赖 exit 2 且写明 bin 名。

## 本任务在哪一层
- 治理线 / 门禁（夹具工具链）；不涉产品运行时。

## Done 标准（至少一条可验证）
- [ ] 全仓核对 OK → `verify: bash scripts/control-tower/check-fixture-requires.sh`
- [ ] 配对 10/0 → `verify: bash tests/control-tower/check-fixture-requires.test.sh`
- [ ] 范本夹具仍绿 → `verify: bash tests/control-tower/precommit-groups-injection.test.sh`
