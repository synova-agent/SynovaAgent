# D1002 PLAN v1.3（定稿 · 创始人 2026-09-25 裁定通过）

> 载体：.synova-wt-d1002 / fix/d1002-workspaces-route-order；base = feat/d947-middleware-default-posture @ 8b6c95dd（栈式，D947 PR-2 进 main 后 GitHub 自动改指）；domain:"win" + owner_side:"win"。
> 判据谱系：一页 PLAN（D950 期）→ 三席交叉验证（自验 15/15 成立 / 编码可实施性 6 项 + R1-R6 / 复核对账 A–H 0 退回点）→ 附条件三条（创始人）→ 必改一条照抄替换（◆F1 弃 syntheticRbac）→ 补充三条 → gate 改判（栈式 8b6c95dd，回执基准即此 SHA，禁用本地 main）。

**§0 时序**：原硬 gate「#754→#755 合并进 main」已由创始人改判失效（Mac 侧系统性问题，非本队能推动）；实施 base = 8b6c95dd（栈式，先例 D773/D803）。行号 = ef5c8caa 实测（8b6c95dd 关键文件零差异已实测）。若 D947 PR-2 因 CI 返工重写，本卡 rebase 按 CTO 指令处理，不自行 force push。

**前提实测**（三席 15/15）：workspaces-api.ts 343 行（派单 344=±1 计数口径差→回执登记）；/conflicts :294 `(_req,res)` 零守卫，与 /mine :264 同被 GET /:id(:126) 遮蔽→HTTP 恒 404；/by-dept/:dept :255 两段式实测未被遮蔽（前移=防御性卫生）；守卫=本文件 :54 requireVerifiedRbac（D947 唯一漏斗 fail-closed）；app.use(jwtAuthMiddleware) 实挂 server.ts:344（auth.ts:82 注释"315"陈旧，移出本卡）。

**① 路由新旧下标（0 基 11 条；三块整体上移至 :126 之前，块间相对序不变）**：
GET /(:92，F-5 不动) 0→0｜POST /(:99) 1→1｜GET /by-dept/:dept(:255) 7→2｜GET /mine(:264) 8→3｜GET /conflicts(:294) 9→4｜GET /:id(:126) 2→5｜PUT /:id/status(:133) 3→6｜POST /:id/messages(:170) 4→7｜GET /:id/context(:198) 5→8｜POST /:id/sub(:219) 6→9｜PUT /:id/merge(:320) 10→10。
F3 双探针成对：源码腿=readFileSync+**注册行全字面量** needle（如 `router.get('/api/workspaces/:id'` 含闭合引号，唯一命中；或行过滤 `^router\.(get|post|put)\('` 比位次）——裸路径 indexOf 会被 :116/:6 注释裸路径假绿（M1 不红），禁用；先例=middleware-order P4/I4(:139-162)。运行时腿=router.stack 层下标（11 层全 route ⇒ stack 序=注册序；先例 loadMineHandler :338-350）。

**② /conflicts 守卫（先加守卫、后放开遮蔽，两步同一 commit 不拆）**：插入 :294 handler 首行；签名 `(_req`→`(req`；复用 :54 requireVerifiedRbac；形态 `if (!requireVerifiedRbac(req, res)) return;`（不消费上下文的读端点短式；tsconfig 无 noUnusedLocals、.eslintrc no-unused-vars=warn+argsIgnorePattern，零 lint 风险——编码席实测）；:51「形态固定」注释同步 +1 行收录短式（防文档漂移）。效果：HTTP 无凭据→401（server.ts:344 全局门先拦，先例 middleware-order N1）；直接 handler 无 rbac→403；合法 JWT→200。

**③ E-2：/merge(:320) canModifyWorkspace 前移到形状校验之前**。现序 rbac(:322)→形状400 `!ws||!ws.parentWsId`(:327)→parent 404(:330)→canModify(:332)；新序 rbac→`ws=store.get(id)`→`canModifyWorkspace(rbac,{department:ws?.department,owner:ws?.owner})`→403→形状400→parent 404→变更。语义：低权（staff/ga/liaison/非属主 manager——基线 rbac.ts:127 恒无部门，无"异部门"物种）任何 id 形态先吃 403，不泄露存在性/形状；admin 才落 400/404 层。

**④ 三个变异体（F6；串行；红态原始输出+真实退出码+还原后 git status 空）**：M1 移回顺序（三块移回 /:id 后）→F1 红（/mine HTTP 复 404）+F3 红（源码+运行时双腿同红）+【附条件1】哨兵红（/by-dept/context 复 404）；M2 去守卫（删 ② 调用，保新序）→F2 红（判别性腿=**F2-P** 直接 handler 探针无 rbac fail-closed 断言得 200 而非 403，非合成身份注入；HTTP 面仍 401 不受骗）；M3 权限回退（canModify 移回形状校验后）→F4 红（staff 打非子 id 得 400 而非 403）。

