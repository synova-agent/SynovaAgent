/**
 * tests/tools/tool-registry.test.ts — D65 定义注册表 + D68 原子性验证 测试
 *
 * D65 覆盖:
 * - register + get → 取回注册的工具定义
 * - register 同名 → 后者覆盖前者
 * - list → 返回全部已注册工具
 * - unregister → 已注册 true / 未注册 false（边界）
 *
 * D68 覆盖:
 * - validateAtomicity 3项全通过 → atomic=true
 * - validateAtomicity 缺失contractId → 条件1拒绝
 * - validateAtomicity <2个skills → 条件3拒绝
 * - validateAtomicity hasTests=false → 条件2拒绝
 * - getToolsBySkill → 返回匹配工具 / 无匹配空数组 / 无 skills 字段不匹配
 *
 * #985（0-11）拆门决策锁（2026-10-08）:
 * - 『执行+权限门禁』面（invoke / setPolicyEngine）已按施工单 0-11 选 (b) 拆除
 *   ⇒ 本文件**显式断言这两个符号不再存在于实例上**：
 *      谁把假门加回来，本测试即红（把一次性的删除决定钉成长期不变量）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRegistry } from '../../src/tools/tool-registry';

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  // ═══ D65 回归测试 ═══

  it('register + get → 取回注册的工具定义', () => {
    registry.register({
      name: 'double',
      version: '1.0.0',
      description: 'Doubles a number',
      fn: () => ({ result: 10 }),
      inputSchema: { n: 'number' },
      outputType: '{ result: number }',
    });

    const def = registry.get('double');
    expect(def).toBeDefined();
    expect(def?.name).toBe('double');
    expect(def?.version).toBe('1.0.0');
    expect(def?.description).toBe('Doubles a number');
    expect(typeof def?.fn).toBe('function');
  });

  it('get 未注册的 tool → 返回 undefined', () => {
    expect(registry.get('does-not-exist')).toBeUndefined();
  });

  it('register 同名 → 后者覆盖前者', () => {
    registry.register({
      name: 'greet',
      version: '1.0.0',
      description: 'Greet v1',
      fn: () => 'hello',
      inputSchema: {},
      outputType: 'string',
    });
    registry.register({
      name: 'greet',
      version: '2.0.0',
      description: 'Greet v2',
      fn: () => 'hi there',
      inputSchema: {},
      outputType: 'string',
    });

    const def = registry.get('greet');
    expect(def?.version).toBe('2.0.0');
    expect(def?.description).toBe('Greet v2');
  });

  it('list → 返回全部已注册工具', () => {
    registry.register({
      name: 'a', version: '1.0.0', description: '', fn: () => 1,
      inputSchema: {}, outputType: 'number',
    });
    registry.register({
      name: 'b', version: '1.0.0', description: '', fn: () => 2,
      inputSchema: {}, outputType: 'number',
    });

    expect(registry.list().length).toBe(2);
  });

  it('unregister → 已注册 true / 未注册 false（边界）', () => {
    registry.register({
      name: 'temp', version: '1.0.0', description: '', fn: () => null,
      inputSchema: {}, outputType: 'void',
    });

    expect(registry.unregister('temp')).toBe(true);
    expect(registry.get('temp')).toBeUndefined();
    expect(registry.unregister('temp')).toBe(false);
    expect(registry.unregister('never-registered')).toBe(false);
  });

  // ═══ #985（0-11）拆门决策锁 ═══

  describe('#985 拆门决策锁（假门不得复活）', () => {
    it("实例上不存在 'invoke'（执行面已拆除）", () => {
      expect('invoke' in registry).toBe(false);
    });

    it("实例上不存在 'setPolicyEngine'（权限门禁面已拆除）", () => {
      expect('setPolicyEngine' in registry).toBe(false);
    });

    it("实例上不存在 'setAuditStore' / 'writeAuditLog'（审计面随门禁一并拆除）", () => {
      expect('setAuditStore' in registry).toBe(false);
      expect('writeAuditLog' in registry).toBe(false);
    });
  });

  // ═══ D68 原子性验证 ═══

  describe('validateAtomicity', () => {
    it('3项条件全通过 → atomic=true', () => {
      const result = ToolRegistry.validateAtomicity({
        name: 'compute-break-even',
        version: '1.0.0',
        description: '盈亏平衡计算',
        fn: () => ({ bep: 100 }),
        inputSchema: { fixedCost: 'number', price: 'number' },
        outputType: 'BreakEvenResult',
        contractId: 'COMPUTE-BREAK-EVEN-v1',
        hasTests: true,
        skills: ['analyze-break-even', 'diagnose-cashflow-health', 'diagnose-margin-erosion'],
      });

      expect(result.atomic).toBe(true);
      expect(result.checks.hasContract).toBe(true);
      expect(result.checks.hasTests).toBe(true);
      expect(result.checks.reusedByMultiple).toBe(true);
    });

    it('缺失 contractId → 条件1拒绝', () => {
      const result = ToolRegistry.validateAtomicity({
        name: 'compute-x',
        version: '1.0.0',
        description: '无契约ID',
        fn: () => null,
        inputSchema: {},
        outputType: 'void',
        hasTests: true,
        skills: ['skill-a', 'skill-b'],
      });

      expect(result.atomic).toBe(false);
      expect(result.checks.hasContract).toBe(false);
      expect(result.details.some(d => d.includes('contractId'))).toBe(true);
    });

    it('skills < 2 → 条件3拒绝', () => {
      const result = ToolRegistry.validateAtomicity({
        name: 'compute-y',
        version: '1.0.0',
        description: '复用不足',
        fn: () => null,
        inputSchema: {},
        outputType: 'void',
        contractId: 'COMPUTE-Y-v1',
        hasTests: true,
        skills: ['only-one-skill'],
      });

      expect(result.atomic).toBe(false);
      expect(result.checks.reusedByMultiple).toBe(false);
    });

    it('hasTests=false → 条件2拒绝', () => {
      const result = ToolRegistry.validateAtomicity({
        name: 'compute-z',
        version: '1.0.0',
        description: '无可测试',
        fn: () => null,
        inputSchema: {},
        outputType: 'void',
        contractId: 'COMPUTE-Z-v1',
        hasTests: false,
        skills: ['skill-a', 'skill-b'],
      });

      expect(result.atomic).toBe(false);
      expect(result.checks.hasTests).toBe(false);
    });
  });

  // ═══ D68 getToolsBySkill ═══

  describe('getToolsBySkill', () => {
    it('按 Skill 名称返回被复用的工具', () => {
      registry.register({
        name: 'compute-dol',
        version: '1.0.0', description: '', fn: () => ({}),
        inputSchema: {}, outputType: 'DOLResult',
        skills: ['analyze-operating-leverage', 'diagnose-cashflow-health', 'diagnose-margin-erosion'],
      });
      registry.register({
        name: 'compute-break-even',
        version: '1.0.0', description: '', fn: () => ({}),
        inputSchema: {}, outputType: 'BreakEvenResult',
        skills: ['analyze-break-even', 'diagnose-cashflow-health'],
      });
      registry.register({
        name: 'some-other-tool',
        version: '1.0.0', description: '', fn: () => ({}),
        inputSchema: {}, outputType: 'void',
        skills: ['unrelated-skill'],
      });

      const tools = registry.getToolsBySkill('diagnose-cashflow-health');
      expect(tools.length).toBe(2);
      expect(tools.map(t => t.name).sort()).toEqual(['compute-break-even', 'compute-dol']);
    });

    it('无匹配 → 返回空数组', () => {
      registry.register({
        name: 'tool-a',
        version: '1.0.0', description: '', fn: () => ({}),
        inputSchema: {}, outputType: 'void',
        skills: ['skill-x'],
      });

      const tools = registry.getToolsBySkill('nonexistent-skill');
      expect(tools.length).toBe(0);
    });

    it('工具无 skills 字段 → 不匹配', () => {
      registry.register({
        name: 'no-skills-tool',
        version: '1.0.0', description: '', fn: () => ({}),
        inputSchema: {}, outputType: 'void',
        // 不设置 skills 字段
      });

      const tools = registry.getToolsBySkill('any-skill');
      expect(tools.length).toBe(0);
    });
  });
});
