/**
 * tests/agent/expert-name-map.test.ts — 专家名映射单一真源测试（D986）
 *
 * 目的: 钉住「旧名 → v3.0 问题域专家 id」映射，防两类漂移:
 *   ① 映射目标不是 `expert/expert-registry.yaml` 里的真实专家 id（幽灵目标）
 *   ② 键被改动/删除而另一消费方（`synova-diagnosis-engine-impl.ts` / skills 加载器）不知情
 */
import { describe, it, expect } from 'vitest';
import { LEGACY_TO_EXPERT_ID_MAP } from '../../src/agent/expert-name-map';
import { getAllExpertIds } from '../../src/agent/expert-config-loader';

describe('LEGACY_TO_EXPERT_ID_MAP（D986 单一真源）', () => {
  const registryIds = getAllExpertIds();

  it('Given 注册表可读, Then 至少 6 位专家（覆盖集合 = expert-registry.yaml）', () => {
    expect(registryIds.length).toBeGreaterThanOrEqual(6);
  });

  it('Given 映射表, Then 每个目标 id 都在注册表内（无幽灵目标）', () => {
    const ghosts = Object.entries(LEGACY_TO_EXPERT_ID_MAP)
      .filter(([, target]) => !registryIds.includes(target))
      .map(([key, target]) => `${key}→${target}`);
    expect(ghosts).toEqual([]);
  });

  it('Given v3.0 专家 id 自身, Then 恒等映射（调用方一次查表即可）', () => {
    for (const id of registryIds) {
      expect(LEGACY_TO_EXPERT_ID_MAP[id]).toBe(id);
    }
  });

  it('Given D650 旧名, Then 按权威迁移映射命中', () => {
    expect(LEGACY_TO_EXPERT_ID_MAP['strategy']).toBe('competitive-strategy');
    expect(LEGACY_TO_EXPERT_ID_MAP['org']).toBe('organizational-capability');
    expect(LEGACY_TO_EXPERT_ID_MAP['finance']).toBe('fundamental-efficiency');
    expect(LEGACY_TO_EXPERT_ID_MAP['tech']).toBe('technology-foundation');
    expect(LEGACY_TO_EXPERT_ID_MAP['marketing']).toBe('customer-growth');
    expect(LEGACY_TO_EXPERT_ID_MAP['action']).toBe('host');
    expect(LEGACY_TO_EXPERT_ID_MAP['knowledge']).toBe('host');
  });

  it('Given 诊断维度 D1-D7, Then 与 D650 表一致', () => {
    expect(LEGACY_TO_EXPERT_ID_MAP['D1']).toBe('competitive-strategy');
    expect(LEGACY_TO_EXPERT_ID_MAP['D2']).toBe('organizational-capability');
    expect(LEGACY_TO_EXPERT_ID_MAP['D3']).toBe('organizational-capability');
    expect(LEGACY_TO_EXPERT_ID_MAP['D4']).toBe('technology-foundation');
    expect(LEGACY_TO_EXPERT_ID_MAP['D5']).toBe('technology-foundation');
    expect(LEGACY_TO_EXPERT_ID_MAP['D6']).toBe('competitive-strategy');
    expect(LEGACY_TO_EXPERT_ID_MAP['D7']).toBe('fundamental-efficiency');
  });

  it('Given business_model 下划线与 business-model 连字符两种拼写, Then 命中同一目标', () => {
    // 实测差异: D650 原表写下划线，skills/ 目录名是连字符 —— 两种拼写都必须可用
    expect(LEGACY_TO_EXPERT_ID_MAP['business_model']).toBe('competitive-strategy');
    expect(LEGACY_TO_EXPERT_ID_MAP['business-model']).toBe('competitive-strategy');
  });
});
