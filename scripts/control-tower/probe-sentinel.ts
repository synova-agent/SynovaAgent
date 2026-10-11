#!/usr/bin/env npx tsx
/**
 * scripts/control-tower/probe-sentinel.ts — 哨兵判据探针（#37 / 施工单 3-8 · K3-3-8）
 *
 * 用法: npx tsx scripts/control-tower/probe-sentinel.ts <sentinel-name>
 *       当前实现目标: agent-opportunity-window（宪章 §3.6 报正向）
 *
 * 三态退出码（判例 M-02，禁恒绿）:
 *   0 = 全部断言通过（含正向发现 + 增强阈值门控反例）
 *   1 = 断言失败（fail-closed，禁静默放行）
 *   2 = 未实现 / 探针自身异常（哨兵未被 loader 发现、模块缺失等）
 *
 * 断言段（禁止"跑通即过"，逐条写明）:
 *   S1 LOADER  — 生产 loader loadSentinels() 扫描 extensions/sentinels/ 发现该哨兵
 *                （接线证据：与生产同一条扫描管线，非直接 JSON.parse）
 *   S2 MANIFEST— computes[] 与 computes/ 目录实际文件一一对应；entryPoint/exportKey 存在
 *   S3 IMPORT  — 经 toImportSpecifier 动态 import entryPoint，导出符号有 check()（生产同路径）
 *   S4 POSITIVE— 注入增强数据跑 check() ⇒ 恰产出 1 条 polarity='positive'、severity='info'、
 *                evidence/suggestion 非空的正向发现（宪章 §3.6「报正向」独立产出类别）
 *   S5 GATE    — 同数据 + 增强阈值调为不可达（warning=9）⇒ 正向发现为 0
 *                （增强阈值真实门控；若哨兵忽略阈值，本段必红）
 *   S6 DEGRADED— 空图 ⇒ degraded=true（铁律 24/31，不编假值）
 */
import { existsSync, readdirSync } from 'fs';
import { dirname, join, resolve } from 'path';

function locateRepoRoot(): string {
  let cur = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(cur, 'src', 'sentinel', 'sentinel-loader.ts'))) return cur;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  throw new Error('无法定位仓库根（未找到 src/sentinel/sentinel-loader.ts）');
}

interface Node { id: string; type: string; props: Record<string, unknown> }
interface GSR { queryNodes(t: string, f?: Record<string, unknown>): Node[] }

/** 夹具图：就绪度足以越过默认增强阈值 0.6（score≈0.77） */
function favorableStore(): GSR {
  return {
    queryNodes(t: string): Node[] {
      if (t === 'Tool') {
        return [
          { id: 't1', type: 'Tool', props: { tid: 'org-x', llm: true } },
          { id: 't2', type: 'Tool', props: { tid: 'org-x', protocol: 'http' } },
          { id: 't3', type: 'Tool', props: { tid: 'org-x', agent: true } },
          { id: 't4', type: 'Tool', props: { tid: 'org-x' } },
        ];
      }
      if (t === 'Process') {
        return [
          { id: 'p1', type: 'Process', props: { tid: 'org-x', digitized: true } },
          { id: 'p2', type: 'Process', props: { tid: 'org-x', automated: true } },
          { id: 'p3', type: 'Process', props: { tid: 'org-x', digitized: true } },
          { id: 'p4', type: 'Process', props: { tid: 'org-x' } },
          { id: 'p5', type: 'Process', props: { tid: 'org-x' } },
        ];
      }
      return [];
    },
  };
}

const emptyStore: GSR = { queryNodes: () => [] };

interface Checkable { check(s: GSR, tid: string, traversal?: unknown, thresholds?: Record<string, { warning: number; critical: number }>): Promise<unknown> }
function isPositiveFindings(v: unknown): v is Array<{ polarity?: string; severity: string; evidence: string[]; suggestion: string; id: string }> {
  return Array.isArray(v) && v.every(f => typeof f === 'object' && f !== null && 'severity' in f);
}
function asAggregate(v: unknown): { findings: unknown[]; degraded?: boolean } | null {
  if (typeof v === 'object' && v !== null && 'findings' in v) return v as { findings: unknown[]; degraded?: boolean };
  return null;
}

