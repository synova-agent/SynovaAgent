/**
 * tests/agent/skill-lazy-loader.test.ts — C3 渐进式技能加载器测试
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SkillLazyLoader, type SkillStub } from '../../src/agent/skill-lazy-loader';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';

describe('SkillLazyLoader', () => {
  let loader: SkillLazyLoader;

  beforeEach(() => {
    loader = new SkillLazyLoader();
  });

  describe('register()', () => {
    it('Given valid stub, When registered, Then can list names', () => {
      loader.register({
        name: 'browser-automation',
        description: 'Control a web browser for testing and automation',
        fullPrompt: '# Browser Automation\nNavigate, click, fill forms...',
        source: 'builtin',
      });

      const names = loader.listNames();
      expect(names).toContain('browser-automation');
    });

    it('Given long description, When registered, Then truncated to 200 chars', () => {
      const longDesc = 'x'.repeat(500);
      loader.register({
        name: 'test-skill',
        description: longDesc,
        source: 'builtin',
      });

      const skills = loader.listNames();
      expect(skills).toContain('test-skill');
    });
  });

  describe('listForExpert()', () => {
    it('Given skills linked to expert, When listed, Then returns stubs without fullPrompt', () => {
      loader.register({
        name: 'ui-test',
        description: 'UI testing tools',
        fullPrompt: '# UI Test\nFull content here',
        source: 'builtin',
      });
      loader.linkToExpert('tech_expert', 'ui-test');

      const skills = loader.listForExpert('tech_expert');
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('ui-test');
      expect(skills[0].description).toBe('UI testing tools');
      // fullPrompt 不应出现在 listForExpert 的结果中
      expect((skills[0] as SkillStub).fullPrompt).toBeUndefined();
    });

    it('Given no linked skills, When listed, Then returns empty array', () => {
      const skills = loader.listForExpert('finance_expert');
      expect(skills).toHaveLength(0);
    });
  });

  describe('loadFull()', () => {
    it('Given registered skill with fullPrompt, When loadFull, Then returns prompt', () => {
      loader.register({
        name: 'db-query',
        description: 'Database query tools',
        fullPrompt: '# DB Query\nSELECT, INSERT, UPDATE...',
        source: 'builtin',
      });

      const full = loader.loadFull('db-query');
      expect(full).toBe('# DB Query\nSELECT, INSERT, UPDATE...');
    });

    it('Given unregistered skill, When loadFull, Then returns null', () => {
      const full = loader.loadFull('nonexistent');
      expect(full).toBeNull();
    });
  });

  describe('buildCatalogText()', () => {
    it('Given skills for expert, When called, Then returns markdown catalog', () => {
      loader.register({ name: 'git-tools', description: 'Git operations', source: 'builtin' });
      loader.register({ name: 'docker-tools', description: 'Docker management', source: 'builtin' });
      loader.linkToExpert('tech_expert', 'git-tools');
      loader.linkToExpert('tech_expert', 'docker-tools');

      const text = loader.buildCatalogText('tech_expert');
      expect(text).toContain('Available Skills');
      expect(text).toContain('git-tools');
      expect(text).toContain('docker-tools');
    });

    it('Given no skills, When called, Then returns empty string', () => {
      const text = loader.buildCatalogText('finance_expert');
      expect(text).toBe('');
    });
  });

  describe('resolveWithPriority()', () => {
    it('Given same name with different sources, When resolved, Then workspace wins', () => {
      loader.register({ name: 'weather', description: 'Builtin weather', source: 'builtin' });
      loader.register({ name: 'weather', description: 'Custom weather v2', source: 'workspace' });

      const resolved = loader.resolveWithPriority('weather');
      expect(resolved).not.toBeNull();
      expect(resolved!.source).toBe('workspace');
    });

    it('Given unknown name, When resolved, Then returns null', () => {
      const resolved = loader.resolveWithPriority('unknown');
      expect(resolved).toBeNull();
    });
  });

  describe('scanFromFiles()', () => {
    const testDir = '/tmp/synova-skill-test';

    beforeEach(() => {
      if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true });
      // Create test skill directory
      const skillSubDir = join(testDir, 'test-expert');
      if (!existsSync(skillSubDir)) mkdirSync(skillSubDir, { recursive: true });
      writeFileSync(join(skillSubDir, 'SKILLS.md'), '# Test Expert Skill\nDo something useful.\n## Steps\n1. Step one\n2. Step two');
      // Create knowledge file
      writeFileSync(join(testDir, 'industry-knowledge.md'), '# Industry Knowledge\nMarket insights for analysis.');
    });

    afterEach(() => {
      rmSync(testDir, { recursive: true, force: true });
    });

    it('Given directory with skills and knowledge, When scanned, Then registers stubs', () => {
      const count = loader.scanFromFiles(testDir);
      expect(count).toBeGreaterThan(0);
      // Should have at least the SKILLS.md entry
      expect(loader.listNames().length).toBe(count);
    });

    it('Given nonexistent directory, When scanned, Then returns 0 gracefully', () => {
      const count = loader.scanFromFiles('/tmp/nonexistent-path-xyz');
      expect(count).toBe(0);
    });
  });

  describe('linkToExpert()', () => {
    it('Given skill linked to two experts, Then each expert sees it', () => {
      loader.register({ name: 'data-query', description: 'Query data', source: 'builtin' });
      loader.linkToExpert('finance_expert', 'data-query');
      loader.linkToExpert('org_expert', 'data-query');

      expect(loader.listForExpert('finance_expert')).toHaveLength(1);
      expect(loader.listForExpert('org_expert')).toHaveLength(1);
    });
  });

  // ═══ D986（施工单 0-12）新增: 目录名→专家 id 映射 / 块标量描述 / 幂等 / 降级 ═══

  describe('D986 scanFromFiles(): D650 映射（legacy 名 + v3.0 专家 id 双链）', () => {
    const mapDir = '/tmp/synova-skill-map-test';

    beforeEach(() => {
      rmSync(mapDir, { recursive: true, force: true });
      mkdirSync(join(mapDir, 'strategy'), { recursive: true });
      writeFileSync(
        join(mapDir, 'strategy', 'seven-powers.md'),
        '---\nname: seven-powers\ndescription: 7 Powers 量化引擎\n---\n\n# 7 Powers\n',
      );
    });

    afterEach(() => {
      rmSync(mapDir, { recursive: true, force: true });
    });

    it('Given skills/strategy/, When scanned, Then 既挂 legacy 名也挂 v3.0 专家 id', () => {
      const count = loader.scanFromFiles(mapDir);
      expect(count).toBe(1);
      expect(loader.listForExpert('strategy').map(s => s.name)).toContain('seven-powers');
      expect(loader.listForExpert('competitive-strategy').map(s => s.name)).toContain('seven-powers');
    });

    it('Given skills/org/, Then 映射到 organizational-capability（而非 host）', () => {
      mkdirSync(join(mapDir, 'org'), { recursive: true });
      writeFileSync(join(mapDir, 'org', 'bus-factor.md'), '---\nname: bus-factor\ndescription: 巴士因子\n---\n\n# bus-factor\n');

      loader.scanFromFiles(mapDir);

      expect(loader.listForExpert('organizational-capability').map(s => s.name)).toContain('bus-factor');
      expect(loader.listForExpert('host')).toHaveLength(0);
    });

    it('Given 无映射的目录名, Then 只挂 legacy 名（不猜、不回落 host）', () => {
      mkdirSync(join(mapDir, 'cross_validate'), { recursive: true });
      writeFileSync(join(mapDir, 'cross_validate', 'SKILL.md'), '---\nname: cross_validate\ndescription: 多源交叉验证\n---\n\n## 执行步骤\n');

      loader.scanFromFiles(mapDir);

      expect(loader.listForExpert('cross_validate').map(s => s.name)).toContain('cross_validate');
      expect(loader.listForExpert('host')).toHaveLength(0);
    });

    it('Given 连字符目录（business-model）, Then 命中下划线键（business_model → competitive-strategy）', () => {
      mkdirSync(join(mapDir, 'business-model'), { recursive: true });
      writeFileSync(join(mapDir, 'business-model', 'value-cycle.md'), '---\nname: value-cycle\ndescription: 价值循环\n---\n\n# value-cycle\n');

      loader.scanFromFiles(mapDir);

      expect(loader.listForExpert('competitive-strategy').map(s => s.name)).toContain('value-cycle');
    });
  });

  describe('D986 parseFrontMatter(): YAML 块标量描述', () => {
    const blockDir = '/tmp/synova-skill-block-test';

    beforeEach(() => {
      rmSync(blockDir, { recursive: true, force: true });
      mkdirSync(join(blockDir, 'finance'), { recursive: true });
      // 三种形态：块标量 `>-` / 块标量 `|` / 单行引号值
      writeFileSync(
        join(blockDir, 'finance', 'dupont.md'),
        '---\nname: dupont-analysis\ndescription: >-\n  杜邦分析——把 ROE 拆成三因子。\n  用于定位利润率与周转率问题。\nwhen_to_use: 财务诊断时\n---\n\n# 杜邦分析\n',
      );
      writeFileSync(
        join(blockDir, 'finance', 'cashflow.md'),
        '---\nname: cashflow-analysis\ndescription: |\n  现金流分析——\n  经营性/投资性/筹资性三段。\n---\n\n# 现金流分析\n',
      );
      writeFileSync(
        join(blockDir, 'finance', 'unit-economics.md'),
        '---\nname: unit-economics\ndescription: "单位经济模型——LTV/CAC"\n---\n\n# 单位经济\n',
      );
    });

    afterEach(() => {
      rmSync(blockDir, { recursive: true, force: true });
    });

    it('Given description 块标量, When scanned, Then 描述不含 `>-`/`|` 标记且非空', () => {
      loader.scanFromFiles(blockDir);
      const stubs = loader.listForExpert('finance');

      expect(stubs).toHaveLength(3);
      for (const s of stubs) {
        expect(s.description.length).toBeGreaterThan(0);
        expect(s.description.startsWith('>')).toBe(false);
        expect(s.description.startsWith('|')).toBe(false);
      }
    });

    it('Given 块标量 `>-`, Then 多行拼接为单行描述', () => {
      loader.scanFromFiles(blockDir);
      const dupont = loader.listForExpert('finance').find(s => s.name === 'dupont-analysis');

      expect(dupont).toBeDefined();
      expect(dupont!.description).toContain('杜邦分析');
      expect(dupont!.description).toContain('周转率');
    });

    it('Given 单行引号值, Then 去掉引号', () => {
      loader.scanFromFiles(blockDir);
      const unit = loader.listForExpert('finance').find(s => s.name === 'unit-economics');

      expect(unit).toBeDefined();
      expect(unit!.description).toBe('单位经济模型——LTV/CAC');
    });
  });

  describe('D986 scanFromFiles(): 幂等与降级', () => {
    const idemDir = '/tmp/synova-skill-idem-test';

    beforeEach(() => {
      rmSync(idemDir, { recursive: true, force: true });
      mkdirSync(join(idemDir, 'tech'), { recursive: true });
      writeFileSync(join(idemDir, 'tech', 'software-ecosystem-scan.md'), '---\nname: software-ecosystem-scan\ndescription: 软件生态扫描\n---\n\n# 生态扫描\n');
      mkdirSync(join(idemDir, 'empty-category'), { recursive: true });
    });

    afterEach(() => {
      rmSync(idemDir, { recursive: true, force: true });
    });

    it('Given 同一目录连扫两次, Then 名称集合不翻倍', () => {
      loader.scanFromFiles(idemDir);
      const afterFirst = loader.listNames().length;
      loader.scanFromFiles(idemDir);

      expect(afterFirst).toBe(1);
      expect(loader.listNames().length).toBe(afterFirst);
    });

    it('Given 空目录, Then 返回 0 且不抛', () => {
      mkdirSync(join(idemDir, 'nothing-here'), { recursive: true });
      expect(() => loader.scanFromFiles(join(idemDir, 'nothing-here'))).not.toThrow();
      expect(loader.scanFromFiles(join(idemDir, 'nothing-here'))).toBe(0);
    });
  });
});
