/**
 * tests/agent/skill-lazy-loader.integration.test.ts — SkillLazyLoader 集成测试
 *
 * 验证: 启动自加载（D986: `getSkillLoader()` 首用一次性扫描真实 `skills/` 目录）
 *       → linkToExpert（legacy 名 + D650 映射后的 v3.0 专家 id）→ buildCatalogText 非空
 * 铁律 33: *.integration.test.ts (涉及真实文件系统 I/O)
 *
 * 🔴 D986 反例锚点: 本文件**不再显式调用 `scanFromFiles`** —— 若把 `getSkillLoader()`
 *   里的自加载去掉，`listNames()` 归零 ⇒ 下方「D986 自加载」块必红（改坏即红）。
 */
import { describe, it, expect, vi } from 'vitest';
import { getSkillLoader } from '../../src/agent/skill-lazy-loader';
import { getAllExpertIds } from '../../src/agent/expert-config-loader';

describe('SkillLazyLoader — 集成测试', () => {
  const loader = getSkillLoader();

  it('Given skills/ 目录, When scanFromFiles, Then 至少发现 30 个 skill', () => {
    const strategySkills = loader.listForExpert('strategy');
    const orgSkills = loader.listForExpert('org');
    const financeSkills = loader.listForExpert('finance');
    const marketingSkills = loader.listForExpert('marketing');
    const actionSkills = loader.listForExpert('action');
    const bizSkills = loader.listForExpert('business-model');
    const techSkills = loader.listForExpert('tech');
    const knowledgeSkills = loader.listForExpert('knowledge');

    const total = strategySkills.length + orgSkills.length + financeSkills.length
      + marketingSkills.length + actionSkills.length + bizSkills.length
      + techSkills.length + knowledgeSkills.length;

    expect(total).toBeGreaterThanOrEqual(30);
  });

  it('Given strategy 专家, When buildCatalogText, Then 返回非空技能目录', () => {
    const catalog = loader.buildCatalogText('strategy');
    expect(catalog).toBeTruthy();
    expect(catalog.length).toBeGreaterThan(50);
    expect(catalog).toContain('Available Skills');
  });

  it('Given business-model 专家, Then 包含 duan-six-questions 和 value-cycle', () => {
    const skills = loader.listForExpert('business-model');
    const names = skills.map(s => s.name);
    expect(names).toContain('duan-six-questions');
    expect(names).toContain('value-cycle');
  });

  it('Given org 专家, Then 包含 yang-triangle 和 htm-assessment', () => {
    const skills = loader.listForExpert('org');
    const names = skills.map(s => s.name);
    expect(names).toContain('yang-triangle');
    expect(names).toContain('htm-assessment');
  });

  it('Given action 专家, Then 包含 constraint-id', () => {
    const skills = loader.listForExpert('action');
    const names = skills.map(s => s.name);
    expect(names).toContain('constraint-id');
  });

  it('Given 所有专家, When buildCatalogText, Then 均非空', () => {
    const experts = ['strategy', 'org', 'finance', 'marketing', 'action', 'business-model', 'tech', 'knowledge'];
    for (const exp of experts) {
      const catalog = loader.buildCatalogText(exp);
      expect(catalog).toBeTruthy();
      expect(catalog.length).toBeGreaterThan(20);
    }
  });

  it('Given non-existent expert, When listForExpert, Then 返回空数组', () => {
    const skills = loader.listForExpert('nonexistent');
    expect(skills).toEqual([]);
  });

  it('Given strategy expert, Then skill stubs 含 name + description + source', () => {
    const skills = loader.listForExpert('strategy');
    expect(skills.length).toBeGreaterThan(0);
    for (const s of skills) {
      expect(s.name).toBeTruthy();
      expect(s.description).toBeTruthy();
      expect(s.source).toBeTruthy();
    }
  });
});

// ═══ D986（施工单 0-12）新增 ═══

describe('D986 — 启动自加载 + v3.0 专家 id 目录（穿生产消费点）', () => {
  const loader = getSkillLoader();

  it('Given 全新模块实例且【未显式 scanFromFiles】, When 取单例, Then 技能已自加载', async () => {
    vi.resetModules();
    const fresh = await import('../../src/agent/skill-lazy-loader');
    const autoLoader = fresh.getSkillLoader();

    // 46 个技能文件（口径: git ls-tree -r --name-only origin/main -- skills/ | grep -c '\.md$'）
    expect(autoLoader.listNames().length).toBeGreaterThanOrEqual(40);
    expect(autoLoader.listForExpert('competitive-strategy').length).toBeGreaterThan(0);
  });

  it('Given 未显式 scan, When buildCatalogText(competitive-strategy), Then 含 `## Available Skills`', async () => {
    vi.resetModules();
    const fresh = await import('../../src/agent/skill-lazy-loader');
    const catalog = fresh.getSkillLoader().buildCatalogText('competitive-strategy');

    expect(catalog).toContain('## Available Skills');
    expect(catalog).toContain('seven-powers');
  });

  it('Given 注册表全部专家 id, When 逐个 buildCatalogText, Then 均非空', () => {
    const expertIds = getAllExpertIds();
    expect(expertIds.length).toBeGreaterThanOrEqual(6);

    for (const id of expertIds) {
      const catalog = loader.buildCatalogText(id);
      expect(catalog, `专家 ${id} 的技能目录为空`).toContain('## Available Skills');
    }
  });

  it('Given 真实 skills/ 扫描结果, Then 无块标量描述污染（不以 `>` / `|` 开头）', () => {
    // 覆盖集合: 8 个 legacy 目录名 + 6 个 v3.0 专家 id + 6 个未映射工作流目录
    const buckets = [
      'strategy', 'org', 'finance', 'marketing', 'action', 'business-model', 'tech', 'knowledge',
      'competitive-strategy', 'organizational-capability', 'fundamental-efficiency', 'customer-growth',
      'technology-foundation', 'host',
      'cross_validate', 'detect_contradiction', 'human_calibration', 'match_pattern', 'trace_evidence',
      'verify_closed_loop',
    ];
    const stubs = buckets.flatMap(b => loader.listForExpert(b));
    expect(stubs.length).toBeGreaterThanOrEqual(40);

    const polluted = stubs.filter(s => /^[>|]/.test(s.description)).map(s => s.name);
    expect(polluted).toEqual([]);
  });

  it('Given D650 映射, Then legacy 目录与 v3.0 专家 id 双链（映射键非空）', () => {
    // competitive-strategy ← strategy + business-model；host ← action + knowledge
    expect(loader.listForExpert('competitive-strategy').length).toBeGreaterThanOrEqual(10);
    expect(loader.listForExpert('host').length).toBeGreaterThanOrEqual(10);
    // legacy 名仍可查（向后兼容）
    expect(loader.listForExpert('strategy').length).toBeGreaterThan(0);
  });
});
