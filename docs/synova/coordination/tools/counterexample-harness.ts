#!/usr/bin/env node
/**
 * 执法体反例验证台（a–h 八条）
 *
 * @why  复核方（T8）判「不是纸老虎」靠的是**构造反例让它红**。
 *       CTO 整改 4 处 P0 后，必须用同一手法自证整改真伪 —— 否则"修好了"只是声称。
 *       本文件把 8 条反例固化下来，任何人可复跑。
 *
 * @why-not-caller  本文件是【验证台】不是【执法体】。执法体是 check-construction-registry.ts。
 *                  验证台在 /tmp 造副本、注入缺陷、跑执法体、比对 exit code。
 *
 * @contract（铁律 47）
 *   @input  — 无参。要求：本文件在 CTO 工位的 docs/synova/coordination/tools/ 下，
 *             且同目录存在 `../施工项登记.ts` 与 `check-construction-registry.ts`。
 *   @output — stdout：8 条逐条 PASS/FAIL + 汇总；**exit 0 = 8 条全对，exit 1 = 有错**
 *   @degraded — 复制失败 / 找不到源文件 ⇒ 立即 exit 2（不静默）
 *
 * @does-not-touch  原文件。所有注入都在 `mkdtemp` 出来的临时目录里做。
 *
 * @ref origin/main@1630a5014（2026-10-04）
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_REG = resolve(HERE, '..', '施工项登记.ts');
const SRC_BODY = resolve(HERE, 'check-construction-registry.ts');

interface Case {
  id: string;
  desc: string;
  /** 对两件源文件做注入（返回说明） */
  mutate: (dir: string) => void;
  /** 期望 exit code */
  expect: 0 | 1 | 2;
}

function setup(): string {
  const root = mkdtempSync(join(tmpdir(), 'cto-counterexample-'));
  mkdirSync(join(root, 'tools'), { recursive: true });
  cpSync(SRC_REG, join(root, '施工项登记.ts'));
  cpSync(SRC_BODY, join(root, 'tools', 'check-construction-registry.ts'));
  // ⚠️ 副本目录必须能解析依赖（否则 node 直跑会 MODULE_NOT_FOUND ⇒ 假失败）
  //    用符号链接而非复制（省空间且与原仓同版本）
  try {
    const nm = resolve(HERE, '..', '..', '..', '..', 'node_modules');
    if (existsSync(nm)) symlinkSync(nm, join(root, 'node_modules'), 'dir');
  } catch { /* 已在则忽略 */ }
  return root;
}

const DIAG: string[] = [];
let c0 = '';
// 仓根：本文件在 <repo>/.synova-wt-cto-role/docs/synova/coordination/tools/ ⇒ 上溯 5 级
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..', '..');
function run(dir: string): number {
  try {
    // ⚠️ 必须用 node 直跑：npx 在临时目录会因 npm cache EPERM 失败 ⇒ 假失败
    execFileSync(process.execPath, ['--experimental-strip-types', join(dir, 'tools', 'check-construction-registry.ts')], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
      // 🔴 必须指定仓根：否则副本在 /tmp 里解析不到 origin/main ⇒ 假失败（CTO 自查发现）
      env: { ...process.env, REG_GIT_ROOT: REPO_ROOT },
    });
    return 0;
  } catch (e) {
    const er = e as { status?: number; stderr?: Buffer; stdout?: Buffer };
    const st = er.status;
    if (c0 === 'f' || c0 === 'g' || typeof st !== 'number' || st > 2) {
      const so = (er.stdout?.toString() ?? '').split('\n').filter(Boolean).slice(-4).join(' ｜ ');
      const se = (er.stderr?.toString() ?? '').split('\n').filter(Boolean).slice(-4).join(' ｜ ');
      DIAG.push(`case=${c0} status=${st}\n        stdout: ${so.slice(0, 300)}\n        stderr: ${se.slice(0, 300)}`);
    }
    return typeof st === 'number' ? st : 1;
  }
}

function editReg(dir: string, fn: (s: string) => string): void {
  const p = join(dir, '施工项登记.ts');
  const next = fn(readFileSync(p, 'utf-8'));
  writeFileSync(p, next, 'utf-8');
}

