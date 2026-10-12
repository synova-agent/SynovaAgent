---
状态: implemented
日期: 2026-10-12
决策: |
  K12-17（#200）引擎码归位 —— ① notifications 4 个 adapter `.ts` 搬 `src/notifications/`（json 留原地），
  loader 改为「宿主实现优先 ＋ 内容侧声明回退」的双位置解析；② **adapters 的 2 个 adapter 撤出本卡**
  （门禁三条硬阻断实证其为死码、接活须改装配语义 ⇒ 另立卡）。
理由: |
  ① **为什么 notifications 必须动 loader（Y2），而不是只搬文件（Y-lite）、也不是改 manifest（Y1）**：
     实测两侧后果相反 —— `src/l4/adapter-loader.ts` 全文件 `grep -c "import("` = 0（只 `JSON.parse` manifest），
     故 adapters 侧搬走 `.ts` 无运行时空指针；而 `src/notifications/notification-loader.ts:43,49` 真
     `import(pathToFileURL(join(dir, name, manifest.entryPoint)))` ⇒ 只搬文件必然指空：
     实测 `NOTIF_REGISTERED` 4 → **0** ＋ 4 条 `entryPoint 不存在`，4 个通知渠道**静默失效**
     （有 log/errors、不崩 —— 合规铁律 11/24，但正是本卡要治的"客户以为配好了"）。
     **否决 Y1**（改 manifest 的 entryPoint 指向 src/）：把 `src/…` 写进**客户可改的 json**，
     而 CC1 只扫 `extensions` 下 `.ts` 的 import、**不扫 json 里的路径串** ⇒ 造一条**门禁零覆盖的引擎注入通道**；
     且相对深度（`../../../`）写错即静默降级成"注册 0 条"。**造洞 ＞ 冲击面**（CTO 2026-10-12 裁定）。
  ② **为什么 adapters 2 件撤出**：搬入 src/ 后 pre-commit **三条硬阻断**全部落在它们身上
     （组 2「新文件配对」＋「跨模块集成」＋ 组 4「新 export 必须被引用」）。
     实证它们是**死码**：`git grep -n "feishuAdapter\|nemoclawAdapter"` 全仓仅 4 条（自身文件 ＋ manifest 的 exportKey）；
     `git grep -n "new FeishuConnector\|new NemoClawConnector"` **零命中**（连 connector 本身都无实例化点）；
     `grep -c "import(" src/l4/adapter-loader.ts` = 0。
     ⇒ 补测试 = 测试守护**没人调用的代码**（V-07 型假绿）；把死码引进 src/ = 铁律 37。
     ⇒ "接活"= 接线 = 新能力，必然改 `adapter-loader` **装配语义** ⇒ 接口/装配面变更 ⇒ 须 CTO 授权，本卡无权。
     ⇒ 今天**零危害可防**（死码 ⇒ 客户删 `extensions/adapters/feishu/` 不丢任何引擎功能）⇒ 延后搬零代价。
  ③ **本卡暴露的架构发现（"搬进来门禁才看见"）**：`pre-commit-check.sh:617` STAGED_SRC =
     `grep -E '^src/|^tests/|^packages/|^scripts/'`、`:912` STAGED_ALL_FILES = `grep -E '^(src|packages)/.*\.ts$'`
     ⇒ **`extensions/` 不在扫描面内** ⇒ 引擎码待在 extensions/ 时对「测试配对」「接线审计」**完全隐身**。
     旁证：`docs/synova/audit/SYNOVA-AUDIT-BASELINE-20260801*.txt:547` 早已记
     「`src/connectors/nemoclaw.ts`: export NemoClawConnector -- WARNING: no callers in src/」。
     ⇒ 连接器**装配面整体未接线**（loader 只读 manifest、无人实例化 connector、adapters 无消费者）⇒ 另立卡。
  ④ **扩写集三件齐（相对卡面 §Q2，CTO 三档纪律 B 档）**：
     `src/notifications/notification-loader.ts`（改解析，1 处模块私有函数，未新增导出以免"未接线 export"）、
     `tests/notifications/notification-loader.test.ts`（空壳断言修强：原文 `toBeGreaterThanOrEqual(0)` **0 也绿**）、
     `scripts/control-tower/probe-notification-registry.ts`（新增真测量件，按 #205 探针契约：
     `--all`/`--case` ＋ 末行 `RESULT=` ＋ rc 三态 ＋ `export TARGETS`）。
     本 Note 自身亦为扩写集第 4 件（D534 要求治理脚本区变更须引用 Note）。
     代价：文件驱动纯度下降（新增内置渠道 = 声明(json) ＋ 实现(src ts) 两处）；两条通路语义暂不对称
     （adapters 只读 manifest；notifications 双位置解析）⇒ 后续卡应统一，勿当成"已一致"。
  ⑤ **cwd 陷阱（写死于测试/探针注释）**：loader 两个扫描根都是 `join(process.cwd(), …)`
     ⇒ cwd 非仓根时 `registered` 恒 0。实测 cwd=/private/tmp ⇒ 0 ＋「通知目录不存在」；cwd=仓根 ⇒ 4。
     故判据必须先断 cwd/`existsSync(NOTIFICATIONS_DIR)`，否则新判据自身即"恒 0 假绿"。
  实测（锚 ba1b22a8b）：搬前 `registered=4`，渠道 `["email","feishu-approval","jira","linear"]`；
  宿主 stub 对照（sim2）证明解析**真落 src/**（渠道名变 `HOST-STUB-*`）；
  内容侧 stub 对照（sim3）证明回退位未回归（`CONTENT-STUB-*`）。
---
