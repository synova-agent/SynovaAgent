/**
 * 客户语言基线 ratchet（#1485 / UI 重做 T1）
 *
 * 判据源：
 *   · 交付契约 `docs/synova/ui-redo/UI重做-DEV-DOC-20261124.md` §5.4（扫描契约 / 四条硬断言）
 *   · 词表     `docs/synova/ui-redo/客户语言词典-v1.0.md` §1（规则全集）、§1.1（M/H 分级）、§1.2（精确串）
 *   · R2-18    CTO 裁定追加（裸英文枚举）；《词典》文档侧并入本条前，以本文件里的集合镜像为准，
 *              文档并入后以《词典》为准（两侧只许同一份集合，不得各写一份）
 *   · R2-19    CTO 裁定追加（枚举值域插值直出，M 级）：判据面＝**JSX 表达式容器 `{…}` 内的表达式**，
 *              登记表见 `ENUM_VALUE_DOMAIN`（CTO 维护，实施者不得自行增删）。判据是**去空白后全等**
 *              —— ① 整体全等，② 按**顶层** `||` / `??` 拆出的**任一分支**全等（CTO 裁定 B）；仍是精确比对，
 *              不是包含/前缀/正则；普通代码里的同名变量不在判据面内。
 *              该面独立于字符串候选面（不进候选总数基线）。
 *
 * 口径（照抄契约，不得自行改写）：
 *   · 只对 §1.1 的 **M 级**规则做阻断；**H 级**只输出复核清单、不计入失败。
 *   · 允许清单是**债单**不是豁免：键 = `(path, rule, normalizeText(text))`，`lineHint` 只作展示、不参与判据。
 *   · 四条硬断言：① 零清单外违规 ② 清单不腐化 ③ 覆盖面不缩水（43 文件 / 每文件候选>0 或白名单）④ 总量不塌（== 冻结基线）
 *   · `aria-label` 属于客户可见（§5.4），但**不进 allowlist 销账口径**，单独统计。
 *
 * 本文件**不改任何界面文字**：T1 只建基线，泄漏由 T2–T6 修；修好一条必须删一条 allowlist 条目。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  extractJsxExpressionSites,
  extractVisibleStrings,
  listScanFiles,
  normalizeText,
  parseJsxExpressionSites,
  resolveScanRoot,
  type VisibleString,
} from './support/extract-visible-strings';

/* ── 判据面常量（实测冻结；改动须在 PR 回执说明并升 DEV DOC 版本） ───────── */

/** 扫描面文件数基线（`electron-renderer/src` 下 `.ts`/`.tsx`；B3 新增 lib/words/index.ts ＋ TechnicalDetails.tsx：43 → 45）。 */
const BASELINE_FILE_COUNT = 45;

/**
 * 候选字符串总数基线（B3 更新：新增字典与「技术详情」组件、客户说法替换后实测 43 文件/1743 → 45 文件/1825）。
 * B3 T4b（#1481）再更新：1825 → 1844。原因＝**文案替换本身**（不是新增扫描面文件，文件数仍 45）：
 *   · 新增客户说法：4 类空态原因（词典 §4.2）＋「下一步」句＋技术详情条目名（错误码/状态码/服务端原文等）
 *   · 同批删除旧技术原文（HTTP/哨兵/循环/LLM 等 44 条 allowlist 债）
 * ⇒ 「候选总数只随文件数变」不成立：改一条客户文案会同时增/减候选。故本条基线**允许随客户说法变更重钉**，
 *   但必须在 PR 回执给出 旧值→新值 与逐项归因（T4 先例：1743 → 1825）。
 * 生成命令：`npx vitest run tests/user-visible/customer-language.test.ts --pool=threads`（基线可见量用例的原始输出）。
 * 只允许因**有序删除 / 客户说法变更 / 扫描面新增文件**而更新；不得随手调小。
 */
const BASELINE_CANDIDATE_COUNT = 1844;

/** 允许"零候选"的文件白名单（必须给理由；新增条目须在 PR 回执说明）。 */
const TEXT_FREE_FILES: Readonly<Record<string, string>> = {
  'electron-renderer/src/components/ScanContainer.tsx': '34 行 / 940 B 纯装配容器：只把 store 状态透传给 ScanPanel，无客户可见字面量（实测零候选）',
  'electron-renderer/src/main.tsx': '10 行 / 245 B React 入口：只挂载 App，无客户可见字面量（实测零候选）',
};

const ALLOWLIST_PATH = fileURLToPath(new URL('./customer-language.allowlist.json', import.meta.url));

