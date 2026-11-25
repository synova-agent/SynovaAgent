#!/usr/bin/env node
/**
 * tests/ui-redo/probe-contrast.mjs — UI 重做 T2 验收探针（A3 对比度，两态各算一遍）
 *
 * 判据来源：Issue #1481（任务卡 T2 v2.1 §5 A3）＋ DEV DOC v1.15 §4.5 注：
 *   ❌ 阻断：正文 `--text` on `--bg`/`--panel`；控件文字（各控件类 color on 其 background）—— WCAG 2.x 阈值 4.5:1。
 *   ⚠️ 仅报告：`--dim` / `--accent2` 的配对（浅色主题 14 对 <4.5 属另一子缺陷，不在 T2 范围）。
 *   要求：每个控件类必须产出一对（缺 color/background ⇒ 报「缺配对」，不许静默跳过）；
 *         脚本先用已知值自校准（UA 白底黑字 21.00:1、#EFEFEF 底黑字 18.26:1），算不出 ⇒ 脚本自身失效。
 *
 * 输入（只读）：electron-renderer/src/styles/global.css 的 :root / .theme-light 令牌与各控件类声明；
 *              控件类清单复用 probe-controls.mjs 的源码扫描（同一提取口径，防两处漂移）。
 * 解析口径（静态声明值，非运行态全量取色）：
 *   · 选择器最后复合选择器含 .class 且非状态伪类（:hover/:focus/:disabled/::placeholder）的规则参与；
 *   · 深色态只取未带 .theme-light 前缀的规则；浅色态先取基础规则再叠加 .theme-light 前缀规则（文件序近似级联）；
 *   · background: none/transparent ⇒ 该控件落在面板底 `--panel` 上（控制台/面板内控件均如此）；
 *   · rgba 背景按面板底色 composite 后再算对比度。
 *
 * 退出码（三态）：0 通过 ｜ 1 真红（阻断项不达标／存在缺配对）｜ 2 脚本自身失效（自校准失败/解析面为空）
 * 覆盖点（供判别力自检注入失败面）：UI_REDO_CONTRAST_CSS / UI_REDO_CONTROLS_SCAN_ROOT
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FROZEN,
  parseCss,
  scanSource,
  collectControlFacts,
  rulesForClass,
  CSS_PATH,
  SCAN_ROOT,
} from './probe-controls.mjs';
import fs from 'node:fs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WCAG_NORMAL = 4.5;
const REPORT_ONLY_TOKENS = new Set(['--dim', '--accent2']);

const problems = [];
const selfErrors = [];
const fail = (msg) => problems.push(msg);

// ────────────────────────────── 1. 颜色解析与 WCAG 数学 ──────────────────────────────

function hexToRgb(hex) {
  const h = hex.replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
    a: 1,
  };
}

function parseColorValue(value, tokens, seen = new Set()) {
  const v = String(value).trim();
  const varMatch = /^var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)$/.exec(v);
  if (varMatch) {
    const name = varMatch[1];
    if (seen.has(name)) return null;
    if (!(name in tokens)) return null;
    return { ...parseColorValue(tokens[name], tokens, new Set([...seen, name])), varName: name };
  }
  if (v === 'none' || v === 'transparent') return { transparent: true, varName: null };
  if (v.startsWith('#')) return hexToRgb(v);
  const rgbMatch = /^rgba?\(([^)]+)\)$/i.exec(v);
  if (rgbMatch) {
    const nums = rgbMatch[1].split(',').map((s) => s.trim());
    if (nums.length < 3) return null;
    const toByte = (s) => (s.endsWith('%') ? Math.round((parseFloat(s) / 100) * 255) : Math.round(parseFloat(s)));
    return { r: toByte(nums[0]), g: toByte(nums[1]), b: toByte(nums[2]), a: nums[3] === undefined ? 1 : parseFloat(nums[3]) };
  }
  return null;
}

function relativeLuminance({ r, g, b }) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(fg, bg) {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

function compositeOver(fg, bg) {
  const a = fg.a ?? 1;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
}

const fmt = (rgb) => `rgb(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)})`;
const pct = (n) => n.toFixed(2);

// ────────────────────────────── 2. 令牌与规则 ──────────────────────────────

function tokenMap(rules, theme) {
  const map = {};
  for (const rule of rules) {
    const matchesRoot = rule.parts.some((p) => p.trim() === ':root');
    const matchesLight = rule.parts.some((p) => p.trim() === '.theme-light');
    if ((theme === 'dark' && matchesRoot) || (theme === 'light' && (matchesRoot || matchesLight))) {
      Object.assign(map, rule.declarations);
    }
  }
  return map;
}

const STATE_PSEUDO = /::?(hover|focus|focus-visible|focus-within|active|disabled|placeholder|checked|visited)\b/;

function stripThemePrefix(part) {
  return part.replace(/^\.theme-light\s+/, '').trim();
}

/** 某主题下参与级联的规则（按文件序，浅色态叠加 .theme-light 规则）。 */
function rulesForTheme(rules, theme) {
  const out = [];
  for (const rule of rules) {
    for (const part of rule.parts) {
      const raw = part.trim();
      if (theme === 'dark') {
        if (raw.includes('.theme-light')) continue;
        out.push({ part: raw, declarations: rule.declarations, selector: rule.selector });
      } else if (raw === '.theme-light') {
        continue;
      } else {
        out.push({ part: stripThemePrefix(raw), declarations: rule.declarations, selector: rule.selector });
      }
    }
  }
  return out;
}

