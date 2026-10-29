/**
 * src/agent/approval-card.ts — 审批会话「审批卡」帧构造（#1075 P3 / T3）
 *
 * 架构位置: **编排面**（`src/agent/`）的**纯构造**模块 —— 零 IO、零环境变量、零 store/LLM 依赖。
 *   被 L1 路由 `src/routes/conversations.ts` 的**审批会话分支**调用（`approvalRoleId` 第一分支）：
 *   该分支把 `loadRolePacks()` 已算好的审批态传进来，本模块只产 SSE 帧对象（**不写流**）。
 *
 * 设计哲学（一句）: **帧只是形状，判定不在卡里** —— 卡把「审批读路径已经算好」的状态原样映射成
 *   客户端可点协议；本模块绝不重算审批/指纹（单一真源 = `preset-loader.loadRolePacks().approval`）。
 *
 * 契约（铁律 47）:
 *   @input  — `buildApprovalCardFrame({ roleId, status, scope, contentHash, permissionsPending })`
 *             · `status` 三值（与读路径 `RolePackApproval.status` 同值）：`approved`／`pending`／`unverified`；
 *             · `scope`：`content`／`content+permissions`，**非 approved ⇒ `null`**（未定，客户端不得当已批）；
 *             · `contentHash`：六件现场指纹（64 位小写 hex），包结构校验未通过 ⇒ `null`（无指纹 ⇒ 不可批）；
 *             · `permissionsPending`：读路径口径（`content` 且包声明 tools ⇒ true）；**非 approved ⇒ `null`**。
 *   @output — `ApprovalCardFrame`（§2.3-E）：`{ type:'approval_card', roleId, status, scope, contentHash,
 *             permissionsPending, buttons:[approve/revoke/detail], detailPath:'/role-packs/'+roleId }`。
 *             `buttons` 恒三条且顺序固定（批准／撤销／查看说明书）—— 判据按 id 断言，不按位置猜。
 *   @degraded — **不抛、无降级态**：纯映射（无 IO、无解析、无失败分支）；入参非法由调用方在流前
 *             以 typed code 拒绝（见 @error），本模块对任何字符串形状都不臆造判定。
 *   @error  — **本模块无 typed error code**（纯构造、不抛）：HTTP 失败码全部由调用方 chokepoint 产出 ——
 *             `UNAUTHORIZED`(401)／`E_ROLE_PACK_FORBIDDEN`(403)／`E_APPROVAL_SESSION_CONFLICT`(400)／
 *             `E_APPROVAL_ROLE_ID_INVALID`(400)／`E_ROLE_PACK_NOT_FOUND`(404)。**禁**在本模块复制这些判定
 *             （否则同一语义两处实现 ⇒ 必然漂移）。
 *   @authority — **生产唯一调用方 = `src/routes/conversations.ts` 的 `handleApprovalSession()`**（Bearer ＋
 *             `admin|manager|ga` ＋ 包存在守卫之后调用）；测试 = `tests/init/role-pack-approval-write.test.ts`
 *             的 C2 卡帧用例（纯构造，无需 HTTP）。**其它模块不得复制本帧形状**（协议唯一出处）。
 *   @not-here — 不发帧（不持 `WebViewAdapter`）／不判审批（真源 = 读路径）／不查包是否存在／不做身份与
 *             角色白名单／不产 HTTP 状态码／不含动作端点（按钮由客户端带同一 Bearer 调
 *             `POST /api/role-packs/:id/approval`，§10-L3）／不做四眼与签名提示（P3 非目标）。
 *
 * Source map（本文件内）:
 *   | 导出 | 角色 |
 *   |---|---|
 *   | `buildApprovalCardFrame()` | 唯一构造入口（纯函数） |
 *   | `ApprovalCardFrame`／`ApprovalCardInput`／`ApprovalCardStatus`／`ApprovalCardScope`／`ApprovalCardButton` | §2.3-E 契约类型 |
 *   内部：`APPROVAL_CARD_BUTTONS`（按钮三件，顺序即协议）／`APPROVAL_CARD_DETAIL_PREFIX`（`/role-packs/`）
 *         —— **模块内常量、不导出**（组 4「新 export 必须被引用」：仅本文件使用时导出 = 未引用）。
 *
 * 已知限制（Known Limitations；禁写"暂无"）:
 *   · **L1 · 非 approved 的 `scope`/`permissionsPending` 为 `null`**：pending/unverified 包尚无"批准粒度"
 *     与"权限待批"的确定值 —— 用 `null`（未定）而不是 `false`（那会误导成"无待批权限"）；
 *     客户端必须据 `status` 决定是否呈现"批准/撤销"动作。
 *   · **L2 · `contentHash` 可能为 `null`**：包结构校验未通过（`validation.ok === false`）时读路径不产指纹
 *     ⇒ 卡无法提供 D2 所需的 `expectedContentHash`，客户端不得对 `null` 发起批准（调用方会 409/404）。
 *   · **L3 · 文案硬编码中文**：无 i18n 层（与既有帧文案口径一致）；多语言属后续批次。
 *   · **L4 · 不校验 `roleId` 形状**：调用方已按 `ROLE_PACK_ID_PATTERN` 判 400；本模块只拼 `detailPath`
 *     （展示用路径，不参与服务端路由解析 —— 若被直接当 URL 用，服务端页面路由会自行判形状）。
 *   · **L5 · 无动作端点／无状态按钮互斥**：卡同时给 approve/revoke/detail 三按钮，不按 status 裁剪
 *     （裁剪属前端呈现，服务端对非法动作返回 typed 4xx —— 卡不做伪守卫）。
 *   · **L6 · 帧为开放型（`{type:string}` ＋ 附加字段）**：新增字段是 additive；客户端必须忽略未知字段
 *     （`src/l1-interaction/web-adapter.ts:30` 口径）。
 */

