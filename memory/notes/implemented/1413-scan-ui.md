---
状态: implemented
日期: 2026-11-18
决策: 以服务端授权的只读清单和 renderer 最小状态机接通首次企业扫描，不接 DSH／SSE／实时进度／取消或真实 JWT。
理由: 既有扫描 POST／GET 已具备授权、幂等与报告契约，但用户无法发现可发起清单，renderer 也没有可达视图。最小闭环需要补齐真实导航、清单、扫描和可见结果，同时保持服务端为唯一权限权威。
---

## 现状

固定 base 为 `2cde2320224f930b4769315edf1396b25157cad7`。实施环境为 Windows／Git Bash，Node `v24.16.0`、npm `11.13.0`。DEV DOC v4 评论 13049 的字节数与 SHA-256 已按固定记录 13052 核验，执行依据为 Mandate 评论 13053。

## 决定

- 清单端点只返回 `manifest_id/display_name`：store 按 graph 去重升序枚举，service 复用 `listAuthorizations` 与 `canViewSource`，不做 preflight、文件 IO 或业务写入。
- renderer loader 使用白名单递归形状守卫，网络、非 JSON、意外 404、非法报告与 5xx 均显式降级；扫描提交结果未知时保留原 `client_request_id` 对账。
- Zustand 保留清单、选择、在途 Promise、请求编号、runId 和报告；离开／返回不重复 POST，已知 runId 无报告时经 GET 恢复。
- `LeftPanel → App → ScanContainer → scan-store → loader` 是唯一真实导航链。面板只呈现服务端值，不按角色过滤、不补零、不推断隐藏数量。
- 不使用真实客户数据、Secret、真实模型外发、生产 DB、真实 JWT 接线或实机 Electron 点击；测试只用合成材料、独立 SQLite 与合成 JWT。

## 依据

- 真 `createServer`／JWT／socket 集成测试覆盖角色矩阵、空清单、缺 sub=401、缺 orgId=403、跨企业与不可见 id、fail-closed、零泄露和零写入。
- 同一集成文件的隔离 DevMode 环境使用 renderer loader 完成清单 GET→POST 201→同键 replay 200→GET，未发送自报身份头。
- loader 测试覆盖完整报告的逐字段删除、嵌套类型、nullable 边界、重复清单 id、错误信封和网络降级；store spy 覆盖在途去重与同键对账；渲染桥只用于纯面板，未宣称实机交互。
- 实际变异已取得失败证据：route 200→404、store graph 泄露 `foreign-id`、组合摘除导致跨企业清单泄露、删可见性过滤泄露 hidden id、额外 `total` 破坏精确形状、LeftPanel／App／Container／三类 loader 接头摘除、递归守卫、错误折空、响应丢失换键及假进度。全部变异后恢复并重新跑绿。
- 定向收口：195 项新测试、89 项既有扫描回归、50 项 renderer 验收通过；后端与 renderer 类型检查、架构边界通过；`check:iron-laws` 全部 11 组通过。
- 全量 `npm run test` 实跑到结束：30 个文件／83 项失败，789 个文件／6971 项通过、27 项跳过；新增测试在全量中均通过。失败位于写集外，含 Windows 可执行位与权限语义、依赖未提交状态的 zero-code 验收、base 内容词表漂移等；`d752-type-net-gate` 单独复跑通过。不得据此声称全量全绿，也不扩大写集修复。

## 生效时点

本 Note 随 #1413 实现分支提交生效；PR 只停 review，不代表已合并、独立复核、实机验收或部署。最终全量测试、提交端门禁与 head CI 结果以 #1413 回执和 PR 实物为准。