/* ── 《词典》§1 规则表 ───────────────────────────────────────────────── */

interface RuleSpec {
  id: string;
  /** 规则说明（失败信息用） */
  title: string;
  patterns?: readonly RegExp[];
  /** §1.2 精确串："命中即红"＝包含该精确串 */
  contains?: readonly string[];
  /** §1.2 精确串："全等即红"＝整串相等 */
  equals?: readonly string[];
}

/**
 * R2-18「裸英文枚举」的集合（判据源＝《词典》R2-18／CTO 裁定；文档并入前本数组即唯一镜像）。
 *
 * 判据 = `normalizeText(text)` 与本集合某成员**全等**即违规：
 *   · 不是包含（`sentinel 数据` 不命中）不是前缀（`sentinelId` 不命中）
 *   · 大小写敏感（`Workspace` 不命中）——`normalizeText` 只做 NFKC＋空白折叠，不做大小写
 * 《词典》增删成员 ⇒ 本数组同步；另造第二份清单 / 自行收窄集合 ＝ 改判据，须走 CTO。
 */
const BARE_ENGLISH_ENUMS: readonly string[] = [
  'workspace',
  'conversation',
  'command',
  'sentinel',
  'admin',
  'manager',
  'liaison',
  'staff',
  'ga',
];

/**
 * R2-19「枚举值域插值直出」的登记表（**CTO 维护，实施者不得自行增删**；文档侧同一份集合见《词典》§1.2）。
 *
 * 判据（CTO 裁定 B）：JSX 表达式容器 `{…}` 内的表达式满足下列任一 ⇒ 违规（M 级）：
 *   ① **全等**：整体去掉全部空白后与某成员全等（`{userRole}`）
 *   ② **分支全等**：按**顶层** `||` / `??` 拆成若干分支，**任一分支**去空白后与某成员全等
 *      （`{item.targetType || item.targetId || '—'}`）—— 拆分只认顶层运算符，
 *      不在括号/字符串/模板串/三元内部拆；两条都是**精确比对**，不许退化成前缀/包含/正则模糊匹配
 *   · 只判**渲染位**（JSX 子节点位置）；属性值位置（如 `role={userRole}`）不是渲染位，单独统计、不登记（停点）
 *   · 不是包含/前缀/大小写折叠：`userRoleLabel`、`item.types`、`UserRole` 均不命中
 *   · 普通代码里的同名变量不在判据面内（只认 JSX 表达式容器）
 *   · **某项 0 命中不算失败**（这是观察名单，不是"必须全命中"的检查）
 *
 * 为什么要有这条：R2-18 只认字面量，且提取规则②把 `admin`/`staff`/`ga` 挡在候选外 ⇒
 * 字符串面在结构上看不见"渲染位直出"。本规则的债挂在渲染位上，T4 改成客户说法后条目自然失效，
 * 断言 2 会逼着删 ⇒ **"改 UI 即销账"成立**。改动本数组 ＝ 改判据，须 CTO 裁定。
 */
const ENUM_VALUE_DOMAIN: readonly string[] = [
  'userRole',
  'item.type',
  't.status',
  'a.priority',
  'loop.lastExecution.status',
  'relation.type',
  'object.type',
  'entry.status',
  'source.evidence_status',
  'source.instance_state',
  'item.action',
  'item.targetType',
  // CTO 裁定 A：`RightPanel.tsx:1014 role={userRole}` 是**属性值位置**（不算渲染位、不登记），
  // 但它在 `ga-detail-sections.tsx:221` 以 `{props.role}` 上屏 ⇒ 下游渲染位被登记成债。
  'props.role',
];

/**
 * M 级（机器可判 ⇒ 阻断）。逐条对应《词典》§1 与 §1.1：
 *   · R2-06 不含「内存」（内存 → H 级；§1.2 的两个精确串仍为 M）
 *   · R2-14 不含「循环」（循环 → H 级；§1.2 的四个精确串仍为 M）
 *   · R2-15 只取 §1.2 的精确串（裸「会话」→ H 级）
 *   · R2-17 只对全等「暂无数据」成立（是否"裸用"由人工复核 → H 级）
 *   · R2-18 只对**全等**成立（`sentinel 数据`／`Workspace` 均不命中；判据见下表注释）
 *   · R2-19 **不在本表**：它的判据面是 JSX 表达式容器（`{userRole}`），不是字符串候选 —— 见 `ENUM_VALUE_DOMAIN`
 */