/** 审批态三值（与 `src/init/role-pack-approval.ts` 的 `RolePackApproval.status` **同值**；本地声明避免脏依赖）。 */
export type ApprovalCardStatus = 'approved' | 'pending' | 'unverified';

/** 审批粒度（与 §2.3-C 的 `RolePackApprovalScope` **同值**；本地声明，卡不依赖写模块）。 */
export type ApprovalCardScope = 'content' | 'content+permissions';

/** 卡按钮（动作 id 是客户端契约；label 仅呈现）。 */
export type ApprovalCardButton = {
  readonly id: 'approve' | 'revoke' | 'detail';
  readonly label: string;
};

/** `buildApprovalCardFrame()` 入参（字段级契约；均由调用方从读路径取值）。 */
export type ApprovalCardInput = {
  /** 角色 id（＝角色包目录名；调用方已判形状与非空存在性） */
  readonly roleId: string;
  /** 审批态（读路径三值；禁止在卡侧再判） */
  readonly status: ApprovalCardStatus;
  /** 批准粒度；非 approved ⇒ `null`（未定） */
  readonly scope: ApprovalCardScope | null;
  /** 六件现场指纹；包结构校验未通过 ⇒ `null` */
  readonly contentHash: string | null;
  /** 权限待批标志（读路径口径）；非 approved ⇒ `null`（未定） */
  readonly permissionsPending: boolean | null;
};

/**
 * 审批卡 SSE 帧（§2.3-E 逐字段；`type` 自描述 ⇒ 客户端按 `type` 分派）。
 * 用 `type` 别名（非 interface）以便直接满足 `SseFramePayload = {type:string} & Record<string,unknown>`：
 * interface 无隐式索引签名，会被 `Record<string, unknown>` 拒收（同 `web-adapter.emitDiagnosisEvent` 注释）。
 */
export type ApprovalCardFrame = {
  readonly type: 'approval_card';
  readonly roleId: string;
  readonly status: ApprovalCardStatus;
  readonly scope: ApprovalCardScope | null;
  readonly contentHash: string | null;
  readonly permissionsPending: boolean | null;
  readonly buttons: readonly ApprovalCardButton[];
  /** 说明书页路径（前端点击"查看说明书"用；服务端页面路由 `GET /role-packs/:roleId`） */
  readonly detailPath: string;
};

/** 说明书页路径前缀（**模块内常量**，不导出 —— 仅本文件使用；route 侧有同名路由字面量）。 */
const APPROVAL_CARD_DETAIL_PREFIX = '/role-packs/';

/**
 * 卡按钮三件（**顺序是协议的一部分**：批准 → 撤销 → 查看说明书）。
 * `detail` 无动作端点（纯导航）；`approve`/`revoke` 由客户端带同一 Bearer 调写 API（§10-L3）。
 */
const APPROVAL_CARD_BUTTONS: readonly ApprovalCardButton[] = [
  { id: 'approve', label: '批准' },
  { id: 'revoke', label: '撤销' },
  { id: 'detail', label: '查看说明书' },
];

/**
 * 构造审批卡帧（**纯函数、不抛**；同一入参恒等产出）。
 *
 * @param input - 读路径已算好的审批态（见 {@link ApprovalCardInput}）
 * @returns §2.3-E 帧对象（含三条按钮与 `detailPath`）；**不写流、不改入参**
 * @authority 唯一调用点 = `conversations.ts` 审批会话分支（见文件头 @authority）
 */
export function buildApprovalCardFrame(input: ApprovalCardInput): ApprovalCardFrame {
  return {
    type: 'approval_card',
    roleId: input.roleId,
    status: input.status,
    scope: input.scope,
    contentHash: input.contentHash,
    permissionsPending: input.permissionsPending,
    buttons: APPROVAL_CARD_BUTTONS,
    detailPath: `${APPROVAL_CARD_DETAIL_PREFIX}${input.roleId}`,
  };
}
