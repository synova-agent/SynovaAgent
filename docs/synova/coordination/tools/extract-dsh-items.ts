#!/usr/bin/env node
/**
 * DSH 借鉴项抽取器（边界评估/00-最终方案.md 四类 → 结构化的 41 项）
 *
 * @why  ① 创始人裁 A：DSH 侧 41 项单独成一件，**不许与现有 40 项混淆/冲突/重复建设**
 *       ② 防重复的前提是"逐条抽准" —— 抽样/估算都不行（抽错就会漏判重复）
 *       ③ 权威源 = `~/山河研究院/.../DSH借鉴最终方案/边界评估/00-最终方案.md`
 *
 * @contract（铁律 47）
 *   @input  — 边界评估 00-最终方案.md 的路径（argv[2]，缺省用默认路径）
 *   @output — /tmp/dsh41/items.json（41 项：id/类/名/原文）+ stdout 汇总
 *   @degraded — 源文件读不到 / 某节解析为空 ⇒ stderr + exit 2（禁静默给空清单）
 *
 * @does-not-touch  产品仓、登记件。纯读取 + 写 /tmp。
 *
 * @ref 创始人 2026-10-05 裁 A：「一定不要和其他的混淆，冲突，或者甚至造成重复建设」
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const SRC =
  process.argv[2] ??
  `${process.env.HOME}/山河研究院/04-技术研究/专题研究/DSH借鉴最终方案/边界评估/00-最终方案.md`;

let raw: string;
try {
  raw = readFileSync(SRC, 'utf-8');
} catch (e) {
  process.stderr.write(`  🔴 读不到权威源：${SRC}\n     ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(2);
}

const lines = raw.split('\n');

/** 取某个 `###` 节到下一个 `##`/`###` 之间的正文（去引用行/表格行） */
function section(kw: string): string[] {
  const i = lines.findIndex((l) => l.startsWith('###') && l.includes(kw));
  if (i < 0) return [];
  let j = lines.length;
  for (let k = i + 1; k < lines.length; k++) {
    if (/^#{2,3} /.test(lines[k])) { j = k; break; }
  }
  return lines
    .slice(i + 1, j)
    .filter((l) => !l.trim().startsWith('>') && !l.trim().startsWith('|') && !l.trim().startsWith('---'));
}

/**
 * 人工确认清单（不靠正则猜！）
 * ① 「用 DSH」节本身是单行 `／` 分隔 ⇒ 可机械切
 * ② 「参考自研」/「可裁剪」节是多段叙述 + 行内编号 ⇒ 抽出后**逐条人工校对**
 */
function splitInline(text: string): string[] {
  return text
    .split(/[／/]/)
    .map((x) => x.replace(/\*\*/g, '').replace(/^[①-⑳\d.\s、]+/, '').trim())
    .filter((x) => x.length > 2 && x.length < 120);
}

const useDSH = splitInline(section('用 DSH').join(' '));
const refSelf = splitInline(section('参考自研').join(' '));
const trimmable = splitInline(section('可裁剪').join(' '));

if (!useDSH.length || !refSelf.length || !trimmable.length) {
  process.stderr.write(
    `  🔴 解析为空（useDSH=${useDSH.length} refSelf=${refSelf.length} trim=${trimmable.length}）—— 禁给空清单\n`,
  );
  process.exit(2);
}

mkdirSync('/tmp/dsh41', { recursive: true });
writeFileSync(
  '/tmp/dsh41/items.json',
  JSON.stringify({ src: SRC, useDSH, refSelf, trimmable }, null, 2),
  'utf-8',
);

process.stdout.write(`  权威源: ${SRC}\n`);
process.stdout.write(`  ✅ 用 DSH      ${useDSH.length} 条\n`);
process.stdout.write(`  ✅ 参考自研    ${refSelf.length} 条（含叙述行，需人工校对）\n`);
process.stdout.write(`  ✅ 可裁剪      ${trimmable.length} 条（含叙述行，需人工校对）\n`);
process.stdout.write(`  → /tmp/dsh41/items.json\n`);
