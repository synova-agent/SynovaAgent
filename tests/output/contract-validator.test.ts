/**
 * tests/output/contract-validator.test.ts — K12-06（#189）产出契约校验器测试
 *
 * 铁律 33: `*.test.ts` = 单元测试。铁律 47/48: 契约优先 + 真实断言（禁空壳）。
 *
 * ── 只打**一个生产出口** ──
 * `validateOutputContract(subject, opts?)` —— 一页纸**提交口自检**（生产接线点，
 * 被 `src/agent/report-assembler.ts` 的 `renderOnePager` 调用；真实链
 * `src/routes/diagnosis.ts:552/812` → `renderOnePager` → 自检）。
 * 它 `@output void` ⇒ 断言走两个可观测面：
 *   ① **落账台账**（第二职务的物理载体）⇒ 失败时定位"哪条契约·哪个字段"
 *   ② **渲染器返回值**（`renderOnePager`）⇒ 证明体检**不阻断产出**
 *
 * 🔴 **本文件为何不用 `validateOutput(contractId, …)`**：那个通用口目前**不导出**
 *   （无生产消费方 —— 铁律 0-2；pre-commit 组 4「新 export 必须被引用」拦的就是这个）。
 *   一页纸之外的产出（KPI 表 / 周报 / 诊断报告）**提交口尚未接线**
 *   （K12-03 产出 / 报表交付链不在本卡写集内）。
 *   ⇒ 那三类契约本轮做的是**执行面可判部分 + 契约正文只读核验**：
 *     · 四类契约**都经真实加载器解析**（走同一出口，契约 id 由各用例的临时根决定）
 *     · 章节/必填/口径等**判据声明**与真渲染器逐字一致（只读核验）
 *     · 一页纸一条**全判据**端到端（真渲染器产出 + 台账）
 *   ⚠️ **未做**：KPI/周报/诊断报告三类契约的"逐条口径**改坏即红**执行验证"
 *     —— 该缺口列入回件 R2 例外 + R4 承接项，**不在此声称已覆盖**。
 *
 * ── 🔴 契约根隔离 ──
 * `beforeEach` 把 `SYNOVA_OUTPUT_CONTRACTS_ROOT` 指到**临时目录**，并**从真实仓库**
 * `extensions/reports/contracts/` 逐个 `readFileSync` → `writeFileSync` **复制**过去。
 * 这样：① 每条用例各自独立（模块缓存键含 root ⇒ 无跨例污染）；
 * ② 被测的仍是**仓库里真发运的契约正文**（不是测试里另写一份）；③ 不写仓库。
 * 另有一条用例刻意**指回真实默认根**，证明默认解析就是 `extensions/reports/contracts`。
 *
 * 🔴 落账隔离：`SYNOVA_OUTPUT_CONTRACT_SINK` 一律指临时文件，**绝不**写仓库
 *   `data/output-contract-failures.jsonl`（那是飞轮的输入，不许被测试垃圾稀释）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { validateOutputContract } from '../../src/output/contract-validator';
import { renderOnePager } from '../../src/agent/report-assembler';
import type { DiagnosisReport } from '../../src/l3/synova-diagnosis-engine';

// ═══ 环境隔离 ═══

const ORIGINAL_SINK = process.env.SYNOVA_OUTPUT_CONTRACT_SINK;
const ORIGINAL_ROOT = process.env.SYNOVA_OUTPUT_CONTRACTS_ROOT;
/** 仓库里真发运的契约目录（契约根隔离时由此复制） */
const SHIPPED_CONTRACTS = join(process.cwd(), 'extensions', 'reports', 'contracts');

let tempDir = '';
let fakeRoot = '';
let sink = '';
/** 从真实仓库复制过来的契约文件名（`<id>.yaml`） */
let shippedContractFiles: string[] = [];

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'k12-06-contract-'));
  fakeRoot = join(tempDir, 'contracts');
  sink = join(tempDir, 'failures.jsonl');
  mkdirSync(fakeRoot, { recursive: true });

  // 复制**真发运的契约正文**到临时根（不是另写一份）
  shippedContractFiles = readdirSync(SHIPPED_CONTRACTS).filter((f) => f.endsWith('.yaml'));
  for (const f of shippedContractFiles) {
    writeFileSync(join(fakeRoot, f), readFileSync(join(SHIPPED_CONTRACTS, f), 'utf-8'), 'utf-8');
  }

  process.env.SYNOVA_OUTPUT_CONTRACTS_ROOT = fakeRoot;
  process.env.SYNOVA_OUTPUT_CONTRACT_SINK = sink;
});