const M_RULES: readonly RuleSpec[] = [
  { id: 'R2-01', title: '运行时产品名', patterns: [/\bDSH\b/g] },
  { id: 'R2-02', title: '协议前缀 mcp__', patterns: [/mcp__/g] },
  { id: 'R2-03', title: '运行时实现名', patterns: [/sidecar/g] },
  { id: 'R2-04', title: '内部错误常量', patterns: [/DOMAIN_EMPTY/g, /[A-Z][A-Z_]{4,}/g] },
  {
    id: 'R2-05',
    title: '字段名',
    patterns: [
      /problemId|\$id|relation\.type|evidence\.sources|businessKey|source_ref|sourceRef|instance_state|evidence_status|assertion_kind|calculation_match|targetType|targetId|sentinelId|findingId|calibrationId|signalId|run_id|manifest_id|client_request_id/g,
    ],
  },
  {
    id: 'R2-06',
    title: '工程术语',
    patterns: [/DevMode|开发模式|令牌|baseUrl|API Key|Provider|LLM/g],
    contains: ['只在内存', '保存在本进程内存'],
  },
  { id: 'R2-07', title: '传输层码', patterns: [/HTTP \d{3}|\bHTTP\b|\b4\d{2}\b|\b5\d{2}\b/g] },
  { id: 'R2-08', title: '错误码', patterns: [/\b[A-Z][A-Z_]{2,}\b/g] },
  { id: 'R2-09', title: '枚举原文', patterns: [/\b[a-z]+(?:[_.][a-z]+)+\b/g] },
  { id: 'R2-10', title: '原始 id（UUID 片段）', patterns: [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/g] },
  { id: 'R2-11', title: '原始 id（node-/run_）', patterns: [/\bnode-[0-9a-f]{6,}|\brun_[0-9a-f]{6,}/g] },
  { id: 'R2-12', title: '内部版本号', patterns: [/cost0-v1|\bv\d+\b/g] },
  { id: 'R2-13', title: '无单位计数', patterns: [/\bx\d+\b/g] },
  {
    id: 'R2-14',
    title: '内部概念',
    patterns: [/幂等|对账|核对键|断言|降级|哨兵|本体|实体|注入|回流|效用/g],
    contains: ['五循环', '五循环状态', '暂无循环', '加载循环'],
  },
  {
    id: 'R2-15',
    title: '工程结构（会话/编号）',
    contains: ['运行编号', '会话编号', 'DSH 会话', '会话输入', '发起会话', '关闭会话', '尚未发起会话', '会话已关闭'],
  },
  {
    id: 'R2-16',
    title: '英文状态枚举原文',
    patterns: [/\b(completed|failed|degraded|pending|estimated|verified|conflict|open|acknowledged|resolved|dismissed|critical|high|medium|low)\b/g],
  },
  { id: 'R2-17', title: '空态伪装', equals: ['暂无数据'] },
  { id: 'R2-18', title: '裸英文枚举', equals: BARE_ENGLISH_ENUMS },
  { id: 'R1-01', title: '内部角色代号 GA', patterns: [/\bGA\b/g] },
];

/** H 级（需人工 ⇒ 只输出复核清单，不阻断）。人工判定后按《词典》§1.2 追加精确串转 M。 */
const H_RULES: readonly RuleSpec[] = [
  { id: 'H-内存', title: '内存（作安全说明）', patterns: [/内存/g] },
  { id: 'H-循环', title: '循环（作名词）', patterns: [/循环/g] },
  { id: 'H-会话', title: '会话（作产品名词）', patterns: [/会话/g] },
  { id: 'H-暂无数据', title: '暂无数据（需读上下文判是否裸用）', patterns: [/暂无数据/g] },
];

interface Hit {
  rule: string;
  match: string;
  /** 命中位置（§5.1 violations 的形状；仅诊断用，判据是 (path, rule, text)） */
  index: number;
}

/** 纯函数判定器（无 IO）：对已归一化的客户可见字符串跑一组规则。`patterns` 需带 `g`，每次从 `lastIndex` 归零处扫描。 */
function findHits(rules: readonly RuleSpec[], normalized: string): Hit[] {
  const hits: Hit[] = [];
  for (const rule of rules) {
    let hit: { match: string; index: number } | null = null;
    for (const pattern of rule.patterns ?? []) {
      pattern.lastIndex = 0;
      const found = pattern.exec(normalized);
      if (found !== null) {
        hit = { match: found[0], index: found.index };
        break;
      }
    }
    if (hit === null) {
      const needle = (rule.contains ?? []).find((candidate) => normalized.includes(candidate));
      if (needle !== undefined) hit = { match: needle, index: normalized.indexOf(needle) };
    }
    if (hit === null) {
      const needle = (rule.equals ?? []).find((candidate) => normalized === candidate);
      if (needle !== undefined) hit = { match: needle, index: 0 };
    }
    if (hit !== null) hits.push({ rule: rule.id, ...hit });
  }
  return hits;
}

