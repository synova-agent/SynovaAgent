#!/usr/bin/env node
/**
 * 模块父 Issue 骨架生成器（K1–K10 → /tmp/kmod/<K>.md）
 *
 * @why  创始人的 GitHub 可视化需求：把「10 个模块」变成板上可见的父 Issue，
 *       用 GitHub 原生 Parent issue + Sub-issues progress 自动算完成度。
 *       父 Issue 的**身体必须来自登记件**（禁手写），否则又成"文档与机器源两套"。
 *
 * @contract（铁律 47）
 *   @input  — 无参。读 `../施工项登记.ts`。
 *   @output — /tmp/kmod/{K1..K10}.md（Issue 正文）+ stdout 汇总；exit 0=成功
 *   @degraded — 登记件读不到 ⇒ stderr + exit 2
 *
 * @ref origin/main@1630a5014（2026-10-04）
 */

import { mkdirSync, writeFileSync } from 'node:fs';

type Acc = {
  run: string;
  expectExit?: number;
  expectStdoutContains?: string;
  expectRowsGt?: { table: string; n: number };
};

const mod = await import('../施工项登记.ts').catch((e: unknown) => {
  process.stderr.write(`  🔴 登记件读不到：${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(2);
});
const { constructionBlocks: B, constructionItems: I, deriveBlockDeps } = mod;

const by = new Map(I.map((i) => [i.id, i]));
const deps = deriveBlockDeps();
const fmtAcc = (a: Acc): string =>
  `\`${a.run}\` ⇒ **${
    a.expectRowsGt ? `rows(${a.expectRowsGt.table}) > ${a.expectRowsGt.n}` : a.expectStdoutContains ? `stdout ⊇ "${a.expectStdoutContains}"` : `exit = ${a.expectExit}`
  }**`;

mkdirSync('/tmp/kmod', { recursive: true });

for (const b of B) {
  const items = b.items.map((id) => by.get(id)).filter((x): x is NonNullable<typeof x> => Boolean(x));
  const rows = items
    .map((i) => `| \`${i.id}\` | ${i.title.slice(0, 44)} | ${i.worker} | ${i.status} |`)
    .join('\n');
  const acc = b.blockAcceptance.map((a) => `- ${fmtAcc(a as Acc)}`).join('\n');
  const body = [
    '**坐标系**',
    `总闸: ${b.id === 'K1' ? '是（全系统总闸）' : '不适用'}`,
    `承重件: ${b.id === 'K3' ? 'W1' : '不适用'}`,
    '批次: 不适用',
    `命名空间: ${b.id}`,
    '执行态: 未开工',
    '验证级别: L2-真跑通',
    '阻塞源: 无阻塞',
    '',
    '## 本模块是什么',
    '',
    b.name,
    '',
    `出处: ${b.source}`,
    '',
    `## 覆盖施工项（${b.items.length} 项）`,
    '',
    '| 施工项 | 标题 | 派给 | 状态 |',
    '|---|---|---|---|',
    rows,
    '',
    '## 块间依赖（**自动汇总，禁手补**）',
    '',
    deps[b.id] && deps[b.id].length ? deps[b.id].join(' → 前置 ') : '无',
    '',
    '## 块级完成标准（**穿生产入口，禁 grep 型**）',
    '',
    acc,
    '',
    '## 判据来源',
    '',
    '登记件 `docs/synova/coordination/施工项登记.ts`（CTO 域；DOC-0184 同批）',
    '',
    '🔴 本模块的完成标准由执法体 `check-construction-registry.ts` 机械校验；',
    '执法体**未接线**（见 #1035）⇒ 当前「0 违规」是本机结论，**非门禁结论**。',
  ].join('\n');
  writeFileSync(`/tmp/kmod/${b.id}.md`, body, 'utf-8');
}

process.stdout.write(`  ✅ 已生成 ${B.length} 个模块骨架 → /tmp/kmod/{${B.map((b) => b.id).join(',')}}.md\n`);
