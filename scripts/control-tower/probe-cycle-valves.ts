/**
 * scripts/control-tower/probe-cycle-valves.ts — #239（K4-06）判据交付物
 *
 * 背景：宪章 §0.4 明文要求 ① 循环层含「**五阀映射** ＋ `action_effect_lag`」；
 * 实测（CTO 2026-10-12 开工令）：`cycles/**` 内 `*Valve` / `actionEffectLag` **0 命中** ⇒ 真缺口。
 * 本探针把「六件 cycle 是否齐备且形态合规」做成**机器可跑判据**。
 *
 * 形态权威源（**逐字**）:
 *   `docs/synova/research/权威文档15-企业循环溢出导航系统-20260714/`
 *   `SYNOVA-RESEARCH-第一章-循环配置规范与动态加载机制-v1-0-20260714.md`
 *   节锚点：``### 3.4 `edges` -- 五阀映射（含action_effect_lag）``
 *   ⚠️ 是 **第一章 §3.4**；第三章另有一个同名 `### 3.4 执行约束因子模型`，**同名不同物**（陷阱）。
 *
 * 判据:
 *   ① 每件 `*.cycle.json` 含 `valves`，且**五个阀键齐备**：
 *      `acquisitionValve` / `allocationValve` / `conversionValve` / `deliveryValve` / `recycleValve`
 *   ② 每个阀**至少 1 条**边；每条边形如 `{ edgeId: string, actionEffectLag: <6 桶之一> }`
 *   ③ `actionEffectLag` ⊂ 6 桶集合（含 `>12_months`；CTO 派单件曾只列 5 桶，漏此桶 —— 已登记）
 *   ④ 既有 `edges[]`（图结构）**未被覆盖**（本探针断言其仍为非空数组 ⇒ CTO「新 key 不覆盖」裁定生效）
 *   ⑤ 本探针自身 exit 0
 *
 * ⚠️ 口径声明（防漂移）:
 *   · `valves[].edgeId` 存的是 **权威文档15 §3.4 的原样形态（`E-NN`）**，
 *     **不是** `edgeRefs`/`mapping.edgeId` 的代码侧 `$id`（`edge/<snake>`）。
 *     两者对应关系及「哪些 E 号换算不出 `$id`」见 `docs/synova/coordination/numbering-authority.md`（#238）。
 *   · 本探针**不**读 `extensions/ontology/edge-types/`，**不**依赖其件数或字段分布（与 K4-01/02/05bis 解耦）。
 *
 * 契约:
 *   @input   — 无参数。读取 `${cwd}/cycles/**\/*.cycle.json`
 *   @output  — stdout：判据①②③④ 的原始计数与逐文件明细；末行恒为摘要行
 *   @degraded — `cycles/` 缺失/为空 ⇒ exit 2（fail-closed，绝不静默通过）；
 *               单个 .cycle.json 解析失败 ⇒ 计入违规 + 打 `❌`，exit 1（不吞错）
 *   退出码   — 0 = 全部合规；1 = 存在违规；2 = 输入缺失（降级）
 *
 * 用法:
 *   node scripts/control-tower/probe-cycle-valves.ts      # Node ≥ 22 原生类型擦除
 *   npx tsx scripts/control-tower/probe-cycle-valves.ts
 *
 * 反例（判别性）:
 *   ⑥ 删任一 cycle 的任一阀字段 ⇒ 判据① 必红（exit 1）
 *   ⑦ 任一条 `actionEffectLag` 改成非法桶（如 `"soon"`）⇒ 判据③ 必红
 *   ⑧ 把 `valves` 写成覆盖 `edges[]`（删掉 `edges`）⇒ 判据④ 必红
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { join, relative } from 'path';

const CWD = process.cwd();
const CYCLES_ROOT = join(CWD, 'cycles');

/** 五阀键名（逐字对齐 doc15 第一章 §3.4） */
const VALVE_KEYS = [
  'acquisitionValve',
  'allocationValve',
  'conversionValve',
  'deliveryValve',
  'recycleValve',
] as const;

/** 6 桶桶标签（逐字对齐 doc15 第一章 §3.4 的桶图例，含 `>12_months`） */
const LAG_BUCKETS = ['immediate', '1_month', '1-3_months', '3-6_months', '6-12_months', '>12_months'] as const;

interface Violation {
  file: string;
  where: string;
  reason: string;
}

interface FileReport {
  file: string;
  valveKeys: number;
  edges: number;
  edgesArrayKept: boolean;
  violations: number;
}

function collectCycleFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectCycleFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.cycle.json')) out.push(full);
  }
  return out;
}

