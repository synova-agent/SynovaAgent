#!/usr/bin/env node
/**
 * 施工项登记 → markdown 视图（生成器）
 *
 * @why  约束只活在 markdown 里 → 会漂移（T6 面 3 反例：负责人列 5/10 格不是负责人）。
 *       故：`施工项登记.ts` 是**源**，本脚本生成的 `.md` 是**视图**，人只改源。
 *
 * @contract（铁律 47）
 *   @input  — `--out <path>`（默认 stdout）；无其它参数。
 *   @output — markdown 文本：块表 + 40 项明细 + 域分布 + 违纪摘要
 *   @degraded — 源文件读取失败 ⇒ log.error + exit 2（不静默当空）
 *
 * @gate 本脚本自身是生成器，不进 CI 阻断链；它的**产物**若入仓须过 D2 登记门禁。
 *       三条不变量由 `scripts/control-tower/check-construction-registry.py` 执行（治理线域）。
 *
 * @ref origin/main@1630a5014（2026-10-04 14:47）
 */

import { writeFileSync } from 'node:fs';
import {
  constructionItems,
  constructionBlocks,
  deriveOwner,
  type AcceptanceStep,
} from '../施工项登记.ts';

function fmtAcceptance(a: readonly AcceptanceStep[]): string {
  return a
    .map((s) => {
      const exp = s.expectRowsGt
        ? `rows(${s.expectRowsGt.table}) > ${s.expectRowsGt.n}`
        : s.expectStdoutContains
          ? `stdout ⊇ "${s.expectStdoutContains}"`
          : `exit = ${s.expectExit}`;
      return `\`${s.run}\` ⇒ **${exp}**`;
    })
    .join('<br/>');
}

function main(): number {
  const outIdx = process.argv.indexOf('--out');
  const outPath = outIdx > -1 ? process.argv[outIdx + 1] : undefined;

  const items = constructionItems;
  const blocks = constructionBlocks;

  // 域分布（由 paths 推导，不是手填）
  const dist = new Map<string, number>();
  const unowned: string[] = [];
  for (const it of items) {
    if (it.paths.length === 0) {
      unowned.push(it.id);
      dist.set('(无落点·待裁)', (dist.get('(无落点·待裁)') ?? 0) + 1);
      continue;
    }
    const o = deriveOwner(it.paths) ?? '(推导失败)';
    if (o === '(推导失败)') unowned.push(it.id);
    dist.set(o, (dist.get(o) ?? 0) + 1);
  }

  const L: string[] = [];
  L.push('# 施工项登记 · 视图（**生成物，勿手改**）');
  L.push('');
  L.push(`> **源**：\`docs/synova/coordination/施工项登记.ts\` ｜ **生成器**：\`scripts/control-tower/gen-construction-registry.ts\``);
  L.push(`> **ref**：origin/main@1630a5014 ｜ **项数** ${items.length} ｜ **块数** ${blocks.length}`);
  L.push(`> 🔴 本文件是视图：**改约束请改源**。手改本文件会在下次生成时被覆盖。`);
  L.push('');
  L.push('---');
  L.push('');
  L.push('## 一、域分布（**由 paths 推导，非人填**）');
  L.push('');
  L.push('| 域 | 项数 | 说明 |');
  L.push('|---|---|---|');
  const OWNER_DESC: Record<string, string> = {
    mac: 'Mac DSH — 控制塔/哨兵/桌面/协调文档',
    win: 'Win Claude — 诊断 L1-L5/本体/扩展',
    k3: 'Kimi K3 — 审计线（红线）',
    '(无落点·待裁)': '🔴 落点未定 ⇒ 无主，需 CTO/创始人裁',
  };
  for (const [k, v] of [...dist.entries()].sort((a, b) => b[1] - a[1])) {
    L.push(`| ${k} | ${v} | ${OWNER_DESC[k] ?? '—'} |`);
  }
  L.push('');
  if (unowned.length) {
    L.push(`🔴 **无主项（${unowned.length}）**：${unowned.join(' · ')}`);
    L.push('');
  }
  L.push('---');
  L.push('');
  L.push('## 二、10 块');
  L.push('');
  L.push('| 块 | 名称 | 覆盖项 | 依赖的块 | 块级完成标准 |');
  L.push('|---|---|---|---|---|');
  for (const b of blocks) {
    L.push(
      `| **${b.id}** | ${b.name} | ${b.items.join(', ')} | ${b.dependsOnBlocks.join(', ') || '无'} | ${fmtAcceptance(b.blockAcceptance)} |`,
    );
  }
  L.push('');
  L.push('---');
  L.push('');
  L.push('## 三、40 项明细');
  L.push('');
  for (const it of items) {
    const owner = it.paths.length ? (deriveOwner(it.paths) ?? '🔴推导失败') : '🔴无落点·待裁';
    L.push(`### ${it.id} · ${it.title}`);
    L.push('');
    L.push(`- **批次 / 块**：${it.batch} / ${it.block} ｜ **状态**：${it.status}`);
    L.push(`- **域（推导）**：\`${owner}\`${it.pathTBD ? ' ⚠️ pathTBD' : ''}`);
    L.push(`- **写集**：${it.paths.length ? it.paths.map((p) => `\`${p}\``).join(' · ') : '🔴 未定'}`);
    L.push(`- **依赖**：${it.dependsOn.length ? it.dependsOn.join(', ') : '无'}`);
    if (it.createsTable) {
      L.push(`- **建表**：\`${it.createsTable.name}\` ｜ NOT NULL 字段 ${it.createsTable.notNullFields.length} 个（INV-1 逐个查生产者）`);
    }
    L.push(`- **完成标准**：${fmtAcceptance(it.acceptance)}`);
    L.push(`- **出处**：${it.source}`);
    L.push('');
  }

  const text = L.join('\n');
  if (outPath) {
    try {
      writeFileSync(outPath, text, 'utf-8');
      process.stderr.write(`  ✅ 已生成 ${outPath}（${text.split('\n').length} 行）\n`);
    } catch (e) {
      process.stderr.write(`  🔴 写出失败: ${e instanceof Error ? e.message : String(e)}\n`);
      return 2;
    }
  } else {
    process.stdout.write(text);
  }
  return 0;
}

process.exit(main());
