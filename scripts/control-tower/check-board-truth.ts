#!/usr/bin/env tsx
/**
 * check-board-truth —— 看板真值门禁（CTO 2026-10-11 立）
 *
 * 【要治的病】K12 实测事故：7 张卡**判据已达、PR 已合**，而 issue 仍 open、
 *   标签仍写「执行态/未开工」⇒ 里程碑进度显示 **10%**，真实 **38%**。
 *   ⇒ **交付与回填是两件事，没人把它们绑在一起** ⇒ 看板失去意义。
 *
 * 【判据（可机器判，不靠纪律）】
 *   已合并 PR 的标题/正文里引用的 `#NNN`，若对应 issue **仍是 open** ⇒ **报差异**
 *   （依据：PR 合并 = 交付动作已发生；issue 未关 = 回填动作漏了）
 *
 * 【降级/边界（诚实声明）】
 *   · 只认 **merged PR 的显式引用**（`#N` 在 title/body）⇒ 引用缺失 ⇒ 本门禁**看不见**
 *     （补：鼓励 PR 正文写 `Fixes #N` / `Refs #N`）
 *   · 不判「判据是否真 exit 0」（那要跑判据，贵）；本门禁只判**状态一致性**
 *   · 不可达 Gitea ⇒ **exit 2**（fail-closed，禁静默通过 —— 铁律 31）
 *
 * 【用法】
 *   npx tsx scripts/control-tower/check-board-truth.ts            # 有差异 ⇒ exit 1
 *   npx tsx scripts/control-tower/check-board-truth.ts --warn      # 只告警 ⇒ exit 0
 *     存量只告警、新增必拦（门禁纪律）
 */
import { readFileSync } from 'node:fs';
const API = process.env.SYNO_GITEA_API || 'http://127.0.0.1:3000/api/v1';
const REPO = process.env.SYNO_GITEA_REPO || 'synova-agent/SynovaAgent';
const TOKEN = process.env.GITEA_TOKEN || process.env.SYNO_GITEA_TOKEN ||
  (() => { try { return readFileSync((process.env.HOME ?? '') + '/gitea/.win-push-token', 'utf8').trim(); } catch { return ''; } })();
const WARN_ONLY = process.argv.includes('--warn');

interface Issue { number: number; state: string; title: string; pull_request?: unknown }

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}/repos/${REPO}${path}`, {
    headers: TOKEN ? { Authorization: `token ${TOKEN}` } : {},
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
  return res.json() as Promise<T>;
}

/** 分页拉全（禁 --limit 静默饱和：实测 --limit 100 会给假数） */
async function getAll<T>(path: string, pageSize = 50, maxPages = 20): Promise<T[]> {
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

function refsIn(text: string): number[] {
  const out = new Set<number>();
  // 🔴 2026-10-12 修正（**同类错误第二次 ⇒ CTO 认下本门禁的缺陷**）
  //   原实现 = 纯文本匹配 ⇒ **无法区分「引述」与「声明」** ⇒
  //   **"描述这个事故"本身就会触发本门禁** —— 实测两次（PR #371 / #385 的更正段引述被读成交付引用），
  //   根因是**判据的作用域未排除"引述位置"**。
  //   ⇒ 修正三层：
  //     ① 剥**围栏代码块**（```…```）—— 引述最常见的位置
  //     ② 剥**行内码**（`…`）—— 描述字符串字面量时用
  //     ③ 剥**引用块**（行首 > ）—— 引用他人原话
  //     ④ 只认**行首锚**（可选列表标记）的声明位置 —— 真声明通常独立成行或以列表项写出
  const stripped = text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]*`/g, '')
    .replace(/^[ \t]*>.*$/gm, '');
  for (const m of stripped.matchAll(/^[ \t]*(?:[-*+]\s+)?(?:Fixes|Closes|Resolves|Delivers|交付|已完成)\s*[:：]?\s*#(\d+)/gim)) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) out.add(n);
  }
  return [...out];
}


(async () => {
  let issues: Issue[], prs: Record<string, unknown>[];
  try {
    issues = (await getAll<Issue>('/issues?state=all&type=issues')).filter((i) => !i.pull_request);
    prs = await getAll<Record<string, unknown>>('/pulls?state=all');
  } catch (e) {
    console.error(`❌ 看板真值门禁：Gitea 不可达 ⇒ exit 2（fail-closed，禁静默通过）\n   ${(e as Error).message}`);
    process.exit(2);
  }

  const byNum = new Map(issues.map((i) => [i.number, i]));
  const merged = prs.filter((p) => (p as { merged?: boolean }).merged === true);
  const stale = new Map<number, string[]>();   // issue 号 → 引用它的已合并 PR

  for (const p of merged) {
    const pr = p as { number: number; title?: string; body?: string };
    const text = `${pr.title ?? ''}\n${pr.body ?? ''}`;
    for (const n of refsIn(text)) {
      const iss = byNum.get(n);
      if (!iss) continue;                 // 引用的是 PR 号或不存在 ⇒ 跳过
      if (iss.state !== 'open') continue; // 已关 ⇒ 正常
      const arr = stale.get(n) ?? [];
      arr.push(`PR #${pr.number}`);
      stale.set(n, arr);
    }
  }

  // 🔴 判别力自检（2026-10-11 立，纪律第 4 条「判据本身也要被验」的推广）
  //   实测事故：收紧正则后本门禁**永远绿** —— 因为**上游 PR 没人写交付性措辞** ⇒ 零判别力。
  //   ⇒ 若"含交付性引用的 PR 数 == 0" ⇒ 本门禁**无牙** ⇒ exit 2（禁把"看不见"当"没问题"）
  const prsWithRefs = merged.filter((p) => {
    const pr = p as { title?: string; body?: string };
    return refsIn(`${pr.title ?? ''}\n${pr.body ?? ''}`).length > 0;
  }).length;
  if (prsWithRefs === 0) {
    console.error(`❌ 看板真值门禁**无判别力** ⇒ exit 2`);
    console.error(`   依据：${merged.length} 个已合并 PR 中，**含交付性引用（Fixes/Closes/Resolves/交付 #N）的 = 0**`);
    console.error(`   ⇒ 本门禁当前的"绿"不构成证据（它什么都看不见）`);
    console.error(`   ⇒ 处置：要求 PR 正文写 \`Closes #N\`，或改用第二信号（PR 改动面 ∩ 卡写集）`);
    process.exit(2);
  }
  console.log(`── 看板真值：检查 ${issues.length} 个 issue / ${merged.length} 个已合并 PR（含交付性引用 ${prsWithRefs} 个）──`);
  if (stale.size === 0) {
    console.log('✅ 无「已合并 PR 引用但仍 open」的卡');
    process.exit(0);
  }
  console.log(`🔴 发现 ${stale.size} 张卡：**已合并 PR 引用了它，但 issue 仍 open**（= 回填漏了）\n`);
  for (const [n, refs] of [...stale.entries()].sort((a, b) => a[0] - b[0])) {
    const iss = byNum.get(n)!;
    console.log(`   #${n}  ${iss.title.slice(0, 52)}`);
    console.log(`        引用它的已合并 PR：${refs.join(', ')}`);
  }
  console.log(`\n⇒ 处置：核判据；已达 ⇒ 关 issue + 标签改 \`执行态/已交付\` + 正文附证据`);
  console.log(WARN_ONLY ? '⚠️ --warn 模式：只告警，exit 0' : '❌ exit 1（回填漏项存在）');
  process.exit(WARN_ONLY ? 0 : 1);
})();