function lastCompoundOf(part) {
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

function classKeyInCompound(compound, cls) {
  return new RegExp(`\\.${cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(compound);
}

function classTokensInCompound(compound) {
  return [...compound.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
}

/**
 * 取某控件类的基础声明（非状态伪类）：
 * ① 优先「独立复合」——最后复合选择器里只有该类（如 `.dsh-btn`、`.left-panel-header .icon-btn`）；
 * ② 独立复合没有该属性时，回退到「共类复合」——如 `.welcome-btn.primary` 之于 primary、
 *    `.notif-action-btn.confirm` 之于 confirm（这些控件类只与该基类同用）。
 * 这样避免 `.cap-item.active` 的 accent2 被误算成 cap-item 的基色。
 */
function baseDeclarationFor(themeRules, cls, prop) {
  let exact = null;
  let loose = null;
  for (const rule of themeRules) {
    const compound = lastCompoundOf(rule.part);
    if (STATE_PSEUDO.test(compound)) continue;
    const tokens = classTokensInCompound(compound);
    if (!tokens.includes(cls)) continue;
    const value = rule.declarations[prop];
    if (value === undefined) continue;
    if (tokens.length === 1) exact = { value, selector: rule.selector };
    else loose = { value, selector: rule.selector };
  }
  return exact ?? loose;
}

// ────────────────────────────── 3. 配对判定 ──────────────────────────────

function tokenNameOf(value) {
  const m = /^var\(\s*(--[\w-]+)/.exec(String(value).trim());
  return m ? m[1] : null;
}

function evaluateTheme(rules, theme, classNames) {
  const tokens = tokenMap(rules, theme);
  const themeRules = rulesForTheme(rules, theme);
  const lines = [];
  const report = { theme, controls: [], tokens: {} };

  const tokenPair = (label, fgToken, bgToken, blocking) => {
    const fg = parseColorValue(tokens[fgToken], tokens);
    const bg = parseColorValue(tokens[bgToken], tokens);
    if (!fg || !bg) {
      selfErrors.push(`${theme}: 令牌 ${fgToken}/${bgToken} 解析失败`);
      return;
    }
    const ratio = contrastRatio(fg, bg);
    const pass = ratio >= WCAG_NORMAL;
    const mode = blocking ? '阻断' : '报告';
    lines.push(`  ${label}（${fgToken} on ${bgToken}）: ${pct(ratio)} [${mode}] ${pass ? 'PASS' : '低于 4.5'}`);
    report.tokens[`${fgToken}/${bgToken}`] = Number(pct(ratio));
    if (blocking && !pass) fail(`${theme} ${label}: ${pct(ratio)} < ${WCAG_NORMAL}`);
  };

  lines.push(`【${theme === 'dark' ? '深色主题（:root）' : '浅色主题（.theme-light）'}】`);
  tokenPair('正文', '--text', '--bg', true);
  tokenPair('正文', '--text', '--panel', true);
  tokenPair('正文', '--dim', '--bg', false);
  tokenPair('正文', '--dim', '--panel', false);
  tokenPair('强调', '--accent2', '--bg', false);
  tokenPair('强调', '--accent2', '--panel', false);

  const heading = theme === 'dark' ? '  控件文字（深色）' : '  控件文字（浅色）';
  lines.push(heading);
  let missingPairs = 0;
  const surface = parseColorValue(tokens['--panel'], tokens);
  const fallbackSurface = parseColorValue(tokens['--bg'], tokens);

  for (const cls of classNames) {
    const colorDecl = baseDeclarationFor(themeRules, cls, 'color');
    const bgDecl =
      baseDeclarationFor(themeRules, cls, 'background') ?? baseDeclarationFor(themeRules, cls, 'background-color');
    if (!colorDecl || !bgDecl) {
      missingPairs += 1;
      report.controls.push({ cls, missing: !colorDecl ? 'color' : 'background' });
      lines.push(`  · .${cls}: 缺配对（${!colorDecl ? '无 color' : '无 background'}）`);
      fail(`${theme} 控件 .${cls}: 缺配对（${!colorDecl ? 'no color' : 'no background'}）`);
      continue;
    }
    const fg = parseColorValue(colorDecl.value, tokens);
    let bg = parseColorValue(bgDecl.value, tokens);
    if (!fg || !bg) {
      selfErrors.push(`${theme} 控件 .${cls}: 颜色值无法解析（color=${colorDecl.value} / background=${bgDecl.value}）`);
      continue;
    }
    if (!bg.transparent && (bg.a ?? 1) < 1) bg = compositeOver(bg, surface ?? fallbackSurface);
    if (bg.transparent) bg = surface ?? fallbackSurface;
    const ratio = contrastRatio(fg, bg);
    const tokenName = tokenNameOf(colorDecl.value);
    const bgTokenName = tokenNameOf(bgDecl.value);
    const reportOnly = (tokenName && REPORT_ONLY_TOKENS.has(tokenName)) || (bgTokenName && REPORT_ONLY_TOKENS.has(bgTokenName));
    const pass = ratio >= WCAG_NORMAL;
    const mode = reportOnly ? '报告' : '阻断';
    lines.push(
      `  · .${cls}${bgDecl.value === 'none' || bgDecl.value === 'transparent' ? '（底=--panel）' : ''}: ${pct(ratio)} [${mode}] ${pass ? 'PASS' : '低于 4.5'}`,
    );
    report.controls.push({
      cls,
      color: colorDecl.value,
      background: bgDecl.value,
      ratio: Number(pct(ratio)),
      reportOnly,
      pass,
    });
    if (!reportOnly && !pass) fail(`${theme} 控件 .${cls}: ${pct(ratio)} < ${WCAG_NORMAL}（${colorDecl.value} on ${bgDecl.value}）`);
  }
  if (missingPairs > 0) lines.push(`  缺配对合计: ${missingPairs} 个控件类`);
  return { lines, report };
}

// ────────────────────────────── 4. 主流程 ──────────────────────────────

function main() {
  // 自校准（DEV DOC §2.2 已知值；算不出 ⇒ 脚本自身失效，按 exit 2）
  const white = hexToRgb('#ffffff');
  const black = hexToRgb('#000000');
  const efef = hexToRgb('#efefef');
  const cal1 = contrastRatio(black, white);
  const cal2 = contrastRatio(black, efef);
  const calOk = Math.abs(cal1 - 21.0) < 0.01 && Math.abs(cal2 - 18.26) < 0.01;
  if (!calOk) {
    console.error('=== probe-contrast（A3）脚本自校准失败 ===');
    console.error(`  #000 on #fff = ${pct(cal1)}（期望 21.00）｜ #000 on #EFEFEF = ${pct(cal2)}（期望 18.26）`);
    console.error('RESULT: SELF-FAIL（脚本自身失效，判不了 ≠ 通过）');
    process.exit(2);
  }

  if (!fs.existsSync(CSS_PATH)) {
    console.error(`probe-contrast: CSS 不存在 ${CSS_PATH}`);
    process.exit(2);
  }
  const rules = parseCss(fs.readFileSync(CSS_PATH, 'utf8'));
  const scanned = scanSource();
  if (rules.length === 0 || !scanned) {
    console.error('=== probe-contrast（A3）脚本自身失效 ===');
    console.error('  global.css 解析为 0 条规则或控件扫描为 0，判不了 ≠ 通过');
    process.exit(2);
  }

  const facts = collectControlFacts(scanned);
  const classNames = [...new Set([...facts.literal, ...facts.modifier])].sort();
  if (classNames.length < FROZEN.controlClasses) {
    fail(`控件类 ${classNames.length} < 冻结基线 ${FROZEN.controlClasses}（A3 配对面不完整）`);
  }

  const dark = evaluateTheme(rules, 'dark', classNames);
  const light = evaluateTheme(rules, 'light', classNames);

  console.log('=== probe-contrast（A3 对比度 · WCAG 2.x） ===');
  console.log(`样式真源: ${path.relative(REPO_ROOT, CSS_PATH).replace(/\\/g, '/')}`);
  console.log(`自校准: #000 on #fff = ${pct(cal1)}（期望 21.00）✓ ｜ #000 on #EFEFEF = ${pct(cal2)}（期望 18.26）✓`);
  console.log(`控件类配对面: ${classNames.length} 类（字面 ${facts.literal.size} ＋ 修饰 ${facts.modifier.size}；冻结 ${FROZEN.controlClasses}）`);
  console.log('');
  for (const line of dark.lines) console.log(line);
  console.log('');
  for (const line of light.lines) console.log(line);
  console.log('');
  console.log('报告项汇总（不阻断，供后续批次）：');
  const rt = (theme, key) => theme.report.tokens[key];
  console.log(`  深色 --dim/--bg ${rt(dark, '--dim/--bg')} ｜ --dim/--panel ${rt(dark, '--dim/--panel')} ｜ --accent2/--bg ${rt(dark, '--accent2/--bg')} ｜ --accent2/--panel ${rt(dark, '--accent2/--panel')}`);
  console.log(`  浅色 --dim/--bg ${rt(light, '--dim/--bg')} ｜ --dim/--panel ${rt(light, '--dim/--panel')} ｜ --accent2/--bg ${rt(light, '--accent2/--bg')} ｜ --accent2/--panel ${rt(light, '--accent2/--panel')}`);
  console.log('');

  if (selfErrors.length > 0) {
    console.log('检查自身失败项:');
    for (const e of selfErrors) console.log(`  · ${e}`);
    console.log('RESULT: SELF-FAIL（A3）');
    process.exit(2);
  }
  if (problems.length > 0) {
    console.log('失效项:');
    for (const p of problems) console.log(`  ✗ ${p}`);
    console.log('RESULT: FAIL（A3）');
    process.exit(1);
  }
  console.log('RESULT: PASS（A3 两态阻断项全部 ≥4.5；--dim/--accent2 仅报告）');
  process.exit(0);
}

main();
