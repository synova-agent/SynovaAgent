#!/usr/bin/env node
/**
 * tests/ui-redo/probe-controls.mjs — UI 重做 T2 验收探针（A2 控件覆盖 ＋ A4 样式基座）
 *
 * 判据来源：Issue #1481（任务卡 T2 v2.1 §5 A2/A4）＋ DEV DOC v1.15 §4.5/§7。
 *   冻结基线（CTO 实测，实施者不得改小）：控件标签 84 ｜ 控件类 34（字面 31 ＋ 表达式修饰类 3）
 *   ｜ 其中无独立规则 13（字面 10 ＋ 修饰类 3）｜ 裸控件 25。
 *
 * 输入（只读）：
 *   electron-renderer/src/**\/*.tsx —— 控件标签（button/input/select/textarea）与 className
 *   electron-renderer/src/styles/global.css —— 选择器与声明（唯一样式真源）
 * 覆盖点：UI_REDO_CONTROLS_SCAN_ROOT / UI_REDO_CONTROLS_CSS（供判别力自检注入失败面）
 *
 * 四臂（A2）＋ 两断言（A4）：
 *   A2a  字面类名臂：31 个字面控件类，global.css 中「无规则」数 → 期望 0（基线 10）
 *   A2a' 修饰类臂：表达式拼出的 active/selected/disabled 3 个修饰类，各自须有独立 `.token{}` 规则 → 期望 0 缺失（基线 3）
 *   A2b  裸控件臂：25 个无 className 的控件，每个须被「父容器类 + 控件标签」选择器覆盖 → 期望 25/25（基线 0/25）
 *   A2c  表达式臂：4 个表达式 className 标签（3 文件），列出实际渲染类并逐一确认有规则
 *   A2d  基样式属性臂：6 个关键控件类，规则须含 background/color/border 三项
 *   A4a  color-scheme：深色作用域含 dark、浅色作用域含 light
 *   A4b  `*` 全局清零已收窄：不得存在无条件 `* { margin:0; padding:0 }`，且收窄规则须显式排除 `.dsh-*` 子树
 *
 * 退出码（三态）：0 通过 ｜ 1 真红（验收项不成立）｜ 2 检查自身失败（扫描面为 0 等，判不了 ≠ 通过）
 * 防假绿：控件标签总数下界 84 与裸控件数 25 写死断言；任一臂扫到 0 对象即 exit 2。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const SCAN_ROOT = process.env.UI_REDO_CONTROLS_SCAN_ROOT
  ? path.resolve(REPO_ROOT, process.env.UI_REDO_CONTROLS_SCAN_ROOT)
  : path.join(REPO_ROOT, 'electron-renderer', 'src');
const CSS_PATH = process.env.UI_REDO_CONTROLS_CSS
  ? path.resolve(REPO_ROOT, process.env.UI_REDO_CONTROLS_CSS)
  : path.join(REPO_ROOT, 'electron-renderer', 'src', 'styles', 'global.css');

/** CTO 冻结基线（不得改小；改动＝改验收标准，须 CTO 书面裁定） */
const FROZEN = Object.freeze({
  controlLabels: 84,
  controlClasses: 34,
  literalClasses: 31,
  modifierClasses: 3,
  bareControls: 25,
  expressionLabels: 4,
  expressionFiles: 3,
  keyBaseStyleClasses: 6,
});

const CONTROL_TAGS = new Set(['button', 'input', 'select', 'textarea']);

const problems = [];
const selfErrors = [];
const fail = (msg) => problems.push(msg);

// ────────────────────────────── 1. 源码扫描（TSX AST） ──────────────────────────────

function listTsxFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsxFiles(p));
    else if (/\.tsx$/.test(entry.name)) out.push(p);
  }
  return out;
}

function classNameOf(opening) {
  for (const attr of opening.attributes.properties) {
    if (!ts.isJsxAttribute(attr) || attr.name.getText() !== 'className') continue;
    const init = attr.initializer;
    if (!init) return { kind: 'none', tokens: [] };
    if (ts.isStringLiteral(init)) {
      return { kind: 'literal', tokens: init.text.split(/\s+/).filter(Boolean) };
    }
    if (ts.isJsxExpression(init) && init.expression) {
      return { kind: 'expression', expression: init.expression.getText(), exprNode: init.expression };
    }
    return { kind: 'expression', expression: init.getText().slice(0, 80) };
  }
  return { kind: 'none', tokens: [] };
}