**⑤ 受影响既有夹具（workspace-access-write-endpoint.test.ts，537 行）**：:323-336 注释块（"恒404/CTO 裁定另立卡/本卡不修 ordering"）按 D1002 已修口径整块改写；:425-432 登记性断言 expect(404)→expect(200)（:335 原文自证"须翻转为 200，不得静默改动"；断言+注释**同步改写，不留旧注释**）；:420-423（无凭据→401）不变；:4/:20 头注释核对不动。冲突扫描（完整输出入回执）：tests/ 共 13 处仅两文件——middleware-order:184 断言无凭据 401（认证层先于路由）不受重排影响；唯一外部消费者 department-workspace.ts:89 为浏览器侧 fetch，404→401 两态同落 catch（D947 L-11 已登记）⇒ 写集 4 件不扩。

**【补充1】F-3 注释订正（并入本卡写集）**：workspaces-api.ts :278 `// R5/REV-8: JWT 载荷无 department ⇒ 恒 undefined（已登记功能回退）` 改为注明「原恒 undefined（D947 期口径）；D1000 切片 A 起由 JWT 携带——届时以身份链为准」；卡内登记（创始人 2026-09-25 裁定，不另开卡、不扩写集）。

**◆F1（裁定，照抄创始人原文）**：HTTP 面只断真实可达的语义——≠404 + role + 属主可见集 / global 可见集（这三条在基线走真实路径：过滤退化为全量、或 role 写错，必红）。部门分支本卡完全不覆盖（HTTP 面与 handler 面都不验），不使用 syntheticRbac 注入 department。若确需一条部门相关断言，唯一允许形态 = 真实 JWT 链（jwtAuthMiddleware + rbacMiddleware + 抽出 handler）+ 断言基线事实（无部门 → 部门分支 inert），注释必须写明「现状锁定，非功能验证」。部门可见性语义归 D1000 身份链后继卡。——执行决定（创始人批准并记正向）：本卡不采纳该可选用例，部门分支零断言、零覆盖。

**边界四值（/merge，staff 低权 + admin 对照各一脚）**：id 空串→403/400｜不存在→403/400｜存在但非子→403/400（F4 主断言）｜存在且无权限→403；正路径属主 manager 汇入自有子→200。

**F5 三路径**：正常（合法 JWT 全绿腿）；降级=同实例 try/finally env 翻转（env 逐请求读 auth.ts:50/:349；vitest.config 全局 DEV_MODE='true' 须夹具覆写 'false'+JWT_SECRET≥16 字符）：删 JWT_SECRET+携任意 Bearer→401+body{code:'UNAUTHORIZED',message:'JWT_SECRET not configured'}+日志留痕 AUTH_UNAVAILABLE（level=error；vi.mock('@synova/logger') 捕获，先例 auth.test:25-41/:493-523，mock 补 fatal/trace 空实现）；边界=四值+/mine、/conflicts 空 store+【附条件1+2】dept='context' 病态哨兵：携合法 JWT GET /api/workspaces/by-dept/context → 断言 **200 + body.department==='context'**（前移后 by-dept/:dept 优先于 /:id/context），注释写明「**有意：by-dept 优先**——回退注册序将静默翻回 404，本断言即哨兵」；该用例原始输出整段进回执【附条件2】。

**行数预算**：343+≈11（守卫+注释+F-3 订正净≈0+哨兵在测试文件）≈354<500 ✓；server.ts/auth.ts 零改动（auth.ts 由 D1000 切片 A 持有，同文件双写者禁）。

**未清项（回执强制原文）**：① auth.ts:82 陈旧注释（等 D1000-A 合后随下卡）；② 渲染层 15 fetch 点（D1001/mac 域另卡）；③ **F1 部门分支在 D1002 内完全未验证——既未在 HTTP 面验证、也未在 handler 面验证；不采用合成 ctx 证明。部门可见性语义归 D1000 身份链后继卡。**；④ ±1 行数口径差（登记）+ GET /by-dept/context 退化翻转已由哨兵锁定（不再是未清项）；⑤ 派单件指纹锚 124d41dc（docs/d949-d950-dispatch 尖端；派单件落 main 前不引用其路径）；⑥ 栈式风险：D947 PR-2 若因 CI 返工重写，本卡 rebase 按 CTO 指令处理。

**回执纪律【补充3】**：「已验证」一律**分行写面**——每条判据按「面（HTTP / 直接 handler / 源码 / 运行时栈 / 日志）+ 命令 + 状态」独立成行，禁合并单句。
