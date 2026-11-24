/**
 * src/runtime/dsh/hypothesis-adapter.ts — 把模型这一轮的文本解析成结构化瓶颈假设（#1459 T-C）。
 *
 * 边界：**纯函数、无 I/O、无副作用**。它只回答"这段文本是否构成一条合格的结构化假设"。
 * 不合格时给出机器可读原因，**不补默认值、不猜测、不修正模型措辞**。
 *
 * 契约（铁律 47）:
 *   @input   text: 该 run 的完整模型文本（调用方负责聚合，见 session.ts 的 finishFromStopReason）
 *   @output  { ok: true, payload } | { ok: false, reason: { code, missing, message } }
 *            payload 键名与桌面归一规则（electron-renderer dsh-run-store.readHypothesis）逐字对齐：
 *            { hypothesis, objects[], relations[], evidence[], uncertainty[], schemaVersion? }
 *   @degraded 无：解析失败即 ok:false，由调用方发 hypothesis.invalid 事件（不抛错）
 *   @authority 无：本模块不写库、不发事件、不做权限判断
 *   @not-here 不落库、不调用模型、不做业务判断
 *   @error 无抛出；所有失败走返回值
 */

/** 四要素：必须是非空数组，且每项是非空字符串。 */
const REQUIRED_ARRAY_FIELDS = ['objects', 'relations', 'evidence', 'uncertainty'] as const;

/** 非法原因码（稳定词汇，供事件与测试断言）。 */
export type HypothesisInvalidCode =
  | 'NOT_JSON'
  | 'WRONG_TYPE'
  | 'MISSING_FIELDS'
  | 'EMPTY_ELEMENT';

/** 非法的机器可读原因。 */
export interface HypothesisInvalidReason {
  code: HypothesisInvalidCode;
  /** 具体缺/错的字段名（可为空数组）。 */
  missing: string[];
  /** 一句人话，供桌面展示。 */
  message: string;
}

/** 合格载荷（键名与桌面归一规则对齐）。 */
export interface HypothesisPayload {
  hypothesis: string;
  objects: string[];
  relations: string[];
  evidence: string[];
  uncertainty: string[];
  schemaVersion?: number;
}

export type HypothesisParseResult =
  | { ok: true; payload: HypothesisPayload }
  | { ok: false; reason: HypothesisInvalidReason };

/** 从 markdown 代码围栏中取出 JSON 正文（模型常带 ```json 包裹）；不是围栏就原样返回。 */
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/u.exec(trimmed);
  return fenced === null ? trimmed : (fenced[1] ?? '').trim();
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

/**
 * 解析并严格校验一条结构化瓶颈假设。
 * @param text 该 run 的完整模型文本
 */
export function parseHypothesis(text: string): HypothesisParseResult {
  const body = stripCodeFence(text);
  if (body === '') {
    return {
      ok: false,
      reason: { code: 'NOT_JSON', missing: [], message: '模型未产出可解析的假设文本（空文本）' },
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return {
      ok: false,
      reason: {
        code: 'NOT_JSON',
        missing: [],
        message: '模型输出不是可解析的 JSON（未按假设契约作答）',
      },
    };
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      reason: {
        code: 'WRONG_TYPE',
        missing: [],
        message: '模型输出的 JSON 顶层不是对象',
      },
    };
  }

  const record = raw as Record<string, unknown>;
  const missing: string[] = [];
  const wrongType: string[] = [];

  if (!isNonEmptyString(record.hypothesis)) missing.push('hypothesis');
  for (const field of REQUIRED_ARRAY_FIELDS) {
    const value = record[field];
    if (value === undefined || value === null) {
      missing.push(field);
      continue;
    }
    if (!Array.isArray(value)) {
      wrongType.push(field);
      continue;
    }
    if (value.length === 0) missing.push(field);
    else if (!isStringArray(value)) wrongType.push(field);
  }

  if (wrongType.length > 0) {
    return {
      ok: false,
      reason: {
        code: 'WRONG_TYPE',
        missing: wrongType,
        message: `假设字段类型不符（需非空字符串数组）：${wrongType.join('、')}`,
      },
    };
  }
  if (missing.length > 0) {
    return {
      ok: false,
      reason: {
        code: 'MISSING_FIELDS',
        missing,
        message: `假设缺少必要内容（空值或空数组）：${missing.join('、')}`,
      },
    };
  }

  // 二次窄化（不用 `as` 强转）：上面已确认非空，这里只是把 unknown 收窄成具体类型。
  const hypothesisText = typeof record.hypothesis === 'string' ? record.hypothesis : '';
  const objects = isStringArray(record.objects) ? record.objects : null;
  const relations = isStringArray(record.relations) ? record.relations : null;
  const evidence = isStringArray(record.evidence) ? record.evidence : null;
  const uncertainty = isStringArray(record.uncertainty) ? record.uncertainty : null;
  if (
    objects === null ||
    relations === null ||
    evidence === null ||
    uncertainty === null ||
    !isNonEmptyString(hypothesisText)
  ) {
    return {
      ok: false,
      reason: {
        code: 'WRONG_TYPE',
        missing: [],
        message: '假设字段二次校验不成立（实现缺陷，请报 CTO）',
      },
    };
  }

  const payload: HypothesisPayload = {
    hypothesis: hypothesisText,
    objects,
    relations,
    evidence,
    uncertainty,
  };
  if (typeof record.schemaVersion === 'number') payload.schemaVersion = record.schemaVersion;
  return { ok: true, payload };
}

/** 模型原始文本进入 invalid 事件时的截断上限（字符）。 */
export const HYPOTHESIS_TEXT_LIMIT = 2000;

/** 截断到上限，返回值与是否发生截断（供事件字段 truncated 使用）。 */
export function truncateHypothesisText(text: string): { text: string; truncated: boolean } {
  if (text.length <= HYPOTHESIS_TEXT_LIMIT) return { text, truncated: false };
  return { text: text.slice(0, HYPOTHESIS_TEXT_LIMIT), truncated: true };
}
