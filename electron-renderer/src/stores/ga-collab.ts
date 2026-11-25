/**
 * stores/ga-collab.ts — D556 GA 人机协同纯逻辑数据层（L1，零 react/zustand 依赖，node 可测）
 *
 * 职责（spec §3.3.1）: GaCollab 状态机 / 请求构建（镜像 D551 服务端校验）/ 响应映射
 * （诚实 note 透传）/ 降级决策 / dev seed 身份读取。React 组件层（RightPanel.tsx 容器 +
 * ga-detail-sections.tsx 纯展示）只消费本模块的类型与纯函数，保证逻辑层可独立测试
 * （tests/ga-collab-logic.test.ts）。
 *
 * 契约总纲（铁律 47，先于实现定义 — spec §5/§7/§8）:
 *   @input  — 见各函数 JSDoc
 *   @output — 纯值（无副作用；localStorage 只读）
 *   @degraded — 响应映射失败 → { ok: false }（调用方渲染降级 UI，禁静默、禁假数据——铁律 8/24/31）
 *   @error  — 不抛（全部走返回值判别联合）
 *
 * D551 契约来源（只读消费，不 import src/——渲染层与 API 层是独立包）:
 *   docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D551-ga-calibration-backend-20260828.md §8.2
 *   src/routes/ga-calibration.ts L39-45（值域枚举镜像，改动需同步）
 *   src/middleware/auth.ts L366-376（legacy x-synova-token: role:orgId:userId）
 */

// ═══ D551 值域镜像（权威源: src/routes/ga-calibration.ts L39-43；前端仅校验，禁改值域） ═══

export const GA_TARGET_TYPES = ['diagnosis_conclusion', 'diagnosis_logic', 'signal_relevance'] as const;
export const GA_CALIBRATION_ACTIONS = ['mark_error', 'add_context', 'rewrite_logic', 'demote_signal'] as const;
export const GA_ERROR_TYPES = ['事实错误', '归因错误', '遗漏关键信息', '过于笼统'] as const;
export const GA_SIGNAL_TYPES = ['人员变动', '战略转向', '竞品动态', '客户反馈', '监管变化', '供应商变化', '市场传闻', '技术突破', '内部冲突', '其他'] as const;

export type GaTargetType = (typeof GA_TARGET_TYPES)[number];
export type GaCalibrationAction = (typeof GA_CALIBRATION_ACTIONS)[number];
export type GaErrorType = (typeof GA_ERROR_TYPES)[number];
export type GaSignalType = (typeof GA_SIGNAL_TYPES)[number];

// ═══ 状态机（spec §3.3.1: idle/loading/loaded/degraded/blocked） ═══

/**
 * 单块状态（校准列表 / 效用仪表各自独立——spec §5.3 分块独立降级，不整面板连坐）。
 * blocked = 服务端 403 拒绝（seed 漂移时客户端防御已拦，此处为服务端权威拒绝的诚实呈现）。
 */
export type GaBlockState = 'idle' | 'loading' | 'loaded' | 'degraded' | 'blocked';

/** 容器总状态。blocked = 客户端 role 防御（canAccessCap false，零 fetch——spec §5.2）。 */
export type GaCollabPhase = 'idle' | 'loading' | 'loaded' | 'degraded' | 'blocked';

// ═══ Dev seed 身份（spec §7.2 — legacy x-synova-token 同源，不耦合 D483-D486） ═══

/** dev seed 身份（仅 role==='ga' 生效——seed 是 GA 面板可见的必要条件，非可选项） */
export interface DevSeedIdentity {
  role: 'ga';
  orgId: string;
  userId: string;
}

/** localStorage key（spec §7.2.1 固定值） */
export const GA_SEED_STORAGE_KEY = 'synova.dev-identity';

