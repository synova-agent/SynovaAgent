/**
 * tests/sentinel/mapped-read.test.ts — #1381 **V2a 判据**（类型轴打通；真实导入路径）
 *
 * 🔴 CTO 硬要求（2026-10-08）：V2 必须走**真实路径**（`src/connectors/csv-import.ts`）+ 真实数据；
 *   **禁手工 `createNode` 造夹具**（替身 ⇒ 第 12 类）。本文件的 E2E 用 `CsvImportConnector.importData`。
 * 覆盖面（逐字）：V2a = **读侧能定位本体轴节点**（`resource/money`）⇒ 产出计数/行；
 *   **不是**"哨兵读到并产出指标"（那需 props 契约对齐 + 消费侧 ⇒ **#1381-V2b，p0**）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import Database from 'better-sqlite3';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import { CsvImportConnector } from '../../src/connectors/csv-import';
import { resolveReadTargets, readByMappedType } from '../../src/sentinel/mapped-read';

describe('#1381 V2a · 经映射读（类型轴打通）', () => {
  it('🔴 V2a 端到端（真实 csv-import 路径）：导入 ⇒ 落 `resource/money` ⇒ 映射读可定位（≥1 行）', () => {
    const store = new SqliteGraphStore(new Database(':memory:'));
    // 真实连接器 + 真实 CSV（禁手工 createNode）
    const connector = new CsvImportConnector(
      { createNode: (type, props, graph) => store.createNode(type, props, graph) },
      'enterprise',
    );
    const csv = [
      'date,amount,category,description',
      '2026-09-01,1000.50,revenue,九月收入',
      '2026-09-02,-300.00,cost,九月成本',
    ].join('\n');
    const res = connector.importData(csv);
    expect(res.imported).toBe(2);

    // 直接核实落库类型（本体轴）
    const raw = store.queryNodes('resource/money', {}, 'enterprise') as unknown[];
    expect(raw.length).toBe(2);

    // 经映射读：遗留字面量 'FINANCIAL' ⇒ 并集读 [outcome/financial, resource/money]
    const r = readByMappedType(
      { queryNodes: (type, filters, graph) => store.queryNodes(type, filters, graph) as unknown[] },
      'FINANCIAL', {}, 'enterprise',
    );
    expect(r.usedTypes).toEqual(['outcome/financial', 'resource/money']);
    expect(r.legacyFallback).toBe(false);
    expect(r.rows.length).toBeGreaterThanOrEqual(2);   // **读侧能定位**
  });

  it('V2a-b 别名一致：resolveReadTargets(大小写两写) ⇒ 同一 targets 集合', () => {
    expect(resolveReadTargets('FINANCIAL').targets).toEqual(resolveReadTargets('Financial').targets);
    expect(resolveReadTargets('TOOL').targets).toEqual(resolveReadTargets('Tool').targets);
  });

  it('V2a-c 无映射 ⇒ 回退遗留字面量 + 显式 warn（不静默）', () => {
    let asked: string[] = [];
    const r = readByMappedType({ queryNodes: (t) => { asked.push(t); return []; } }, 'Event');
    expect(r.legacyFallback).toBe(true);
    expect(r.warn).toBe(true);
    expect(asked).toEqual(['Event']);
  });

  it('V2a-d 哨兵接线（B1）：cash-flow 读路径已改为经映射（源码级核）', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const src = readFileSync('src/sentinel/adapters/cash-flow-sentinel.ts', 'utf-8');
    // 精确断言（**不是"含函数名"**）：类型列表【由映射结果算出】且查询用它参数化
    expect(src).toMatch(/const readTypes = targets\.length > 0 \? targets : \['FINANCIAL'\]/);
    expect(src).toMatch(/\.all\(\.\.\.readTypes\)/);
    expect(src).toContain("type IN (");
  });
});