/* ── R2-19 判定器（纯函数，无 IO）：全等 ＋ 分支全等 ─────────────────── */

/** 去掉**全部**空白（`normalizeText` 只折叠成单空格；R2-19 的比对面要求全去）。 */
function squeeze(text: string): string {
  return text.replace(/\s+/g, '');
}

/**
 * 跳过一段引号字面量（`'…'`／`"…"`／`` `…` ``，含模板串 `${…}` 内的代码），返回其后一位下标。
 * 未闭合（语法不完整）⇒ 返回文本长度。作用：让拆分器**不在字符串/模板内部**误拆。
 */
function skipQuoted(text: string, start: number): number {
  const quote = text[start];
  let index = start + 1;
  while (index < text.length) {
    const char = text[index];
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (quote === '`' && char === '$' && text[index + 1] === '{') {
      index += 2;
      let brace = 1;
      while (index < text.length && brace > 0) {
        const inner = text[index];
        if (inner === '\\') {
          index += 2;
          continue;
        }
        if (inner === "'" || inner === '"' || inner === '`') {
          index = skipQuoted(text, index);
          continue;
        }
        if (inner === '{') brace += 1;
        else if (inner === '}') brace -= 1;
        index += 1;
      }
      continue;
    }
    if (char === quote) return index + 1;
    index += 1;
  }
  return index;
}

/**
 * 按**顶层** `||` / `??` 把表达式拆成若干分支（CTO 裁定 B 的拆分口径）。
 *
 * "顶层"＝不在 `()` / `[]` / `{}` 内部、不在字符串/模板串内部、不在三元 `? :` 内部。
 * 返回的分支是**原样子串**（未去空白；比较时再 `squeeze`）。没有顶层运算符时返回整串单分支。
 */
function splitTopLevelFallbacks(expression: string): string[] {
  const branches: string[] = [];
  let depth = 0;
  let ternary = 0;
  let start = 0;
  let index = 0;
  while (index < expression.length) {
    const char = expression[index];
    if (char === "'" || char === '"' || char === '`') {
      index = skipQuoted(expression, index);
      continue;
    }
    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
      index += 1;
      continue;
    }
    if (char === ')' || char === ']' || char === '}') {
      if (depth > 0) depth -= 1;
      index += 1;
      continue;
    }
    if (depth === 0) {
      if (char === '?') {
        if (expression[index + 1] === '?') {
          // 顶层 `??`：三元内部不拆（裁定 B 的"不在三元内部拆"）
          if (ternary === 0) {
            branches.push(expression.slice(start, index));
            index += 2;
            start = index;
            continue;
          }
          index += 2;
          continue;
        }
        if (expression[index + 1] === '.') {
          // `?.` 可选链：不是条件运算符，不计三元层数
          index += 2;
          continue;
        }
        ternary += 1;
        index += 1;
        continue;
      }
      if (char === ':' && ternary > 0) {
        ternary -= 1;
        index += 1;
        continue;
      }
      if (char === '|' && expression[index + 1] === '|' && ternary === 0) {
        branches.push(expression.slice(start, index));
        index += 2;
        start = index;
        continue;
      }
    }
    index += 1;
  }
  branches.push(expression.slice(start));
  return branches;
}

interface EnumValueMatch {
  /** 命中的登记表成员 */
  member: string;
  /** 实际命中的比对面（① 时等于整串，② 时是某个分支；均已去空白） */
  branch: string;
}

/**
 * R2-19 判定器：判定一个 JSX 表达式容器的表达式是否命中登记表。命中返回成员与比对面，否则 `null`。
 *   ① **全等**：整体去空白后与某成员全等 ⇒ 命中
 *   ② **分支全等**：顶层 `||` / `??` 的任一分支去空白后与某成员全等 ⇒ 命中
 * 两条都是**精确比对**：`items.map(userRole)`、`'userRole'`（字符串字面量）、`someObj.userRole`
 * 一律不命中（这四条反例写在自检用例里，改本判定器必红）。
 */