function main(): number {
  if (!existsSync(CYCLES_ROOT) || !statSync(CYCLES_ROOT).isDirectory()) {
    console.error(`❌ 降级：${CYCLES_ROOT} 不存在 — 被判体缺失，fail-closed（exit 2）`);
    return 2;
  }
  const files = collectCycleFiles(CYCLES_ROOT);
  if (files.length === 0) {
    console.error(`❌ 降级：${CYCLES_ROOT} 下无 *.cycle.json — fail-closed（exit 2）`);
    return 2;
  }

  const reports: FileReport[] = [];
  const violations: Violation[] = [];
  const bucketHistogram = new Map<string, number>();
  let totalEdges = 0;

  for (const file of files) {
    const rel = relative(CWD, file).split('\\').join('/');
    const local: Violation[] = [];
    let valveKeys = 0;
    let edges = 0;
    let edgesArrayKept = false;

    try {
      const raw = readFileSync(file, 'utf-8');
      const parsed = JSON.parse(raw) as {
        cycleId?: unknown;
        edges?: unknown;
        valves?: unknown;
      };
      const cid = typeof parsed.cycleId === 'string' ? parsed.cycleId : rel;

      // ─── 判据④ 既有 edges[] 未被覆盖 ───
      edgesArrayKept = Array.isArray(parsed.edges) && (parsed.edges as unknown[]).length > 0;
      if (!edgesArrayKept) {
        local.push({ file: rel, where: 'edges[]', reason: '判据④ 违规：既有图结构 edges[] 缺失/为空（CTO 裁定「新 key 不覆盖 edges[]」）' });
      }

      // ─── 判据① valves 存在 + 五阀键齐备 ───
      const valves = parsed.valves;
      if (valves === undefined || valves === null) {
        local.push({ file: rel, where: 'valves', reason: '判据① 违规：valves 缺失（五阀映射未配置）' });
      } else if (typeof valves !== 'object' || Array.isArray(valves)) {
        local.push({ file: rel, where: 'valves', reason: '判据① 违规：valves 形态非法（应为对象）' });
      } else {
        const bag = valves as Record<string, unknown>;
        for (const key of VALVE_KEYS) {
          const arr = bag[key];
          if (arr === undefined || arr === null) {
            local.push({ file: rel, where: `valves.${key}`, reason: `判据① 违规：${key} 缺失` });
            continue;
          }
          if (!Array.isArray(arr)) {
            local.push({ file: rel, where: `valves.${key}`, reason: `判据① 违规：${key} 形态非法（应为数组）` });
            continue;
          }
          if (arr.length === 0) {
            local.push({ file: rel, where: `valves.${key}`, reason: `判据② 违规：${key} 为空（该阀至少需 1 条边）` });
            continue;
          }
          valveKeys += 1;
          // ─── 判据②③ 元素形态 + 桶合法性 ───
          arr.forEach((entry, i) => {
            const e = entry as { edgeId?: unknown; actionEffectLag?: unknown };
            if (typeof e.edgeId !== 'string' || e.edgeId.trim() === '') {
              local.push({ file: rel, where: `valves.${key}[${i}].edgeId`, reason: '判据② 违规：edgeId 缺失或非字符串' });
            }
            if (typeof e.actionEffectLag !== 'string' || !(LAG_BUCKETS as readonly string[]).includes(e.actionEffectLag)) {
              local.push({
                file: rel,
                where: `valves.${key}[${i}].actionEffectLag`,
                reason: `判据③ 违规：actionEffectLag=${JSON.stringify(e.actionEffectLag)} ∉ 6 桶（${LAG_BUCKETS.join(' / ')}）`,
              });
            } else {
              bucketHistogram.set(e.actionEffectLag, (bucketHistogram.get(e.actionEffectLag) ?? 0) + 1);
            }
          });
          edges += arr.length;
        }
      }

      void cid;
      totalEdges += edges;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      local.push({ file: rel, where: '(json)', reason: `无法校验：JSON 解析失败 — ${msg}` });
    }

    reports.push({ file: rel, valveKeys, edges, edgesArrayKept, violations: local.length });
    violations.push(...local);
  }

  console.log(`══════ 判据① valves 存在 + 五阀键齐备（口径：5 键逐字对齐 doc15 第一章 §3.4）`);
  console.log(`cycle_files = ${files.length}`);
  console.log('');
  console.log('══════ 逐文件明细');
  console.log('file | valve_keys(≤5) | valve_edges | edges[]_kept | violations');
  for (const r of reports) {
    console.log(`${r.file} | ${r.valveKeys} | ${r.edges} | ${r.edgesArrayKept ? 'yes' : 'NO'} | ${r.violations}`);
  }
  console.log(`TOTAL_valve_edges = ${totalEdges}`);
  console.log('');
  console.log('══════ 判据③ actionEffectLag ⊂ 6 桶');
  console.log(`lag_buckets = ${LAG_BUCKETS.join(' ')}`);
  console.log(`lag_buckets_count = ${LAG_BUCKETS.length}   （规范 6 桶）`);
  console.log('bucket_histogram（逐桶实用条数）:');
  for (const b of LAG_BUCKETS) console.log(`  ${b} = ${bucketHistogram.get(b) ?? 0}`);
  const usedBuckets = LAG_BUCKETS.filter(b => (bucketHistogram.get(b) ?? 0) > 0);
  console.log(`lag_buckets_used = ${usedBuckets.length}   （实用桶数；规范 6 / 实用 ${usedBuckets.length}）`);
  console.log(`lag_unused_buckets = ${LAG_BUCKETS.filter(b => (bucketHistogram.get(b) ?? 0) === 0).join(',') || '(none)'}`);
  console.log('');

  const compliant = reports.filter(r => r.violations === 0 && r.valveKeys === VALVE_KEYS.length).length;
  if (violations.length > 0) {
    console.log('══════ ❌ 违规明细');
    for (const v of violations) {
      console.log(`❌ ${v.file} @ ${v.where} — ${v.reason}`);
    }
    console.log('');
    console.log(`❌ 结论：${violations.length} 项违规 — exit 1`);
    console.log(`valve_files=${files.length} compliant=${compliant} violations=${violations.length}`);
    return 1;
  }

  console.log(`✅ 结论：${files.length}/${files.length} 件含完整五阀映射（5 键齐备 + 桶合法 + edges[] 未被覆盖）；exit 0`);
  console.log(`valve_files=${files.length} compliant=${compliant} violations=0`);
  return 0;
}

process.exit(main());