/**
 * getSeedIdentity — 读取 dev seed 身份（localStorage，只读）。
 * @input  无（读 localStorage[GA_SEED_STORAGE_KEY]）
 * @output DevSeedIdentity | null
 * @return role==='ga' 且 orgId/userId 非空字符串 → 身份；其余（无 key/role 非 ga/字段缺失）→ null
 * @degraded localStorage 不存在（node 测试/非浏览器环境）→ null（正常默认态，非异常）；
 *           JSON.parse 失败 → console.warn + null（铁律 24: 解析失败非 ENOENT，必须留痕）
 * @error  不抛
 */
export function getSeedIdentity(): DevSeedIdentity | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(GA_SEED_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object') {
      const rec = parsed as Record<string, unknown>;
      if (
        rec.role === 'ga' &&
        typeof rec.orgId === 'string' && rec.orgId.trim().length > 0 &&
        typeof rec.userId === 'string' && rec.userId.trim().length > 0
      ) {
        return { role: 'ga', orgId: rec.orgId, userId: rec.userId };
      }
    }
    return null;
  } catch (err: unknown) {
    console.warn(
      '[ga-collab] dev-identity 解析失败 — 视为无 seed（铁律 24）',
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/**
 * getSeedToken — 组装 legacy x-synova-token 头值（auth.ts L366-376 格式: role:orgId:userId）。
 * @input  无（经 getSeedIdentity）
 * @output 'ga:<orgId>:<userId>' | null
 * @return seed 存在 → token 字符串；无 seed → null（调用方**不附头**——无 seed 请求形态与现状完全一致，DS4）
 * @degraded 同 getSeedIdentity
 * @error  不抛
 */
export function getSeedToken(): string | null {
  const identity = getSeedIdentity();
  return identity ? `ga:${identity.orgId}:${identity.userId}` : null;
}

// ═══ 降级决策（spec §8 逻辑层: 503→degraded、403→blocked、部分失败分块独立） ═══

/**
 * decideBlockState — HTTP 状态 → 块状态（apiFetch null-collapse 语义下的唯一判别点）。
 * @input  status: HTTP 状态码；null = 网络异常/apiFetch collapse（无法区分 5xx/4xx）
 * @output GaCollabPhase
 * @return 2xx → 'loaded'；403 → 'blocked'（服务端 requireGa 拒绝，fail-closed 呈现）；
 *         其余（null/400/5xx/未知）→ 'degraded'
 * @degraded null 与非 2xx 非 403 一律 'degraded'（诚实降级，不猜测具体原因）
 * @error  不抛
 */
export function decideBlockState(status: number | null): GaCollabPhase {
  if (status !== null && status >= 200 && status < 300) return 'loaded';
  if (status === 403) return 'blocked';
  return 'degraded';
}

/**
 * deriveOverallPhase — 容器总状态推导（spec §5.3: 分块独立降级，部分成功不连坐）。
 * @input  roleAllowed: canAccessCap(userRole,'ga') 结果；calibration/stats: 两块状态
 * @output GaCollabPhase
 * @return !roleAllowed → 'blocked'（零 fetch 语义由容器保证）；两块全败（degraded/blocked）→
 *         'degraded'（整面板降级条 + 重试）；任一 loading → 'loading'；任一 loaded → 'loaded'
 *         （降级块内联呈现）；否则 → 'idle'
 * @degraded 无（纯函数）
 * @error  不抛
 */
export function deriveOverallPhase(
  roleAllowed: boolean,
  calibration: GaCollabPhase,
  stats: GaCollabPhase,
): GaCollabPhase {
  if (!roleAllowed) return 'blocked';
  const states: GaCollabPhase[] = [calibration, stats];
  if (states.every((s) => s === 'degraded' || s === 'blocked')) return 'degraded';
  if (states.some((s) => s === 'loading')) return 'loading';
  if (states.some((s) => s === 'loaded')) return 'loaded';
  return 'idle';
}

// ═══ 响应映射（D551 §8.2 端点 2/4 响应 shape；诚实 note 透传） ═══

/** GET /api/ga/calibration 条目（D551 L262-283 映射字段） */
export interface GaCalibrationItem {
  calibrationId: string;
  targetType: string;
  targetId: string;
  action: string;
  errorType?: string;
  correctedContent?: string;
  contextCard?: string;
  originalVersion?: string;
  rewrittenVersion?: string;
  sentinelId?: string;
  supersedes?: string | null;
  supersededBy?: string;
  gaId: string;
  calibratedAt: string;
}

/** GET /api/ga/calibration/stats 响应（D551 L458-465；note 原文透传——采纳率不可得的 UI 显性化） */
export interface GaStatsData {
  calibration: { total: number; byAction: Record<string, number> };
  injection: { total: number; byType: Record<string, number> };
  reflux: { feedbackCount: number; byDecision: Record<string, number> };
  note?: string;
  degraded?: boolean;
}

export type MapResult<T> = { ok: true; data: T } | { ok: false };

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** 数值记录守卫: 非数值条目剔除（stats byAction/byType/byDecision——铁律 38 零 as any） */
function asNumberRecord(v: unknown): Record<string, number> {
  if (!isRecord(v)) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(v)) {
    const n = asNumber(value);
    if (n !== null) out[key] = n;
  }
  return out;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/**
 * mapStatsResponse — stats 响应 → GaStatsData（unknown → 类型守卫，铁律 38 零 as any）。
 * @input  raw: apiFetch 结果（unknown；null 由调用方在映射前走 decideBlockState）
 * @output { ok: true, data: GaStatsData } | { ok: false }
 * @return ok===true 且 calibration/injection/reflux 三块齐全且 total/feedbackCount 为有限数 → 映射成功；
 *         note/degraded 原文透传（不加工、不丢弃——诚实降级声明直达 UI）；其余 → { ok: false }
 * @degraded 结构缺失/类型不符 → { ok: false }（调用方渲染降级，不伪造 0——铁律 8）
 * @error  不抛
 */
export function mapStatsResponse(raw: unknown): MapResult<GaStatsData> {
  if (!isRecord(raw) || raw.ok !== true) return { ok: false };
  const calibration = raw.calibration;
  const injection = raw.injection;
  const reflux = raw.reflux;
  if (!isRecord(calibration) || !isRecord(injection) || !isRecord(reflux)) return { ok: false };
  const calTotal = asNumber(calibration.total);
  const injTotal = asNumber(injection.total);
  const feedbackCount = asNumber(reflux.feedbackCount);
  if (calTotal === null || injTotal === null || feedbackCount === null) return { ok: false };
  const data: GaStatsData = {
    calibration: { total: calTotal, byAction: asNumberRecord(calibration.byAction) },
    injection: { total: injTotal, byType: asNumberRecord(injection.byType) },
    reflux: { feedbackCount, byDecision: asNumberRecord(reflux.byDecision) },
  };
  const note = asString(raw.note);
  if (note !== null) data.note = note;
  if (raw.degraded === true) data.degraded = true;
  return { ok: true, data };
}

/**
 * mapCalibrationsResponse — 校准列表响应 → GaCalibrationItem[]（unknown → 类型守卫）。
 * @input  raw: apiFetch 结果（unknown）
 * @output { ok: true, data: GaCalibrationItem[] } | { ok: false }
 * @return ok===true 且 calibrations 为数组 → 过滤出 calibrationId/action/calibratedAt 齐全的条目
 *         （单条畸形跳过不整表拒绝——对齐 D551 路由「解析失败跳过不静默」语义）；其余 → { ok: false }
 * @degraded 非 ok/非数组 → { ok: false }；空数组 → { ok: true, data: [] }（合法空态）
 * @error  不抛
 */
export function mapCalibrationsResponse(raw: unknown): MapResult<GaCalibrationItem[]> {
  if (!isRecord(raw) || raw.ok !== true || !Array.isArray(raw.calibrations)) return { ok: false };
  const items: GaCalibrationItem[] = [];
  for (const entry of raw.calibrations) {
    if (!isRecord(entry)) continue;
    const id = asString(entry.calibrationId);
    const action = asString(entry.action);
    const calibratedAt = asString(entry.calibratedAt);
    if (id === null || action === null || calibratedAt === null) continue;
    const item: GaCalibrationItem = {
      calibrationId: id,
      action,
      calibratedAt,
      targetType: asString(entry.targetType) ?? '',
      targetId: asString(entry.targetId) ?? '',
      gaId: asString(entry.gaId) ?? '',
    };
    const optionalStrings = ['errorType', 'correctedContent', 'contextCard', 'originalVersion', 'rewrittenVersion', 'sentinelId', 'supersededBy'] as const;
    for (const key of optionalStrings) {
      const v = asString(entry[key]);
      if (v !== null) item[key] = v;
    }
    if (entry.supersedes === null || typeof entry.supersedes === 'string') {
      item.supersedes = entry.supersedes;
    }
    items.push(item);
  }
  return { ok: true, data: items };
}

// ═══ 请求构建（镜像 D551 服务端校验——spec §8: 客户端先拦，服务端校验仍是权威） ═══

/** POST /api/ga/calibration 请求体（D551 §8.2 端点 1） */
export interface GaCalibrationRequestBody {
  targetType: GaTargetType;
  targetId: string;
  action: GaCalibrationAction;
  errorType?: GaErrorType;
  correctedContent?: string;
  contextCard?: string;
  originalVersion?: string;
  rewrittenVersion?: string;
  sentinelId?: string;
  supersedes?: string;
}

/**
 * buildCalibrationRequest — 校准表单原始值 → 请求体（镜像 D551 L146-178 校验规则）。
 * @input  input: 表单原始值（action/targetType/targetId + 动作专属字段；值为 string）
 * @output { ok: true, body } | { ok: false, error }
 * @return 基础校验: targetType ∈ 3 值域 / targetId 非空 / action ∈ 4 值域；
 *         动作专属: mark_error 必填 errorType(4 值域)+correctedContent；add_context 必填
 *         contextCard；rewrite_logic 必填 originalVersion+rewrittenVersion；demote_signal
 *         必填 sentinelId；supersedes 可选透传
 * @degraded 校验失败 → { ok: false, error }（错误文案面向 GA，表单内联呈现，不发请求）
 * @error  不抛
 */
export function buildCalibrationRequest(
  input: Record<string, unknown>,
): { ok: true; body: GaCalibrationRequestBody } | { ok: false; error: string } {
  const targetType = input.targetType;
  if (typeof targetType !== 'string' || !(GA_TARGET_TYPES as readonly string[]).includes(targetType)) {
    return { ok: false, error: '请选择诊断对象类型（诊断结论／诊断逻辑／预警信号）' };
  }
  const targetId = input.targetId;
  if (typeof targetId !== 'string' || targetId.trim().length === 0) {
    return { ok: false, error: '请填写目标编号' };
  }
  const action = input.action;
  if (typeof action !== 'string' || !(GA_CALIBRATION_ACTIONS as readonly string[]).includes(action)) {
    return { ok: false, error: '请选择修正方式' };
  }

  const body: GaCalibrationRequestBody = {
    targetType: targetType as GaTargetType,
    targetId: targetId.trim(),
    action: action as GaCalibrationAction,
  };

  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : null);

  if (action === 'mark_error') {
    const errorType = input.errorType;
    if (typeof errorType !== 'string' || !(GA_ERROR_TYPES as readonly string[]).includes(errorType)) {
      return { ok: false, error: '标记错误：请选择错误类型' };
    }
    const correctedContent = str(input.correctedContent);
    if (correctedContent === null) {
      return { ok: false, error: '标记错误：请填写正确信息或补充说明' };
    }
    body.errorType = errorType as GaErrorType;
    body.correctedContent = correctedContent;
  }
  if (action === 'add_context') {
    const contextCard = str(input.contextCard);
    if (contextCard === null) {
      return { ok: false, error: '补充背景：请填写背景说明' };
    }
    body.contextCard = contextCard;
  }
  if (action === 'rewrite_logic') {
    const originalVersion = str(input.originalVersion);
    const rewrittenVersion = str(input.rewrittenVersion);
    if (originalVersion === null || rewrittenVersion === null) {
      return { ok: false, error: '修正逻辑：请填写原版本与新版本' };
    }
    body.originalVersion = originalVersion;
    body.rewrittenVersion = rewrittenVersion;
  }
  if (action === 'demote_signal') {
    const sentinelId = str(input.sentinelId);
    if (sentinelId === null) {
      return { ok: false, error: '调低该预警的优先级：请填写预警项' };
    }
    body.sentinelId = sentinelId;
  }

  const supersedes = input.supersedes;
  if (typeof supersedes === 'string' && supersedes.trim().length > 0) {
    body.supersedes = supersedes.trim();
  }

  return { ok: true, body };
}

/** POST /api/ga/calibration/signals 请求体（D551 §8.2 端点 3，蓝图 §3.3.1 五要素） */
export interface GaSignalRequestBody {
  signalType: GaSignalType;
  title: string;
  description: string;
  severity: number;
  confidence: number;
  relatedEdges?: string[];
  relatedNodes?: string[];
}

/**
 * parseNumberInput — 表单数值字段解析（severity/confidence 以字符串到达）。
 * @input  v: 表单原始值
 * @output number | null
 * @return number → 原值；数值字符串 → parseFloat（NaN → null）；其余 → null
 * @degraded 不可解析 → null（由调用方产出校验错误）
 * @error  不抛
 */
export function parseNumberInput(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim().length > 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseStringList(v: unknown): string[] | null {
  if (v === undefined || v === null || v === '') return [];
  if (Array.isArray(v)) {
    return v.every((e) => typeof e === 'string') ? (v as string[]) : null;
  }
  if (typeof v === 'string') {
    // 逗号分隔输入（表单单行文本）→ 数组；空白条目剔除
    return v.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  }
  return null;
}

/**
 * buildSignalRequest — 信号表单原始值 → 请求体（镜像 D551 L320-341 校验规则）。
 * @input  input: 表单原始值（signalType/title/description/severity/confidence + relatedEdges/relatedNodes）
 * @output { ok: true, body } | { ok: false, error }
 * @return signalType ∈ 10 值域 / title 非空 / description 非空 / severity 1-10 数值 /
 *         confidence 0-100 数值；relatedEdges/relatedNodes 可选（逗号分隔字符串或数组 → string[]）
 * @degraded 校验失败 → { ok: false, error }（不发请求）
 * @error  不抛
 */
export function buildSignalRequest(
  input: Record<string, unknown>,
): { ok: true; body: GaSignalRequestBody } | { ok: false; error: string } {
  const signalType = input.signalType;
  if (typeof signalType !== 'string' || !(GA_SIGNAL_TYPES as readonly string[]).includes(signalType)) {
    return { ok: false, error: `signalType 必须是: ${GA_SIGNAL_TYPES.join(', ')}` };
  }
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (title.length === 0) {
    return { ok: false, error: 'title 必填' };
  }
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  if (description.length === 0) {
    return { ok: false, error: 'description 必填' };
  }
  const severity = parseNumberInput(input.severity);
  if (severity === null || severity < 1 || severity > 10) {
    return { ok: false, error: 'severity 必须是 1-10 的数值' };
  }
  const confidence = parseNumberInput(input.confidence);
  if (confidence === null || confidence < 0 || confidence > 100) {
    return { ok: false, error: 'confidence 必须是 0-100 的数值' };
  }
  const body: GaSignalRequestBody = {
    signalType: signalType as GaSignalType,
    title,
    description,
    severity,
    confidence,
  };
  const relatedEdges = parseStringList(input.relatedEdges);
  if (relatedEdges === null) {
    return { ok: false, error: 'relatedEdges 必须是字符串数组（逗号分隔）' };
  }
  const relatedNodes = parseStringList(input.relatedNodes);
  if (relatedNodes === null) {
    return { ok: false, error: 'relatedNodes 必须是字符串数组（逗号分隔）' };
  }
  if (relatedEdges.length > 0) body.relatedEdges = relatedEdges;
  if (relatedNodes.length > 0) body.relatedNodes = relatedNodes;
  return { ok: true, body };
}
