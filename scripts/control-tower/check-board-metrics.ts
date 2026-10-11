#!/usr/bin/env tsx
/**
 * check-board-metrics —— 进度口径门禁（CTO 裁定 011，2026-10-11）
 *
 * 【口径（CTO 给定，逐字）】
 *   完成 = 判据 exit 0（可复跑）
 *   部分 = 部分判据达成（卡保持 open，正文记差额）
 *   撤销 = retired ⇒ 不计入完成率
 *
 * 【机器可判代理】
 *   · 完成卡 = issue closed 且**非** retired
 *   · retired = 标签匹配 /retired|撤销/
 *   · 真实完成率 = 完成卡数 /（模块总卡数 − 撤销卡数）
 *
 * 【改坏即红】
 *   一张卡被标 closed，但**没有任何已合并 PR 以交付性措辞引用它**
 *   且它不是 retired ⇒ 疑似「误标 closed」⇒ **报警 exit 1**
 *   （撤销卡请打 retired 标签，否则同样报警 —— 撤销必须显式声明）
 *
 * 【口径边界（独立复核 2026-10-11 补记）】
 *   统计与报警**只覆盖挂在模块里程碑（K*）上的卡**；
 *   无里程碑的 closed 卡既不计数也不报警（它们不进任何模块完成率）。
 *
 * 【用法】
 *   npx tsx scripts/control-tower/check-board-metrics.ts           # 报警 ⇒ exit 1
 *   npx tsx scripts/control-tower/check-board-metrics.ts --quiet   # 只打印，不报警
 */
import { readFileSync } from 'node:fs';
const API = process.env.SYNO_GITEA_API || 'http://127.0.0.1:3000/api/v1';
const REPO = process.env.SYNO_GITEA_REPO || 'synova-agent/SynovaAgent';
const TOKEN = process.env.GITEA_TOKEN || process.env.SYNO_GITEA_TOKEN ||
  (() => { try { return readFileSync((process.env.HOME ?? '') + '/gitea/.win-push-token', 'utf8').trim(); } catch { return ''; } })();
const QUIET = process.argv.includes('--quiet');

interface Issue { number: number; state: string; title: string; milestone?: { title?: string } | null; labels?: { name: string }[]; pull_request?: unknown }
interface Milestone { id: number; title: string; description?: string }

async function get<T>(path: string, method = 'GET'): Promise<T> {
  const res = await fetch(`${API}/repos/${REPO}${path}`, {
    method,
    headers: TOKEN ? { Authorization: `token ${TOKEN}` } : {},
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
  return res.json() as Promise<T>;
}
async function getAll<T>(path: string, pageSize = 50, maxPages = 40): Promise<T[]> {
  const out: T[] = [];
  for (let p = 1; p <= maxPages; p++) {
    const sep = path.includes('?') ? '&' : '?';
    const batch = await get<T[]>(`${path}${sep}limit=${pageSize}&page=${p}`);
    if (!Array.isArray(batch) || batch.length === 0) break;
    out.push(...batch);
    if (batch.length < pageSize) break;
  }
  return out;
}

/** 交付性引用（与 check-board-truth.ts 同口径，收紧版） */
export function deliveryRefsIn(text: string): number[] {
  const out = new Set<number>();
  for (const m of text.matchAll(/(?:Fixes|Closes|Resolves|Delivers|交付|已完成)\s*[:：]?\s*#(\d+)/gi)) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) out.add(n);
  }
  return [...out];
}
const isRetired = (i: Issue) => (i.labels ?? []).some((l) => /retired|撤销/i.test(l.name));

(async () => {
  let issues: Issue[], milestones: Milestone[], mergedBodies: { num: number; text: string }[];
  try {
    issues = (await getAll<Issue>('/issues?state=all&type=issues')).filter((i) => !i.pull_request);
    milestones = await get<Milestone[]>('/milestones?state=all');
    const prs = await getAll<Record<string, unknown>>('/pulls?state=all');
    mergedBodies = prs
      .filter((p) => (p as { merged?: boolean }).merged === true)
      .map((p) => { const pr = p as { number: number; title?: string; body?: string }; return { num: pr.number, text: `${pr.title ?? ''}\n${pr.body ?? ''}` }; });
  } catch (e) {
    console.error(`❌ 进度口径门禁：Gitea 不可达 ⇒ exit 2（fail-closed，禁静默通过）\n   ${(e as Error).message}`);
    process.exit(2);
  }

  // 每张 closed 卡的交付引用（已合并 PR 以交付性措辞提到它）
  const deliveredBy = new Map<number, number[]>();
  for (const { num, text } of mergedBodies) {
    for (const n of deliveryRefsIn(text)) {
      (deliveredBy.get(n) ?? deliveredBy.set(n, []).get(n)!).push(num);
    }
  }

  console.log('── 进度口径（完成 = 判据 exit 0 可复跑 ｜ 部分 = open 记差额 ｜ 撤销 = retired 不计）──\n');
  console.log('模块 ｜ 总卡 ｜ 撤销(retired) ｜ 完成卡 ｜ 真实完成率 = 完成/(总数−撤销)');
  const mislabeled: Issue[] = [];
  let grandDone = 0, grandTotal = 0;
  for (const m of milestones) {
    if (/^第\d+批/.test(m.title)) continue; // 已废弃的批次里程碑（见其描述）
    const cards = issues.filter((i) => i.milestone?.title === m.title);
    if (cards.length === 0) continue;
    const retired = cards.filter(isRetired);
    const closed = cards.filter((i) => i.state === 'closed');
    const closedNotRetired = closed.filter((i) => !isRetired(i));
    const denom = cards.length - retired.length;
    const rate = denom > 0 ? (closedNotRetired.length / denom * 100).toFixed(0) : '—';
    console.log(`${m.title.split('·')[0].trim().padEnd(4)} ｜ ${String(cards.length).padStart(3)} ｜ ${String(retired.length).padStart(3)} ｜ ${String(closedNotRetired.length).padStart(3)} ｜ ${closedNotRetired.length}/${denom} = ${rate}%`);
    grandDone += closedNotRetired.length; grandTotal += denom;
    for (const c of closed) {
      if (isRetired(c)) continue;
      if ((deliveredBy.get(c.number) ?? []).length === 0) mislabeled.push(c);
    }
  }
  console.log(`\n合计（模块里程碑）: 完成卡 ${grandDone} / 有效卡 ${grandTotal} = ${(grandTotal ? (grandDone / grandTotal * 100).toFixed(0) : '—')}%`);

  if (mislabeled.length > 0) {
    console.error(`\n🔴 疑似「误标 closed」${mislabeled.length} 张（无任何已合并 PR 以交付性措辞引用它，且非 retired）⇒ exit 1`);
    for (const c of mislabeled) console.error(`   #${c.number} [${(c.milestone?.title ?? '无里程碑').split('·')[0].trim()}] ${c.title.slice(0, 60)}`);
    console.error(`   ⇒ 处置：a) 真完成 ⇒ 让交付 PR 正文补 \`Closes #N\`（回填上游信号）`);
    console.error(`           b) 撤销 ⇒ 打 \`执行态/retired\` 标签（口径：撤销不计入完成率）`);
    console.error(`           c) 误关 ⇒ reopen`);
    if (QUIET) process.exit(0);
    process.exit(1);
  }
  console.log('✅ 无「误标 closed」：每张 closed 卡都有交付性引用或 retired 标签');
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
