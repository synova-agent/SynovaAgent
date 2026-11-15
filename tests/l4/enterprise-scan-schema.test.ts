import { readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { clearOntologyCache, loadOntology, validateEdgeEndpoints } from '../../src/l4/ontology-loader';
import { validateNodeProps } from '../../src/l4/sog-schema-validator';

const IDS = ['activity/delivery_batch', 'resource/delivery_team', 'outcome/delivery_result', 'edge/team_executes_activity'];
const DUPLICATE_PATH = join(process.cwd(), 'extensions', 'ontology', 'activity', 'zz_1398_duplicate.json');
const BATCH_PATH = join(process.cwd(), 'extensions', 'ontology', 'activity', 'delivery_batch.json');

describe('#1398 唯一②loader/validator', () => {
  it('生产loader加载4个定义，$id无重复、端点存在且canonical属性齐', () => {
    clearOntologyCache();
    const { ontology, errors } = loadOntology();
    expect(errors).toEqual([]);
    for (const id of IDS) {
      const definition = [...ontology.nodeTypes, ...ontology.edgeTypes].find(item => item.$id === id);
      expect(definition, id).toMatchObject({ $id: id, version: '1.0.0', naturalKey: ['businessKey'] });
      expect(definition?.label.length).toBeGreaterThan(0);
      expect(definition?.requiredProps).toContain('businessKey');
    }
    expect(new Set([...ontology.nodeTypes, ...ontology.edgeTypes].map(item => item.$id)).size).toBe(ontology.nodeTypes.length + ontology.edgeTypes.length);
    expect(validateEdgeEndpoints('edge/team_executes_activity', 'resource/delivery_team', 'activity/delivery_batch')).toBe(true);
    expect(validateEdgeEndpoints('edge/team_executes_activity', 'activity/delivery_batch', 'resource/delivery_team')).toBe(false);
    const manifest = JSON.parse(readFileSync(join(process.cwd(), 'extensions', 'ontology', 'manifest.json'), 'utf8')) as { nodeTypes: number; edgeTypes: number };
    expect(manifest.nodeTypes).toBe(['resource', 'activity', 'outcome'].flatMap(directory => readdirSync(join(process.cwd(), 'extensions', 'ontology', directory)).filter(name => name.endsWith('.json'))).length);
    expect(manifest.edgeTypes).toBe(readdirSync(join(process.cwd(), 'extensions', 'ontology', 'edge-types')).filter(name => name.endsWith('.json')).length);
  });

  it('主validator消费canonical定义，缺businessKey硬拒绝', () => {
    clearOntologyCache();
    const errors = validateNodeProps('activity/delivery_batch', { name: '缺自然键', teamBusinessKey: 'team:a', period: '2026-10' });
    expect(errors.some(error => error.field === 'businessKey' && error.degraded !== true)).toBe(true);
    expect(validateNodeProps('activity/delivery_batch', { businessKey: 'delivery_batch:B1', name: '批次', teamBusinessKey: 'team:a', period: '2026-10' }).filter(error => !error.degraded)).toEqual([]);
  });

  it('重复$id必红并恢复', () => {
    const source = JSON.parse(readFileSync(BATCH_PATH, 'utf8')) as Record<string, unknown>;
    try {
      writeFileSync(DUPLICATE_PATH, JSON.stringify(source));
      clearOntologyCache();
      const { errors } = loadOntology();
      expect(errors.some(error => error.includes('本体 $id 重复: activity/delivery_batch'))).toBe(true);
    } finally {
      rmSync(DUPLICATE_PATH, { force: true });
      clearOntologyCache();
    }
    expect(loadOntology().errors).toEqual([]);
  });

  it('新类型缺naturalKey必红并恢复', () => {
    const original = readFileSync(BATCH_PATH, 'utf8');
    const changed = JSON.parse(original) as Record<string, unknown>;
    delete changed.naturalKey;
    try {
      writeFileSync(BATCH_PATH, JSON.stringify(changed, null, 2));
      clearOntologyCache();
      expect(loadOntology().errors.some(error => error.includes('naturalKey'))).toBe(true);
    } finally {
      writeFileSync(BATCH_PATH, original);
      clearOntologyCache();
    }
    expect(loadOntology().errors).toEqual([]);
  });
});