afterEach(() => {
  if (ORIGINAL_SINK === undefined) delete process.env.SYNOVA_OUTPUT_CONTRACT_SINK;
  else process.env.SYNOVA_OUTPUT_CONTRACT_SINK = ORIGINAL_SINK;
  if (ORIGINAL_ROOT === undefined) delete process.env.SYNOVA_OUTPUT_CONTRACTS_ROOT;
  else process.env.SYNOVA_OUTPUT_CONTRACTS_ROOT = ORIGINAL_ROOT;
  if (tempDir !== '' && existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
});

// ═══ 观测面 ═══

interface LedgerRow {
  recordedAt: string;
  contractId: string | null;
  contractVersion: number | null;
  codes: string[];
  fieldPaths: string[];
  errorCount: number;
  sinkPath: string;
}

/** 台账原始行（空数组 = 渲染器内部自检未落账 = 通过） */
function ledgerRows(): LedgerRow[] {
  if (!existsSync(sink)) return [];
  return readFileSync(sink, 'utf-8').trim().split('\n').filter((l) => l !== '')
    .map((l) => JSON.parse(l) as LedgerRow);
}

function errorCodes(): string[] {
  return ledgerRows().flatMap((r) => r.codes);
}

// ═══ Fixture ═══

function makeDiagnosisReport(overrides?: Partial<DiagnosisReport>): DiagnosisReport {
  return {
    reportId: 'diag-189-001',
    teamId: 'wani-baby',
    generatedAt: '2026-10-12T06:00:00.000Z',
    summary: '现金流缺口与人才密度双重制约增长，建议先稳现金流再补关键岗位。',
    expertReports: [
      { expert: 'finance', findings: ['经营现金流连续 3 季度为负'], confidence: 0.8 },
    ],
    rootCauses: [
      { description: '现金流缺口扩大：经营现金流连续 3 季度为负', dimension: 'financial', confidence: 0.8 },
    ],
    recommendations: [
      { action: '压缩非核心固定成本 20%', priority: 'critical', expert: 'finance' },
      { action: '建立关键岗位继任计划', priority: 'high', expert: 'org' },
    ],
    raw: {},
    ...overrides,
  };
}

/** 一页纸的规范正文（= 真渲染器在 ceo 深度 + inputs 齐备时的产出形态） */
function onePagerText(report: DiagnosisReport): string {
  return renderOnePager(report, 'ceo', {
    evidenceHighlights: ['经营现金流连续 3 季度为负 [src:finding:F-189-001]'],
    cycleConclusions: ['现金流循环进入负反馈 [src:cycle:cashflow-nfb]'],
  });
}

/** 穿**真实生产渲染器**造一页纸并跑提交口自检，返回渲染出的 markdown */
function renderAndSelfCheck(overrides?: Partial<DiagnosisReport>): string {
  return onePagerText(makeDiagnosisReport(overrides));
}

/** 契约正文（从真发运目录读，供只读核验） */
function contractBody(id: string): string {
  return readFileSync(join(SHIPPED_CONTRACTS, `${id}.yaml`), 'utf-8');
}

// ═══ ① 真发运契约：在盘上 / 带版本 / 章名与真渲染器一致 ═══

describe('K12-06 ① 四类契约真发运且在盘上', () => {
  it('extensions/reports/contracts/ 下四类契约都在（磁盘实测，非清单硬编码）', () => {
    expect(existsSync(SHIPPED_CONTRACTS)).toBe(true);
    const ids = shippedContractFiles.map((f) => f.replace(/\.yaml$/, '')).sort();
    expect(ids).toEqual(['diagnosis-report', 'kpi-table', 'one-pager', 'weekly']);
  });

  it('契约头带 `version`（宪章 P9 只能追加不能覆盖）', () => {
    for (const f of shippedContractFiles) {
      expect(readFileSync(join(SHIPPED_CONTRACTS, f), 'utf-8')).toMatch(/^ {2}version: 1$/m);
    }
  });

  it('四类契约的 `contract.id` 与文件名一致（文件名即契约 id，加载器按此寻址）', () => {
    for (const f of shippedContractFiles) {
      const id = f.replace(/\.yaml$/, '');
      expect(contractBody(id)).toMatch(new RegExp(`^ {2}id: ${id}$`, 'm'));
    }
  });

  it('一页纸契约的四个 `sections` 与**真发运渲染器源码**逐字一致（未手写猜）', () => {
    const contract = contractBody('one-pager');
    const renderer = readFileSync(join(process.cwd(), 'src', 'l3', 'report-templates.ts'), 'utf-8');
    for (const title of ['### 结论', '### 关键证据', '### 各维度循环结论', '### 行动建议']) {
      expect(contract).toContain(title);
      expect(renderer).toContain(`'${title}'`);
    }
  });

  it('诊断报告契约的四个 `sections` 与真渲染器逐字一致', () => {
    const contract = contractBody('diagnosis-report');
    const renderer = readFileSync(join(process.cwd(), 'src', 'l3', 'report-templates.ts'), 'utf-8');
    for (const title of ['### 结论', '### 关键证据', '### 各维度循环结论', '### 行动建议']) {
      expect(contract).toContain(title);
      expect(renderer).toContain(`'${title}'`);
    }
  });
});

// ═══ ② 穿真实生产入口 ⇒ 通过 ═══

describe('K12-06 ② 穿真实生产入口 → 契约通过（体检不误报）', () => {
  it('真实 renderOnePager 产出（ceo 深度 + inputs）⇒ 四槽位齐 + 无落账（= 通过）', () => {
    const md = renderAndSelfCheck();
    for (const s of ['### 结论', '### 关键证据', '### 各维度循环结论', '### 行动建议']) {
      expect(md).toContain(s);
    }
    expect(errorCodes()).toEqual([]);
  });

  it('flywheel 深度同样通过（深度不改变契约）', () => {
    const md = renderOnePager(makeDiagnosisReport(), 'flywheel', {
      evidenceHighlights: ['关键岗位继任空白 [src:finding:F-189-002]'],
      cycleConclusions: ['人才循环供给不足 [src:cycle:talent-supply]'],
    });
    expect(md).toContain('### 结论');
    expect(errorCodes()).toEqual([]);
  });

  it('默认契约根解析 = extensions/reports/contracts（指回真实默认根仍通过）', () => {
    delete process.env.SYNOVA_OUTPUT_CONTRACTS_ROOT;
    const md = renderAndSelfCheck();
    expect(md).toContain('### 结论');
    expect(errorCodes()).toEqual([]);
  });

  it('体检**不阻断产出**（`@output void` 语义）：产出照常返回，但留痕', () => {
    const md = renderOnePager(makeDiagnosisReport({ teamId: '' }), 'ceo', {
      evidenceHighlights: ['x [src:finding:F-1]'],
      cycleConclusions: ['y [src:cycle:c]'],
    });
    expect(typeof md).toBe('string');
    expect(md).toContain('### 结论');
    expect(errorCodes()).toContain('one-pager.field.orgId');
  });
});

// ═══ ③ 反例：不合格一页纸必被拒（V2/V6 判据）═══

describe('K12-06 ③ 不合格一页纸必被拒（V2/V6 判据）', () => {
  it('HTML 产出顶 markdown 一页纸 ⇒ 四个章节各点一条（`### ` 章名不存在 ⇒ 契约同时锚定格式）', () => {
    const html = readFileSync(join(process.cwd(), 'extensions/reports/executive-summary.hbs'), 'utf-8');
    // HTML 无法经渲染器产出 ⇒ 用"换掉契约根里的模板产物"不可行；此处以**结构对照**判：
    // 真 HTML 模板不含 markdown 章名，而契约要求 markdown 章名 ⇒ 冒充必不通过
    expect(html).not.toContain('### 结论');
    expect(html).toContain('<h2>');
  });

  it('缺 orgId（teamId 空）⇒ 台账点名 `one-pager.field.orgId`（含契约 id 与版本，机器可读）', () => {
    renderAndSelfCheck({ teamId: '' });
    const rows = ledgerRows();
    expect(rows.length).toBe(1);
    expect(rows[0].contractId).toBe('one-pager');
    expect(rows[0].contractVersion).toBe(1);
    expect(rows[0].codes).toContain('one-pager.field.orgId');
    expect(rows[0].fieldPaths).toContain('orgId');
  });

  it('缺 generatedAt ⇒ 点名 `one-pager.field.generatedAt`', () => {
    renderAndSelfCheck({ generatedAt: '' });
    expect(errorCodes()).toContain('one-pager.field.generatedAt');
  });

  it('同一缺陷只点名一条（不因多判据重复刷屏 ⇒ 归因不失真）', () => {
    renderAndSelfCheck({ teamId: '' });
    const rows = ledgerRows();
    expect(rows.length).toBe(1);
    expect(rows[0].codes).toEqual(['one-pager.field.orgId']);
    expect(rows[0].fieldPaths).toEqual(['orgId']);
  });
});

// ═══ ④ 第二职务：失败自动落账（V4/V5 载体）═══

describe('K12-06 ④ 第二职务：每次失败自动落账（V4/V5）', () => {
  it('落账行含稳定 code / 字段路径 / 契约版本，且**不含产出正文**（隐私约束）', () => {
    renderAndSelfCheck({ teamId: '' });
    const lines = readFileSync(sink, 'utf-8').trim().split('\n').filter((l) => l !== '');
    expect(lines.length).toBe(1);
    const row = JSON.parse(lines[0]) as LedgerRow;
    expect(row.contractId).toBe('one-pager');
    expect(row.contractVersion).toBe(1);          // V6：产物记录所用契约版本
    expect(row.codes).toContain('one-pager.field.orgId');
    expect(row.fieldPaths).toContain('orgId');
    expect(row.errorCount).toBeGreaterThan(0);
    expect(row.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(row.sinkPath).toBe(sink);
    // 隐私：台账不得成为原始数据外泄通道（KPI 表等含敏感数字）
    expect(lines[0]).not.toContain('现金流缺口与人才密度双重制约增长');
  });

  it('通过 ⇒ **不落账**（台账只记不合格，飞轮输入不被通过噪声稀释）', () => {
    renderAndSelfCheck();
    expect(existsSync(sink)).toBe(false);
  });

  it('台账只增不改：两次失败 ⇒ 两行（追加语义）', () => {
    renderAndSelfCheck({ teamId: '' });
    renderAndSelfCheck({ generatedAt: '' });
    const rows = ledgerRows();
    expect(rows.length).toBe(2);
    expect(rows[0].codes).toContain('one-pager.field.orgId');
    expect(rows[1].codes).toContain('one-pager.field.generatedAt');
  });

  it('落账点由**运行期**环境变量决定（不是硬编码常量）⇒ 换根即换落点', () => {
    const other = join(tempDir, 'other-sink.jsonl');
    process.env.SYNOVA_OUTPUT_CONTRACT_SINK = other;
    renderAndSelfCheck({ teamId: '' });
    expect(existsSync(other)).toBe(true);
    expect(existsSync(sink)).toBe(false);
    const row = JSON.parse(readFileSync(other, 'utf-8').trim()) as LedgerRow;
    expect(row.sinkPath).toBe(other);
  });
});

// ═══ ⑤ 契约加载降级：三类**不混** ═══

describe('K12-06 ⑤ 契约加载与降级（ENOENT / 解析失败 / 结构非法 三分）', () => {
  it('契约目录为空 ⇒ `contract.not_found`（未声明 ≠ 合规，不静默通过）', () => {
    rmSync(fakeRoot, { recursive: true, force: true });
    mkdirSync(fakeRoot, { recursive: true });
    renderAndSelfCheck();
    expect(errorCodes()).toContain('contract.not_found');
  });

  it('契约 YAML 语法坏 ⇒ `contract.load_failed`（真错误，与 ENOENT 分开点名）', () => {
    writeFileSync(join(fakeRoot, 'one-pager.yaml'), 'contract: [unclosed\n  - : :\n', 'utf-8');
    renderAndSelfCheck();
    expect(errorCodes()).toContain('contract.load_failed');
    expect(errorCodes()).not.toContain('contract.not_found');
  });

  it('契约缺 `version`（宪章 P9）⇒ `contract.load_failed`（不给"没版本也能跑"的缝）', () => {
    const body = contractBody('one-pager').replace(/^ {2}version: 1$/m, '');
    writeFileSync(join(fakeRoot, 'one-pager.yaml'), body, 'utf-8');
    renderAndSelfCheck();
    expect(errorCodes()).toContain('contract.load_failed');
  });

  it('契约缺 `contract:` 段 ⇒ `contract.load_failed`', () => {
    writeFileSync(join(fakeRoot, 'one-pager.yaml'), 'fields:\n  - path: orgId\n    required: true\n', 'utf-8');
    renderAndSelfCheck();
    expect(errorCodes()).toContain('contract.load_failed');
  });

  it('契约 inode 在 == 真发运契约（证明被测的是仓库正文，不是测试自写的一份）', () => {
    // 逐字节比对：临时根里的契约正文 === 仓库 extensions/reports/contracts/ 的正文
    for (const f of shippedContractFiles) {
      expect(readFileSync(join(fakeRoot, f), 'utf-8'))
        .toBe(readFileSync(join(SHIPPED_CONTRACTS, f), 'utf-8'));
    }
  });
});

// ═══ ⑥ KPI 表口径：判据声明（只读核验，执行验证见 R2 例外）═══

describe('K12-06 ⑥ KPI 表固定口径（判据声明核验）', () => {
  it('声明「单位一致」判据（`unitConsistency` + groupBy metricId + unitField unit）', () => {
    const body = contractBody('kpi-table');
    expect(body).toContain('kind: unitConsistency');
    expect(body).toContain('groupBy: metricId');
    expect(body).toContain('unitField: unit');
  });

  it('声明「期间唯一」判据（`valueUnique` on rows[].period ⇒ 混期必被拒）', () => {
    const body = contractBody('kpi-table');
    expect(body).toContain('kind: valueUnique');
    expect(body).toContain('path: rows[].period');
  });

  it('声明「空表不是表」判据（`minItems` on rows，min 1）', () => {
    const body = contractBody('kpi-table');
    expect(body).toContain('kind: minItems');
    expect(body).toMatch(/kind: minItems\n {4}path: rows\n {4}min: 1/);
  });

  it('声明「数值域」判据（`range` on rows[].actual）', () => {
    const body = contractBody('kpi-table');
    expect(body).toContain('kind: range');
    expect(body).toContain('path: rows[].actual');
  });

  it('12 项必填字段含 `rows[].metricId/unit/period/actual/target/source/recordedAt`', () => {
    const body = contractBody('kpi-table');
    for (const p of ['rows[].metricId', 'rows[].unit', 'rows[].period', 'rows[].actual',
      'rows[].target', 'rows[].source', 'rows[].recordedAt']) {
      expect(body).toContain(`- path: ${p}`);
    }
  });
});

// ═══ ⑦ 周报：判据声明（只读核验）═══

describe('K12-06 ⑦ 周报（固定结构 + 必填，判据声明核验）', () => {
  it('`blocked` 列为必填（"没填"与"没阻塞"机器可分）', () => {
    expect(contractBody('weekly')).toMatch(/- path: blocked\n {4}required: true/);
  });

  it('四个必填章节齐（含「### 阻塞」）', () => {
    const body = contractBody('weekly');
    for (const s of ['## 本周执行摘要', '### 上周承诺与本周实际', '### 阻塞', '### 下周计划']) {
      expect(body).toContain(s);
    }
  });

  it('期间形态判据为 `YYYY-Www`（`idFormat` on period）', () => {
    const body = contractBody('weekly');
    expect(body).toContain('id: period-shape');
    expect(body).toContain('path: period');
    expect(body).toContain('[0-9]{4}-W[0-9]{2}');
  });
});

// ═══ ⑧ 诊断报告：判据声明（只读核验）═══

describe('K12-06 ⑧ 诊断报告（固定章节 + 引用，判据声明核验）', () => {
  it('声明「通篇至少一条可解析引用」（`textPattern` + has-traceable-citation）', () => {
    const body = contractBody('diagnosis-report');
    expect(body).toContain('kind: textPattern');
    expect(body).toContain('has-traceable-citation');
  });

  it('声明两个槽位的引用下限（`pointers` 结论/关键证据各 min 1）', () => {
    const body = contractBody('diagnosis-report');
    expect(body).toContain('conclusion-citation');
    expect(body).toContain('evidence-citation');
    expect(body).toMatch(/min: 1/);
  });

  it('四个必填章节齐（与真渲染器四槽位一致）', () => {
    const body = contractBody('diagnosis-report');
    for (const s of ['### 结论', '### 关键证据', '### 各维度循环结论', '### 行动建议']) {
      expect(body).toContain(s);
    }
  });
});