async function main(): Promise<number> {
  const sentinelName = process.argv[2] || 'agent-opportunity-window';
  let repoRoot: string;
  try {
    repoRoot = locateRepoRoot();
  } catch (err) {
    console.error('[NOT-IMPLEMENTED]', err instanceof Error ? err.message : String(err));
    return 2;
  }
  process.chdir(repoRoot);
  const fails: string[] = [];
  const ok = (msg: string) => console.log(`  [PASS] ${msg}`);
  const bad = (msg: string) => { fails.push(msg); console.log(`  [FAIL] ${msg}`); };

  try {
    // ── S1 LOADER（生产扫描管线）──
    const { loadSentinels: load } = await import('../../src/sentinel/sentinel-loader');
    const { sentinels, degraded: loadDegraded, errors } = load();
    const found = sentinels.find(s => s.manifest.name === sentinelName);
    if (!found) {
      console.error(`[NOT-IMPLEMENTED] loader 未发现哨兵 '${sentinelName}'（extensions/sentinels/ 下无此目录或 manifest）`);
      return 2;
    }
    if (loadDegraded && errors.some(e => e.includes(sentinelName))) bad(`S1 loader 报该哨兵错误: ${errors.join('; ')}`);
    else ok(`S1 loader 发现哨兵 ${sentinelName}（共扫描 ${sentinels.length} 个）`);

    // ── S2 MANIFEST ──
    const { manifest, dir } = found;
    const computesDir = join(dir, 'computes');
    const actualComputeFiles = existsSync(computesDir)
      ? readdirSync(computesDir).filter(f => f.startsWith('compute-') && f.endsWith('.ts')).map(f => f.replace(/\.ts$/, '')).sort()
      : [];
    const declared = [...manifest.computes].sort();
    if (JSON.stringify(declared) === JSON.stringify(actualComputeFiles)) ok(`S2 computes 声明与目录一致: ${declared.join(',')}`);
    else bad(`S2 computes 不一致: manifest=${declared.join(',')} vs 目录=${actualComputeFiles.join(',')}`);
    if (!manifest.entryPoint || !manifest.exportKey) bad('S2 manifest 缺 entryPoint/exportKey');
    else ok(`S2 entryPoint=${manifest.entryPoint} exportKey=${manifest.exportKey}`);

    // ── S3 IMPORT（生产同路径：toImportSpecifier 动态 import）──
    const { toImportSpecifier } = await import('../../src/sentinel/builtins');
    const entryAbs = resolve(dir, manifest.entryPoint);
    const mod = (await import(toImportSpecifier(entryAbs))) as Record<string, unknown>;
    const sentinelObj = mod[manifest.exportKey] as (Checkable & { manifest?: unknown }) | undefined;
    if (!sentinelObj || typeof sentinelObj.check !== 'function') throw new Error(`S3 ${manifest.exportKey}.check 不是函数`);
    // 生产接线复刻（loader P0-1）：注册前把 manifest 挂到哨兵对象，阈值 finding 依赖 this.manifest
    if ('manifest' in sentinelObj) sentinelObj.manifest = manifest;
    ok(`S3 经 toImportSpecifier 动态 import 拿到 ${manifest.exportKey}.check（并按 loader P0-1 挂载 manifest）`);

    // ── S4 POSITIVE（报正向产出）──
    const r4 = await sentinelObj.check(favorableStore(), 'org-x');
    const agg4 = asAggregate(r4);
    const findings4 = agg4 ? agg4.findings : r4;
    if (!isPositiveFindings(findings4)) bad('S4 check 返回形态非 findings');
    else {
      const positives = findings4.filter(f => f.polarity === 'positive');
      if (positives.length === 1 && positives[0].severity === 'info' && positives[0].evidence.length > 0 && positives[0].suggestion.length > 0) {
        ok(`S4 正向发现 1 条: id=${positives[0].id} severity=info polarity=positive`);
      } else bad(`S4 正向发现异常: ${JSON.stringify(positives)}`);
    }

    // ── S5 GATE（增强阈值不可达 ⇒ 必无正向发现）──
    const r5 = await sentinelObj.check(favorableStore(), 'org-x', undefined, { opportunityScore: { warning: 9, critical: 10 } });
    const agg5 = asAggregate(r5);
    const findings5 = agg5 ? agg5.findings : r5;
    if (isPositiveFindings(findings5) && findings5.filter(f => f.polarity === 'positive').length === 0) {
      ok('S5 增强阈值调为不可达(warning=9) ⇒ 正向发现 0 条（门控生效）');
    } else bad('S5 增强阈值不可达时仍产正向发现 — 阈值门控失效');

    // ── S6 DEGRADED ──
    const r6 = await sentinelObj.check(emptyStore, 'org-x');
    const agg6 = asAggregate(r6);
    if (agg6 && agg6.degraded === true) ok('S6 空图 ⇒ degraded=true（不编假值）');
    else bad(`S6 空图未置 degraded: ${JSON.stringify(r6)}`);

    if (fails.length > 0) {
      console.error(`SUMMARY: ${fails.length} 断言失败`);
      return 1;
    }
    console.log(`SUMMARY: ${sentinelName} 全部断言通过（S1-S6）`);
    return 0;
  } catch (err) {
    console.error('[NOT-IMPLEMENTED] 探针自身异常:', err instanceof Error ? err.stack ?? err.message : String(err));
    return 2;
  }
}

main().then(code => { process.exit(code); }).catch(err => {
  console.error('[NOT-IMPLEMENTED]', err);
  process.exit(2);
});