const cases: Case[] = [
  {
    id: 'a',
    desc: '删 dependsOn 目标 ⇒ INV-1',
    expect: 1,
    mutate: (d) =>
      editReg(d, (s) => s.replace("    id: '0-7',\n", "    id: '0-7',\n").replace("    dependsOn: ['2-3'],", "    dependsOn: ['9-99'],")),
  },
  {
    id: 'b',
    desc: '造 dependsOn 环（2-2 ⇄ 2-6）⇒ INV-1 环',
    expect: 1,
    mutate: (d) =>
      editReg(d, (s) => {
        // 精确定位 2-6 这一项的 dependsOn（原来粗暴替换首个 `dependsOn: []` 命中的是 0-1 ⇒ 不成环）
        const i = s.indexOf("id: '2-6',");
        if (i < 0) throw new Error('未找到 2-6');
        const j = s.indexOf('dependsOn: []', i);
        if (j < 0) throw new Error('未找到 2-6 的 dependsOn');
        return s.slice(0, j) + "dependsOn: ['2-2']" + s.slice(j + 'dependsOn: []'.length);
      }),
  },
  {
    id: 'c',
    desc: 'acceptance 改纯 grep ⇒ INV-3②',
    expect: 1,
    mutate: (d) =>
      editReg(d, (s) => s.replace("run: 'npx vitest run tests/growth/goal-sentinel.test.ts'", "run: 'grep -c foo bar.ts'")),
  },
  {
    id: 'd',
    desc: "worker 改成 'zzz-not-a-worker' ⇒ INV-2 取值域",
    expect: 1,
    mutate: (d) => editReg(d, (s) => s.replace("    worker: 'win',", "    worker: 'zzz-not-a-worker' as never,")),
  },
  {
    id: 'e',
    desc: '两项写集同路径且不加 sharedWrite ⇒ INV-4',
    expect: 1,
    mutate: (d) =>
      editReg(d, (s) => s.replace(/\n    sharedWrite: \[[^\]]*\],/g, '')),
  },
  {
    id: 'f',
    desc: '（对照）保留 sharedWrite ⇒ INV-4 放行',
    expect: 0,
    mutate: () => undefined,
  },
  {
    id: 'g',
    desc: '登记件不可读 ⇒ 应 exit **2**（不是 1）',
    expect: 2,
    mutate: (d) => {
      // 精确替换【动态 import】的路径（源码里出现两次：类型位 + 值位）
      const src = readFileSync(SRC_BODY, 'utf-8');
      const patched = src.split('../施工项登记.ts').join('../不存在的登记件.ts');
      if (patched === src) throw new Error('未替换到 import 路径');
      writeFileSync(join(d, 'tools', 'check-construction-registry.ts'), patched, 'utf-8');
      // 同时把副本里的登记件删掉，确保它真的读不到
      rmSync(join(d, '施工项登记.ts'), { force: true });
    },
  },
  {
    id: 'h',
    desc: 'fieldProducers 值改自由文本（无可核前缀）⇒ INV-1③b',
    expect: 1,
    mutate: (d) =>
      editReg(d, (s) => s.replace('degraded: "run: 2-1b 写入侧按铁律 24/31 填（降级必须显式）"', 'degraded: "随便一句自由文本"')),
  },
];

if (!existsSync(SRC_REG) || !existsSync(SRC_BODY)) {
  process.stderr.write(`  🔴 找不到源文件：${SRC_REG} / ${SRC_BODY}\n`);
  process.exit(2);
}

let bad = 0;
const rows: string[] = [];
for (const c of cases) {
  const dir = setup();
  try {
    c.mutate(dir);
    c0 = c.id;
    const got = run(dir);
    const ok = got === c.expect;
    if (!ok) bad++;
    rows.push(`  ${ok ? '✅' : '🔴'} ${c.id}  ${c.desc.padEnd(46)} 期望 exit ${c.expect} ｜ 实测 ${got}`);
  } catch (e) {
    bad++;
    rows.push(`  🔴 ${c.id}  ${c.desc} ｜ 验证台自身失败: ${e instanceof Error ? e.message : String(e)}`);
  }
}
console.log('  执法体反例验证台（a–h，全部在 /tmp 副本上做）');
console.log('');
for (const r of rows) console.log(r);
console.log('');
console.log(`  ══ ${cases.length - bad}/${cases.length} 条符合预期 ══`);
if (DIAG.length) { console.log(''); console.log('  ── 诊断（f/g 及异常退出）──'); for (const d of DIAG) console.log(`    ${d}`); }
process.exit(bad > 0 ? 1 : 0);