/** 表达式 className 的静态类 + 条件分支里的字符串字面量类（如 `... ? ' active' : ''`）。 */
function expressionTokens(exprNode) {
  const staticTokens = [];
  if (exprNode && ts.isTemplateExpression(exprNode)) {
    staticTokens.push(...exprNode.head.text.split(/\s+/).filter(Boolean));
    for (const span of exprNode.templateSpans) {
      staticTokens.push(...span.literal.text.split(/\s+/).filter(Boolean));
    }
  } else if (exprNode && ts.isNoSubstitutionTemplateLiteral(exprNode)) {
    staticTokens.push(...exprNode.text.split(/\s+/).filter(Boolean));
  }
  const dynamicTokens = new Set();
  const collectStrings = (node) => {
    if (ts.isStringLiteral(node)) {
      for (const t of node.text.split(/\s+/).filter(Boolean)) dynamicTokens.add(t);
    }
    ts.forEachChild(node, collectStrings);
  };
  if (exprNode) collectStrings(exprNode);
  return { staticTokens: [...new Set(staticTokens)], dynamicTokens: [...dynamicTokens] };
}

function scanSource() {
  const files = listTsxFiles(SCAN_ROOT);
  if (files.length === 0) {
    selfErrors.push(`扫描根下 0 个 .tsx 文件：${SCAN_ROOT}`);
    return null;
  }
  const controls = [];
  const parseDiagnostics = [];

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    parseDiagnostics.push(...sf.parseDiagnostics);

    const visit = (node, ancestors) => {
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        const opening = ts.isJsxElement(node) ? node.openingElement : node;
        const tag = opening.tagName.getText().toLowerCase();
        const cls = classNameOf(opening);
        if (CONTROL_TAGS.has(tag)) {
          const line = sf.getLineAndCharacterOfPosition(opening.getStart(sf)).line + 1;
          controls.push({
            file: path.relative(REPO_ROOT, file).replace(/\\/g, '/'),
            line,
            tag,
            className: cls,
            ancestors: ancestors.map((a) => ({ tag: a.tag, tokens: a.tokens })),
          });
        }
        if (ts.isJsxElement(node)) {
          const self = { tag, tokens: cls.kind === 'literal' ? cls.tokens : [] };
          node.children.forEach((child) => visit(child, [...ancestors, self]));
        }
        return;
      }
      ts.forEachChild(node, (child) => visit(child, ancestors));
    };
    visit(sf, []);
  }

  if (parseDiagnostics.length > 0) {
    selfErrors.push(`TSX 解析失败 ${parseDiagnostics.length} 处（首个：${parseDiagnostics[0].messageText}）`);
    return null;
  }
  if (controls.length === 0) {
    selfErrors.push('扫到 0 个控件标签（提取器失效）');
    return null;
  }
  return { files, controls };
}

// ────────────────────────────── 2. CSS 规则解析 ──────────────────────────────

function splitSelectorList(selector) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of selector) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/** 去掉括号内容后再找最后一个组合子，得到「最后复合选择器」。 */
function lastCompound(part) {
  let depth = 0;
  let lastBreak = -1;
  for (let i = 0; i < part.length; i += 1) {
    const ch = part[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && (ch === ' ' || ch === '>' || ch === '+' || ch === '~')) lastBreak = i;
  }
  return part.slice(lastBreak + 1).trim();
}

function stripPseudo(compound) {
  let out = '';
  let depth = 0;
  for (let i = 0; i < compound.length; i += 1) {
    const ch = compound[i];
    if (ch === '(') depth += 1;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ':' && depth === 0) break;
    out += ch;
  }
  return out.trim();
}