function matchEnumMember(expression: string): EnumValueMatch | null {
  const squeezed = squeeze(expression);
  const direct = ENUM_VALUE_DOMAIN.find((member) => member === squeezed);
  if (direct !== undefined) return { member: direct, branch: squeezed };
  if (!squeezed.includes('||') && !squeezed.includes('??')) return null;
  for (const branch of splitTopLevelFallbacks(squeezed)) {
    const needle = squeeze(branch);
    const found = ENUM_VALUE_DOMAIN.find((member) => member === needle);
    if (found !== undefined) return { member: found, branch: needle };
  }
  return null;
}

/* ── 被扫面与清单（模块级只算一次） ─────────────────────────────────── */

const SCAN_ROOT = resolveScanRoot();
const scannedFiles = listScanFiles(SCAN_ROOT);
const candidates: readonly VisibleString[] = extractVisibleStrings(SCAN_ROOT);

/**
 * R2-19 判据面（与上面的字符串候选面**独立**，不进 `BASELINE_CANDIDATE_COUNT`）。
 * `jsxExprSites` 只收 JSX 表达式容器，规则判定在本文件（提取面与判据分离）。
 */
const jsxExprSites = extractJsxExpressionSites(SCAN_ROOT);
/** 登记表命中（全等 ① 或 分支全等 ②）：`member`/`branch` 供回执与人工复核定位。 */
const enumMatches = jsxExprSites.flatMap((site) => {
  const match = matchEnumMember(site.text);
  return match === null ? [] : [{ site, ...match }];
});
const enumSites = enumMatches.map((row) => row.site);
/** 渲染位命中 ＝ 违规（进 allowlist 债单）。 */
const enumRenderSites = enumSites.filter((site) => site.renderSite);
/** 属性值位置命中：不是渲染位 ⇒ **不登记**，只输出待 CTO 裁定（R2-19 停点）。 */
const enumNonRenderSites = enumSites.filter((site) => !site.renderSite);

const allowlistRaw: unknown = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'));
if (!Array.isArray(allowlistRaw)) {
  throw new Error(`allowlist 必须是数组：${ALLOWLIST_PATH}`);
}
const allowlist = allowlistRaw.map((item, index) => {
  const record = item as Record<string, unknown>;
  for (const field of ['path', 'rule', 'text', 'why'] as const) {
    if (typeof record[field] !== 'string') {
      throw new Error(`allowlist[${index}].${field} 必须是字符串（键的一半，缺失即不可判）`);
    }
  }
  if (typeof record.lineHint !== 'number') {
    throw new Error(`allowlist[${index}].lineHint 必须是数字（仅展示，不参与判据）`);
  }
  return {
    path: record.path as string,
    rule: record.rule as string,
    text: record.text as string,
    why: record.why as string,
    lineHint: record.lineHint as number,
  };
});

/** allowlist 键 = `(path, rule, normalizeText(text))`；`lineHint` 不参与。 */
function allowlistKey(entry: { path: string; rule: string; text: string }): string {
  return `${entry.path}\u0000${entry.rule}\u0000${normalizeText(entry.text)}`;
}

/** 源码侧命中：aria-label 单独统计，不进销账口径（§5.4）。 */
const sourceHits = candidates
  .filter((candidate) => !candidate.ariaLabel)
  .map((candidate) => {
    const normalized = normalizeText(candidate.text);
    return { candidate, normalized, hits: findHits(M_RULES, normalized) };
  })
  .filter((row) => row.hits.length > 0);

const sourceKeys = new Map<string, { path: string; line: number; rule: string; match: string; text: string }>();
for (const row of sourceHits) {
  for (const hit of row.hits) {
    const key = allowlistKey({ path: row.candidate.path, rule: hit.rule, text: row.normalized });
    if (!sourceKeys.has(key)) {
      sourceKeys.set(key, {
        path: row.candidate.path,
        line: row.candidate.line,
        rule: hit.rule,
        match: hit.match,
        text: row.normalized,
      });
    }
  }
}

const allowlistKeys = new Map<string, (typeof allowlist)[number]>();
for (const entry of allowlist) allowlistKeys.set(allowlistKey(entry), entry);

/**
 * R2-19 的渲染位命中并入同一张债单（断言 1/2 都覆盖两个判据面）：
 *   · 断言 1：源码里新出现渲染位直出⇒ 无条目 ⇒ 红；
 *   · 断言 2：T4 改掉渲染位 ⇒ 条目失效 ⇒ 逼着删（"改 UI 即销账"）。
 * 键仍是 `(path, rule, text)`，`text` ＝ 去空白后的表达式（`normalizeText` 幂等）。
 */
for (const site of enumRenderSites) {
  const key = allowlistKey({ path: site.path, rule: 'R2-19', text: site.text });
  if (!sourceKeys.has(key)) {
    sourceKeys.set(key, { path: site.path, line: site.line, rule: 'R2-19', match: site.text, text: site.text });
  }
}

const ariaLabelCandidates = candidates.filter((candidate) => candidate.ariaLabel);
const ariaLabelHits = ariaLabelCandidates
  .map((candidate) => ({ candidate, hits: findHits(M_RULES, normalizeText(candidate.text)) }))
  .filter((row) => row.hits.length > 0);

const hReview = candidates
  .map((candidate) => {
    const normalized = normalizeText(candidate.text);
    return { candidate, normalized, mHits: findHits(M_RULES, normalized), hHits: findHits(H_RULES, normalized) };
  })
  .filter((row) => row.mHits.length === 0 && row.hHits.length > 0)
  .map((row) => `${row.candidate.path}:${row.candidate.line} [${row.hHits.map((hit) => hit.rule).join(',')}] ${row.normalized}`);

const candidatesPerFile = new Map<string, number>();
for (const candidate of candidates) {
  candidatesPerFile.set(candidate.path, (candidatesPerFile.get(candidate.path) ?? 0) + 1);
}

describe('客户语言基线 ratchet（#1485 T1）', () => {
  it('判定器自检：合成样品必须命中对应规则（防规则表被改空/改坏）', () => {
    expect(findHits(M_RULES, '在线 (mcp__x)').map((hit) => hit.rule)).toContain('R2-02');
    expect(findHits(M_RULES, 'HTTP 500 服务异常').map((hit) => hit.rule)).toEqual(expect.arrayContaining(['R2-07']));
    expect(findHits(M_RULES, 'run_id').map((hit) => hit.rule)).toContain('R2-05');
    expect(findHits(M_RULES, '暂无数据').map((hit) => hit.rule)).toContain('R2-17');
    expect(findHits(M_RULES, '运行编号：abc').map((hit) => hit.rule)).toContain('R2-15');
    // R2-18 裸英文枚举：判据是「全等」——包含 / 前后缀 / 大小写变体都不得命中（口径即判据）
    expect(BARE_ENGLISH_ENUMS.length, 'R2-18 集合被清空 = 判据失效').toBeGreaterThan(0);
    expect(findHits(M_RULES, 'sentinel').map((hit) => hit.rule)).toContain('R2-18');
    expect(findHits(M_RULES, 'ga').map((hit) => hit.rule)).toContain('R2-18');
    expect(findHits(M_RULES, 'sentinel 数据').map((hit) => hit.rule)).not.toContain('R2-18');
    expect(findHits(M_RULES, 'Sentinel').map((hit) => hit.rule)).not.toContain('R2-18');
    expect(findHits(M_RULES, '工作区 workspace').map((hit) => hit.rule)).not.toContain('R2-18');
    expect(findHits(M_RULES, '本季营收增长 12%').map((hit) => hit.rule)).toEqual([]);
    // H 级不阻断：裸「会话」只在 H 表命中，M 表不得命中（§1.2 精确串之外的句子交人工）
    expect(findHits(M_RULES, '生成当前会话摘要').map((hit) => hit.rule)).toEqual([]);
    expect(findHits(H_RULES, '生成当前会话摘要').map((hit) => hit.rule)).toContain('H-会话');
  });

  it('R2-19 自检：只认 JSX 表达式容器、去空白全等、属性位不算渲染位', () => {
    // 登记表由 CTO 维护：被清空/被随手增删 = 判据失效，必须红
    expect(ENUM_VALUE_DOMAIN.length, 'R2-19 登记表被改动（CTO 维护，须裁定后同步本数组与《词典》）').toBe(13);
    expect(new Set(ENUM_VALUE_DOMAIN).size, 'R2-19 登记表有重复成员').toBe(ENUM_VALUE_DOMAIN.length);
    // 合成 TSX 覆盖五种边界：渲染位命中 / 中间空白 / 属性值位置 / 非全等（前缀、模板串）/ 普通代码与 JSX 文本
    const synthetic = parseJsxExpressionSites(
      [
        'const A = () => <div>{userRole}</div>;',
        'const B = () => <div>{ item.type }</div>;',
        'const C = () => <span role={userRole} />;',
        'const D = () => <div>{userRoleLabel}</div>;',
        'const E = () => <div>{`${userRole}x`}</div>;',
        'const F = () => <div>userRole</div>;',
        'const code = userRole;',
      ].join('\n'),
      'synthetic.tsx',
    );
    expect(synthetic.length, 'JSX 表达式容器数不对：普通代码与 JSX 文本节点不得被当成容器').toBe(5);
    const hits = synthetic.filter((site) => matchEnumMember(site.text) !== null);
    expect(
      hits.map((site) => `${site.line}:${site.text}:${site.renderSite ? 'render' : `attr:${site.attribute ?? '?'}`}`),
      'R2-19 命中口径：全等（非包含/前缀）、去空白、属性位标注为 attr',
    ).toEqual(['1:userRole:render', '2:item.type:render', '3:userRole:attr:role']);
    expect(hits.filter((site) => !site.renderSite).length, '属性值位置不是渲染位：只统计、不登记').toBe(1);
    // 纯 .ts 文件不产 JSX 表达式容器（判据面不存在 ⇒ 不产命中）
    expect(parseJsxExpressionSites('const a = userRole;', 'synthetic.ts')).toEqual([]);
  });

  it('R2-19 自检（裁定 B）：分支全等 —— 顶层 || / ?? 任一分支全等即命中，仍非模糊匹配', () => {
    // ① 全等判据原样保留
    expect(matchEnumMember('userRole')?.member, '{userRole} 整体全等 ⇒ 命中').toBe('userRole');
    expect(matchEnumMember(' item.type ')?.member, '去空白后全等 ⇒ 命中').toBe('item.type');
    // ② 分支全等：CTO 裁定 B 的原始反例，必须命中
    expect(
      matchEnumMember(`item.targetType || item.targetId || '—'`)?.member,
      '顶层 || 的任一分支全等 ⇒ 命中（裁定 B 原始反例，整体全等抓不到）',
    ).toBe('item.targetType');
    expect(matchEnumMember(`props.role ?? '—'`)?.member, '顶层 ?? 的分支全等 ⇒ 命中').toBe('props.role');
    // 仍是精确比对：三条误伤反例必须不命中
    expect(matchEnumMember('items.map(userRole)'), '包装表达式整体不等于成员 ⇒ 不命中').toBeNull();
    expect(matchEnumMember(`'userRole'`), '字符串字面量不等于标识符 ⇒ 不命中').toBeNull();
    expect(matchEnumMember('someObj.userRole'), '成员访问不等于成员 ⇒ 不命中').toBeNull();
    // 拆分只认顶层运算符：括号 / 三元 / 模板串 / 字符串内部都不许拆（否则包装表达式会被切出假命中）
    expect(matchEnumMember('(userRole || fallback)'), '括号内部不拆 ⇒ 整体不等于成员 ⇒ 不命中').toBeNull();
    expect(matchEnumMember('cond ? userRole || x : y'), '三元内部不拆 ⇒ 不命中').toBeNull();
    expect(matchEnumMember("`${userRole || x}`"), '模板串内部不拆 ⇒ 不命中').toBeNull();
    expect(matchEnumMember(`'a||userRole'`), '字符串内部不拆 ⇒ 不命中').toBeNull();
    expect(matchEnumMember('a?.userRole || x'), '?. 不是条件运算符，不抬高三元层数').toBeNull();
    // 端到端：同一判定器作用在真实判据面（合成 TSX 的渲染位）上，命中面与反例面同时成立
    const synthetic = parseJsxExpressionSites(
      [
        `const A = () => <div>{item.targetType || item.targetId || '—'}</div>;`,
        `const B = () => <div>{items.map(userRole)}</div>;`,
        "const C = () => <div>{'userRole'}</div>;",
        'const D = () => <div>{someObj.userRole}</div>;',
        'const E = () => <div>{props.role}</div>;',
      ].join('\n'),
      'synthetic-branch.tsx',
    );
    expect(synthetic.length, '合成 TSX 的 JSX 表达式容器数').toBe(5);
    expect(
      synthetic.filter((site) => matchEnumMember(site.text) !== null).map((site) => `${site.line}:${site.text}`),
      '渲染位命中面：只有 ① 复合兜底 与 ⑤ props.role 命中；②③④ 三条反例必须不命中',
    ).toEqual([`1:item.targetType||item.targetId||'—'`, '5:props.role']);
  });

  it('断言 1：清单外违规为 0（新增泄漏必红）', () => {
    const unregistered = [...sourceKeys.entries()].filter(([key]) => !allowlistKeys.has(key));
    expect(
      unregistered.map(
        ([, row]) => `${row.path}:${row.line} [${row.rule}] ${JSON.stringify(row.match)} in ${JSON.stringify(row.text)}`,
      ),
      `清单外违规 ${unregistered.length} 条：新增客户面泄漏，须改文案而不是加 allowlist 条目`,
    ).toEqual([]);
  });

  it('断言 2：allowlist 无腐化条目（修好了必须删条目）', () => {
    const stale = [...allowlistKeys.entries()].filter(([key]) => !sourceKeys.has(key));
    expect(
      stale.map(([, entry]) => `${entry.path}:${entry.lineHint} [${entry.rule}] ${JSON.stringify(entry.text)}`),
      `失效条目 ${stale.length} 条：源码中已不再出现，请从 allowlist 删除（行号为 lineHint，仅提示，可能已漂移）`,
    ).toEqual([]);
  });

  it('断言 3：扫描覆盖面未缩水（文件数 == 43，且每文件候选>0 或在白名单）', () => {
    expect(scannedFiles.length, `被扫文件数 ${scannedFiles.length} ≠ 基线 ${BASELINE_FILE_COUNT}`).toBe(
      BASELINE_FILE_COUNT,
    );
    const silent = scannedFiles.filter(
      (file) => (candidatesPerFile.get(file) ?? 0) === 0 && TEXT_FREE_FILES[file] === undefined,
    );
    expect(
      silent.map((file) => `${file}（零候选且不在 TEXT_FREE_FILES；白名单新增须给理由并在 PR 回执说明）`),
      `静默文件 ${silent.length} 个：提取器在该文件失效，或该文件确实无客户面文案（应显式登记白名单）`,
    ).toEqual([]);
  });

  it('断言 4：候选字符串总数 == 冻结基线（总量不许塌）', () => {
    expect(candidates.length, `候选字符串总数 ${candidates.length} ≠ 基线 ${BASELINE_CANDIDATE_COUNT}`).toBe(
      BASELINE_CANDIDATE_COUNT,
    );
  });

  it('基线可见量（人工复核用；不参与阻断）', () => {
    const allowlistByRule = allowlist.reduce<Record<string, number>>((acc, entry) => {
      acc[entry.rule] = (acc[entry.rule] ?? 0) + 1;
      return acc;
    }, {});
    const summary = {
      扫描根: SCAN_ROOT,
      被扫文件数: scannedFiles.length,
      候选字符串总数: candidates.length,
      allowlist条目数: allowlist.length,
      清单外违规: [...sourceKeys.keys()].filter((key) => !allowlistKeys.has(key)).length,
      清单失效条目: [...allowlistKeys.keys()].filter((key) => !sourceKeys.has(key)).length,
      '按规则条目数': allowlistByRule,
      'R2-19表达式容器总数': jsxExprSites.length,
      'R2-19登记表命中数': enumSites.length,
      'R2-19渲染位命中数': enumRenderSites.length,
      'R2-19非渲染位命中数（未登记，待裁定）': enumNonRenderSites.length,
      'R2-19登记表0命中项': ENUM_VALUE_DOMAIN.filter((member) => !enumMatches.some((row) => row.member === member)),
      'aria-label候选数': ariaLabelCandidates.length,
      'aria-label命中数': ariaLabelHits.length,
      'H级复核条目数': hReview.length,
      'TEXT_FREE_FILES': TEXT_FREE_FILES,
    };
    console.log(`[customer-language] ${JSON.stringify(summary, null, 2)}`);
    if (hReview.length > 0) {
      console.log(`[customer-language] H 级复核清单（需人工判级，不计入失败）：\n${hReview.join('\n')}`);
    }
    if (enumNonRenderSites.length > 0) {
      console.log(
        `[customer-language] R2-19 非渲染位命中（属性值位置，按停点不登记，待 CTO 裁定）：\n${enumNonRenderSites
          .map((site) => `${site.path}:${site.line} {${site.raw}} @${site.attribute ?? '?'}`)
          .join('\n')}`,
      );
    }
    // 白名单本身不许腐化：登记的"零候选文件"必须真的在被扫面上（文件改名/删除 ⇒ 红）
    expect(
      Object.keys(TEXT_FREE_FILES).filter((file) => !scannedFiles.includes(file)),
      'TEXT_FREE_FILES 里的文件已不在扫描面上（改名/删除？），请同步删除白名单条目',
    ).toEqual([]);
  });
});