function parseCss(source) {
  const rules = [];
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '');
  let i = 0;
  while (i < clean.length) {
    const open = clean.indexOf('{', i);
    if (open < 0) break;
    let depth = 0;
    let close = open;
    for (; close < clean.length; close += 1) {
      if (clean[close] === '{') depth += 1;
      else if (clean[close] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const selector = clean.slice(i, open).trim().replace(/\s+/g, ' ');
    const body = clean.slice(open + 1, close);
    if (!selector.startsWith('@')) {
      const declarations = {};
      for (const chunk of body.split(';')) {
        const idx = chunk.indexOf(':');
        if (idx < 0) continue;
        const key = chunk.slice(0, idx).trim().toLowerCase();
        const value = chunk.slice(idx + 1).trim();
        if (key) declarations[key] = value;
      }
      rules.push({
        selector,
        parts: splitSelectorList(selector),
        declarations,
        body: body.replace(/\s+/g, ' ').trim(),
      });
    }
    i = close + 1;
  }
  return rules;
}

function loadCss() {
  if (!fs.existsSync(CSS_PATH)) {
    selfErrors.push(`global.css 不存在：${CSS_PATH}`);
    return null;
  }
  const rules = parseCss(fs.readFileSync(CSS_PATH, 'utf8'));
  if (rules.length === 0) {
    selfErrors.push('global.css 解析出 0 条规则（解析器失效）');
    return null;
  }
  return rules;
}

const escapeClass = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const classTokenRe = (c) => new RegExp(`\\.${escapeClass(c)}(?![\\w-])`);

/** 规则选择器列表里出现 .<class> 即视为「该类有规则」。 */
function rulesForClass(rules, cls) {
  const re = classTokenRe(cls);
  return rules.filter((r) => r.parts.some((p) => re.test(p)));
}

/** 独立 `.class {}` 规则：最后复合选择器（去伪类）恰为 .<class>。 */
function hasIndependentRule(rules, cls) {
  const target = `.${cls}`;
  return rules.some((r) => r.parts.some((p) => stripPseudo(lastCompound(p)) === target));
}

// ────────────────────────────── 3. 四臂判定 ──────────────────────────────

function collectControlFacts(scanned) {
  const literal = new Set();
  const expressions = [];
  const bare = [];
  for (const c of scanned.controls) {
    if (c.className.kind === 'literal') {
      if (c.className.tokens.length === 0) bare.push(c);
      else c.className.tokens.forEach((t) => literal.add(t));
    } else if (c.className.kind === 'expression') {
      expressions.push(c);
    } else {
      bare.push(c);
    }
  }
  const modifier = new Set();
  for (const e of expressions) {
    const { dynamicTokens } = expressionTokens(e.className.exprNode);
    dynamicTokens.forEach((t) => modifier.add(t));
  }
  return { literal, expressions, bare, modifier };
}

function evaluateA2(facts, rules) {
  const { literal, expressions, bare, modifier } = facts;
  const lines = [];
  let ok = true;

  const controlClasses = new Set([...literal, ...modifier]);
  lines.push(`控件标签总数: ${facts.controls.length}（冻结下界 ${FROZEN.controlLabels}）`);
  lines.push(
    `控件类（字面 ${literal.size} ＋ 表达式修饰类 ${modifier.size}）: ${controlClasses.size}（冻结 ${FROZEN.controlClasses}）`,
  );
  lines.push(`裸控件: ${bare.length}（冻结 ${FROZEN.bareControls}）｜ 表达式 className: ${expressions.length}（冻结 ${FROZEN.expressionLabels}）`);

  if (facts.controls.length < FROZEN.controlLabels) {
    ok = false;
    fail(`A2 下界: 控件标签 ${facts.controls.length} < 冻结基线 ${FROZEN.controlLabels}`);
  }
  if (controlClasses.size < FROZEN.controlClasses) {
    ok = false;
    fail(`A2 下界: 控件类 ${controlClasses.size} < 冻结基线 ${FROZEN.controlClasses}`);
  }

  // A2a 字面类名臂
  const missingLiteral = [...literal].filter((c) => rulesForClass(rules, c).length === 0).sort();
  lines.push(`A2a 字面类名臂: ${literal.size - missingLiteral.length}/${literal.size} 有规则；无规则 ${missingLiteral.length}（基线 10→0）`);
  if (missingLiteral.length > 0) {
    ok = false;
    fail(`A2a: 无规则字面类 ${missingLiteral.join(', ')}`);
  }

  // A2a' 修饰类臂（表达式拼出的状态类，须有独立 .token 规则）
  const missingModifier = [...modifier].filter((c) => !hasIndependentRule(rules, c)).sort();
  lines.push(`A2a' 修饰类臂: ${modifier.size - missingModifier.length}/${modifier.size} 有独立规则；无独立规则 ${missingModifier.length}（基线 ${FROZEN.modifierClasses}→0）`);
  if (missingModifier.length > 0) {
    ok = false;
    fail(`A2a': 无独立规则的修饰类 ${missingModifier.join(', ')}`);
  }
  lines.push(`A2a 合计无规则: ${missingLiteral.length + missingModifier.length}（基线 13→0）`);

  // A2b 裸控件臂
  const uncovered = [];
  const coverageDetail = [];
  for (const c of bare) {
    const parentTokens = [...new Set(c.ancestors.flatMap((a) => a.tokens))];
    const selector = findParentTagSelector(rules, parentTokens, c.tag);
    coverageDetail.push(`${c.file}:${c.line} <${c.tag}> 父类=${parentTokens.join('/') || '(无)'} → ${selector ?? '未覆盖'}`);
    if (!selector) uncovered.push(`${c.file}:${c.line} <${c.tag}>`);
  }
  lines.push(`A2b 裸控件臂: ${bare.length - uncovered.length}/${bare.length} 覆盖（基线 0/${FROZEN.bareControls}）`);
  if (bare.length !== FROZEN.bareControls) {
    ok = false;
    fail(`A2b: 裸控件 ${bare.length} ≠ 冻结基线 ${FROZEN.bareControls}`);
  }
  if (uncovered.length > 0) {
    ok = false;
    fail(`A2b: 未覆盖裸控件 ${uncovered.join(' | ')}`);
  }

  // A2c 表达式臂
  const expressionRows = [];
  let expressionMissing = [];
  if (expressions.length !== FROZEN.expressionLabels) {
    ok = false;
    fail(`A2c: 表达式标签 ${expressions.length} ≠ 冻结基线 ${FROZEN.expressionLabels}`);
  }
  const exprFiles = new Set(expressions.map((e) => e.file));
  if (exprFiles.size !== FROZEN.expressionFiles) {
    ok = false;
    fail(`A2c: 表达式所在文件 ${exprFiles.size} ≠ 冻结基线 ${FROZEN.expressionFiles}`);
  }
  for (const e of expressions) {
    const { staticTokens, dynamicTokens } = expressionTokens(e.className.exprNode);
    const rendered = [...new Set([...staticTokens, ...dynamicTokens])];
    const missing = rendered.filter((t) => rulesForClass(rules, t).length === 0);
    expressionMissing.push(...missing.map((m) => `${e.file}:${e.line} {${rendered.join(' ')}} 缺规则 ${m}`));
    expressionRows.push(
      `${e.file}:${e.line} 表达式 \`${(e.className.expression ?? '').replace(/\s+/g, ' ').slice(0, 90)}\` → 渲染类 [${rendered.join(', ')}] ${missing.length ? `缺规则 [${missing.join(', ')}]` : '全部有规则'}`,
    );
  }
  lines.push(`A2c 表达式臂: ${expressions.length} 个表达式标签（${exprFiles.size} 文件）`);
  for (const row of expressionRows) lines.push(`  · ${row}`);
  if (expressionMissing.length > 0) {
    ok = false;
    fail(`A2c: ${expressionMissing.join(' | ')}`);
  }

  // A2d 基样式属性臂
  const keyTargets = [
    { label: '.dsh-btn', class: 'dsh-btn' },
    { label: '.dsh-input', class: 'dsh-input' },
    { label: '.llm-setup-field select', parent: 'llm-setup-field', tag: 'select' },
    { label: '.scan-manifest-picker select', parent: 'scan-manifest-picker', tag: 'select' },
    { label: '.ga-submit-btn', class: 'ga-submit-btn' },
    { label: '.notif-action-btn', class: 'notif-action-btn' },
  ];
  lines.push(`A2d 基样式属性臂: 6 个关键控件类须含 background＋color＋border`);
  for (const target of keyTargets) {
    const hit = target.class
      ? rules.find((r) => r.parts.some((p) => stripPseudo(lastCompound(p)) === `.${target.class}`))
      : rules.find((r) =>
          r.parts.some((p) => {
            if (stripPseudo(lastCompound(p)) !== target.tag) return false;
            return classTokenRe(target.parent).test(p);
          }),
        );
    const decl = hit?.declarations ?? {};
    const got = ['background', 'background-color', 'color', 'border', 'border-color', 'border-width', 'border-style'];
    const hasBg = Boolean(decl.background || decl['background-color']);
    const hasColor = Boolean(decl.color);
    const hasBorder = Boolean(decl.border || decl['border-color'] || decl['border-width'] || decl['border-style']);
    const missing = [!hasBg && 'background', !hasColor && 'color', !hasBorder && 'border'].filter(Boolean);
    lines.push(
      `  · ${target.label}: ${hit ? `规则 @「${hit.selector}」` : '无规则'} ${missing.length ? `缺 [${missing.join(', ')}]` : '含 background/color/border'}`,
    );
    if (!hit || missing.length > 0) {
      ok = false;
      fail(`A2d: ${target.label} ${!hit ? '无规则' : `缺 ${missing.join('/')}`}`);
    }
  }

  return { ok, lines, missingLiteral, missingModifier, uncovered, expressionRows };
}

/** 面板/控件规则的「非状态」复合：:hover/:focus/:disabled 等只在交互态生效，不算覆盖基样式。 */
const STATE_PSEUDO = /::?(hover|focus|focus-visible|focus-within|active|disabled|placeholder|checked|visited)\b/;

function findParentTagSelector(rules, parentTokens, tag) {
  for (const r of rules) {
    for (const part of r.parts) {
      const compound = lastCompound(part);
      if (STATE_PSEUDO.test(compound)) continue;
      if (stripPseudo(compound) !== tag) continue;
      const tagPos = part.lastIndexOf(tag);
      for (const token of parentTokens) {
        const re = classTokenRe(token);
        const m = re.exec(part);
        if (m && m.index < tagPos) return `${part} {…}`;
      }
    }
  }
  return null;
}

function evaluateA4(rules) {
  const lines = [];
  let ok = true;

  // A4a color-scheme 两态
  const schemeRules = rules.filter((r) => r.declarations['color-scheme']);
  const dark = schemeRules.filter(
    (r) => r.parts.some((p) => [':root', 'html'].includes(stripPseudo(p).trim() || p.trim())) && /dark/.test(r.declarations['color-scheme']),
  );
  const light = schemeRules.filter(
    (r) => r.parts.some((p) => p.trim() === '.theme-light') && /light/.test(r.declarations['color-scheme']),
  );
  lines.push(`A4a color-scheme: 规则 ${schemeRules.length} 条；深色作用域 dark ${dark.length} 条；浅色作用域 light ${light.length} 条`);
  if (dark.length === 0 || light.length === 0) {
    ok = false;
    fail('A4a: color-scheme 两态不成立（深色须含 dark、.theme-light 须含 light）');
  }

  // A4b 全局 * 清零收窄
  const starRules = rules.filter((r) => r.selector.split(',').some((s) => s.trim().startsWith('*')));
  const unconditionalReset = starRules.filter(
    (r) =>
      r.parts.some((p) => p.trim() === '*') &&
      (r.declarations.margin !== undefined || r.declarations.padding !== undefined),
  );
  const narrowedReset = starRules.filter(
    (r) =>
      r.parts.some((p) => p.includes('*') && p.includes(':not(') && p.includes('.dsh-')) &&
      (r.declarations.margin !== undefined || r.declarations.padding !== undefined),
  );
  const boxSizing = starRules.filter((r) => r.declarations['box-sizing'] !== undefined);
  lines.push(`A4b 全局 * 规则: ${starRules.length} 条；无条件清零 ${unconditionalReset.length} 条（期望 0）；收窄清零 ${narrowedReset.length} 条（期望 ≥1）；box-sizing ${boxSizing.length} 条`);
  for (const r of narrowedReset) lines.push(`  · 收窄规则「${r.selector}」`);
  if (unconditionalReset.length > 0) {
    ok = false;
    fail(`A4b: 仍存在无条件 * 清零「${unconditionalReset.map((r) => r.selector).join(' / ')}」`);
  }
  if (narrowedReset.length === 0) {
    ok = false;
    fail('A4b: 未找到排除 .dsh-* 子树的收窄 * 规则');
  }

  return { ok, lines };
}

// ────────────────────────────── 4. 主流程 ──────────────────────────────

export { SCAN_ROOT, CSS_PATH, FROZEN, parseCss, scanSource, collectControlFacts, expressionTokens, rulesForClass };

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

function main() {
  const scanned = scanSource();
  const rules = loadCss();
  if (selfErrors.length > 0 || !scanned || !rules) {
    console.error('=== probe-controls（A2/A4）检查自身失败 ===');
    for (const e of selfErrors) console.error(`  · ${e}`);
    console.error('RESULT: SELF-FAIL（判不了 ≠ 通过）');
    process.exit(2);
  }

  const facts = collectControlFacts(scanned);
  facts.controls = scanned.controls;
  const a2 = evaluateA2(facts, rules);
  const a4 = evaluateA4(rules);

  console.log('=== probe-controls（A2 控件覆盖 ＋ A4 样式基座） ===');
  console.log(`扫描根: ${path.relative(REPO_ROOT, SCAN_ROOT).replace(/\\/g, '/')}（${scanned.files.length} 个 .tsx）`);
  console.log(`样式真源: ${path.relative(REPO_ROOT, CSS_PATH).replace(/\\/g, '/')}`);
  console.log('');
  for (const line of a2.lines) console.log(line);
  console.log('');
  for (const line of a4.lines) console.log(line);
  console.log('');

  if (problems.length > 0) {
    console.log('失效项:');
    for (const p of problems) console.log(`  ✗ ${p}`);
    console.log('RESULT: FAIL（A2/A4）');
    process.exit(1);
  }
  console.log('RESULT: PASS（A2 四臂 ＋ A4 两断言）');
  process.exit(0);
}

if (isDirectRun) main();
