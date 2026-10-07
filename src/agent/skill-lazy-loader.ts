/**
 * agent/skill-lazy-loader.ts — 渐进式技能加载器 (Era C3)
 *
 * 技能注册时只注入 name + description (~100 chars)。
 * 专家 ReAct 循环中请求使用该技能时，再加载完整 prompt。
 * 对标: OpenClaw 三级 Skill 加载 (workspace > user-global > built-in)
 *
 * 铁律 39: L2 编排层 — 管理技能生命周期，不直接操作 L4/L5。
 *
 * D986（施工单 0-12）: 此前 `scanFromFiles()` **零调用点** ⇒ `skills/` 46 个技能文件恒不加载
 *   ⇒ 专家 prompt 恒无 `## Available Skills`。现由 `getSkillLoader()` 首用一次性自加载触发；
 *   挂载键 = legacy 目录名 + D650 映射后的 v3.0 专家 id（映射单一真源 = `./expert-name-map`，
 *   与 `src/l3/synova-diagnosis-engine-impl.ts` 共用，禁止各写一份）。
 *
 * @follow-up 若将来要求**启动期确定性加载**（而非首用自加载），显式接线点在
 *   `src/deploy/bootstrap.ts` Phase 2b（SkillLoader 段，约 :417-451）；本模块自加载保持幂等，
 *   届时重复调用无副作用。
 */

import { createLogger } from '@synova/logger';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { LEGACY_TO_EXPERT_ID_MAP } from './expert-name-map';
import { getAllExpertIds } from './expert-config-loader';

const log = createLogger('agent/skill-lazy-loader');

// ═══ Types ═══

/**
 * 默认技能目录（D986）。
 * 口径: `SYNOVA_SKILLS_DIR` 环境变量优先，缺省 `<cwd>/skills`（与 `expert-config-loader.ts:28`
 * 的 `join(process.cwd(), 'expert', …)` 同约定）。
 */
export const DEFAULT_SKILLS_DIR = process.env.SYNOVA_SKILLS_DIR || join(process.cwd(), 'skills');

export interface SkillStub {
  name: string;
  description: string;         // ≤ 200 chars — 注入到上下文的摘要
  fullPrompt?: string;         // 完整 prompt — 按需加载
  /** 加载来源 */
  source: 'builtin' | 'workspace' | 'custom';
  /** 文件路径 (workspace 来源时) */
  filePath?: string;
  /** 激活条件 — 什么情况下这个 skill 应该被加载 */
  activationKeywords?: string[];
}

// ═══ SkillLazyLoader ═══

export class SkillLazyLoader {
  private stubs = new Map<string, SkillStub>();
  /** expertType → skill name[] 映射 */
  private expertIndex = new Map<string, string[]>();

  /**
   * 注册一个 skill (只存 stub)。
   * 来源: 扫描 expert/{name}/SKILLS.md 或 knowledge/ 目录
   */
  register(stub: SkillStub): void {
    if (this.stubs.has(stub.name)) {
      log.warn({ name: stub.name }, 'Skill 重复注册, 覆盖旧值');
    }
    // 截断 description 确保不超过 200 字符
    const truncated = { ...stub, description: stub.description.slice(0, 200) };
    this.stubs.set(stub.name, truncated);
    log.debug({ name: stub.name, source: stub.source }, 'Skill stub 已注册');
  }

  /**
   * 根据专家查询，返回匹配的 skill stub 列表 (不含 fullPrompt)。
   * 用于注入到专家的 system prompt 中作为"可用技能目录"。
   */
  listForExpert(expertType: string): SkillStub[] {
    const names = this.expertIndex.get(expertType);
    if (!names || names.length === 0) return [];
    return names
      .map(n => this.stubs.get(n))
      .filter((s): s is SkillStub => s !== undefined)
      .map(s => ({ name: s.name, description: s.description, source: s.source }));
  }

  /**
   * 按需加载完整 prompt — 专家 ReAct 循环中调用。
   * 命中则返回 fullPrompt, 未命中返回 null。
   */
  loadFull(name: string): string | null {
    const stub = this.stubs.get(name);
    if (!stub) return null;
    // 如果已有 fullPrompt 直接返回
    if (stub.fullPrompt) return stub.fullPrompt;
    // 尝试从文件系统加载
    if (stub.filePath) {
      try {
        if (existsSync(stub.filePath)) {
          const content = readFileSync(stub.filePath, 'utf-8');
          stub.fullPrompt = content;
          return content;
        }
      } catch (err: unknown) {
        log.warn({ err, name, filePath: stub.filePath }, 'Skill 文件加载失败');
      }
    }
    return null;
  }

  /**
   * 从文件系统扫描 skills (workspace > built-in 优先级)。
   * 扫描路径: skills/{category}/*.md  (v2.1: 多文件格式)
   *           skills/{category}/SKILLS.md  (兼容旧格式)
   *           skills/*.md  (知识文件)
   *
   * 自动从目录名提取 expert category → linkToExpert()
   *
   * 契约（铁律 47）:
   *   @input  — baseDir: 技能根目录（相对 cwd 或绝对；不存在不算错）
   *   @output — 本次注册成功的技能条数（0 = 目录缺失 / 为空）
   *   @degraded — 目录不存在 ⇒ `log.debug` + 0；单个分类目录读取失败 ⇒ `log.warn` 后继续其余分类；
   *               整体失败 ⇒ `log.warn` + 返回已注册条数（**不抛**，铁律 24/31）
   *   @sideEffect — 挂载键 = legacy 目录名 + D650 映射后的 v3.0 专家 id（映射单一真源 =
   *                 `./expert-name-map`；目标 id 经 `getAllExpertIds()` 校验，未知则只留 legacy 键）
   */
  scanFromFiles(baseDir: string): number {
    let count = 0;
    try {
      if (!existsSync(baseDir)) {
        log.debug({ baseDir }, 'Skill 扫描目录不存在, 跳过');
        return 0;
      }
      const entries = readdirSync(baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          // skills/*.md — 知识文件 (旧格式兼容)
          if (entry.name.endsWith('.md') && entry.name !== 'SKILLS.md') {
            const knowledgePath = join(baseDir, entry.name);
            const content = readFileSync(knowledgePath, 'utf-8');
            const name = entry.name.replace(/\.md$/, '');
            const firstLine = content.split('\n')[0] || '';
            const description = firstLine.replace(/^#\s*/, '').slice(0, 200) || name;
            this.register({
              name: `knowledge-${name}`,
              description,
              fullPrompt: content,
              source: 'workspace',
              filePath: knowledgePath,
            });
            count++;
          }
          continue;
        }

        // ═══ skills/{category}/ — 扫描目录下所有 .md 文件 ═══
        const categoryDir = join(baseDir, entry.name);
        const expertType = entry.name; // 目录名 = expert type (strategy/org/finance...)
        let categoryCount = 0;

        try {
          const skillFiles = readdirSync(categoryDir, { withFileTypes: true });
          for (const skillFile of skillFiles) {
            if (!skillFile.isFile() || !skillFile.name.endsWith('.md')) continue;

            const skillPath = join(categoryDir, skillFile.name);
            const skillName = skillFile.name.replace(/\.md$/, '');
            const content = readFileSync(skillPath, 'utf-8');

            // D986: front matter 解析（含 YAML 块标量描述 `description: >-` / `|`）
            const frontMatter = parseFrontMatter(content);
            const name = frontMatter.name || skillName;
            let description = (frontMatter.description || '').slice(0, 200);
            if (!description) {
              const firstLine = content.split('\n').filter(l => l.startsWith('#') && !l.startsWith('##'))[0] || '';
              description = firstLine.replace(/^#\s*/, '').slice(0, 200) || skillName;
            }

            const keywords = extractKeywords(content);
            this.register({
              name,
              description,
              fullPrompt: content,
              source: 'workspace',
              filePath: skillPath,
              activationKeywords: keywords,
            });

            // ═══ v2.1 + D986: 自动建立 skill→expert 映射 ═══
            // 键 = legacy 目录名（向后兼容旧消费方）+ D650 映射后的 v3.0 专家 id（生产传参口径）
            for (const expertKey of this.resolveExpertLinks(expertType)) {
              this.linkToExpert(expertKey, name);
            }

            categoryCount++;
            count++;
          }
        } catch (err: unknown) {
          log.warn({ err, categoryDir }, `skills/${expertType}/ 扫描失败 — degraded`);
        }

        if (categoryCount > 0) {
          log.debug({ expertType, skills: categoryCount }, `Skills 已关联到专家`);
        }
      }
    } catch (err: unknown) {
      log.warn({ err, baseDir }, 'Skill 文件扫描失败 — degraded');
    }
    log.info({ count, baseDir }, 'Skill 文件扫描完成');
    return count;
  }

  /**
   * 获取可注入上下文的摘要文本 (用于拼接到 system prompt)。
   * 返回格式:
   *   ## Available Skills
   *   - name: description
   */
  buildCatalogText(expertType: string): string {
    const skills = this.listForExpert(expertType);
    if (skills.length === 0) return '';
    const lines = ['## Available Skills', ''];
    for (const s of skills) {
      lines.push(`- **${s.name}**: ${s.description}`);
    }
    return lines.join('\n');
  }

  /** 三级加载: workspace > user-global > built-in */
  resolveWithPriority(name: string): SkillStub | null {
    const stub = this.stubs.get(name);
    if (!stub) return null;

    // 检查是否有更高优先级的同名 skill
    const all = Array.from(this.stubs.values())
      .filter(s => s.name === name)
      .sort((a, b) => {
        const pri = (s: SkillStub): number =>
          s.source === 'workspace' ? 3 : s.source === 'custom' ? 2 : 1;
        return pri(b) - pri(a);
      });
    return all[0] || stub;
  }

  /** 将技能关联到专家类型 */
  linkToExpert(expertType: string, skillName: string): void {
    const existing = this.expertIndex.get(expertType) || [];
    if (!existing.includes(skillName)) {
      this.expertIndex.set(expertType, [...existing, skillName]);
    }
  }

  /**
   * 计算某分类目录应挂载的专家键（D986）。
   *
   * 契约:
   *   @input  — dirName: `skills/` 下的一级目录名（= legacy expert category）
   *   @output — 键数组: 恒含 dirName；若存在 D650 映射且目标 id 在注册表内，再含目标 id
   *   @degraded — 映射目标不在 `getAllExpertIds()`（`expert/expert-registry.yaml` 为唯一事实源）
   *               ⇒ 只返回 dirName + `log.warn`，**不回落 host**
   *               （理由: 技能挂载是「增强」不是「路由」——挂错 = 把无关技能灌进该专家 prompt；
   *                宁可不挂并留痕，也不静默污染）
   */
  private resolveExpertLinks(dirName: string): string[] {
    const links = [dirName];
    const mapped = LEGACY_TO_EXPERT_ID_MAP[dirName]
      ?? LEGACY_TO_EXPERT_ID_MAP[dirName.replace(/-/g, '_')];
    if (!mapped || mapped === dirName) return links;

    const known = getAllExpertIds();
    if (known.length === 0) {
      log.warn({ dirName, mapped }, '专家注册表为空 — 映射键未生效（仅 legacy 挂载）');
      return links;
    }
    if (!known.includes(mapped)) {
      log.warn({ dirName, mapped, known }, '映射目标不在专家注册表中 — 仅 legacy 挂载');
      return links;
    }
    links.push(mapped);
    return links;
  }

  /** 获取所有已注册 skill 名称 */
  listNames(): string[] {
    return Array.from(this.stubs.keys());
  }
}

// ═══ Helpers ═══

/**
 * 解析技能文件头部的 YAML front matter（只取 name / description）。
 *
 * 支持三种 YAML 标量形态（实测 `skills/` 内三种都存在）:
 *   · 单行裸值      `description: 7 Powers 量化引擎——…`
 *   · 单行引号值    `description: "多源交叉验证——…"`
 *   · 块标量        `description: >-` / `description: |`（值在后续缩进行）
 *
 * 契约:
 *   @input  — 文件全文
 *   @output — `{ name?, description? }`（缺项不填；多行块标量以空格拼接为单行）
 *   @degraded — 无 front matter / 解析不出 ⇒ 返回空对象（调用方回落首行标题，不抛）
 *   @contract — 不解析 name/description 之外的字段（`when_to_use`/`required_tools` 等由
 *               `src/skills/**` 体系负责，本加载器只做 prompt 目录注入）
 */
function parseFrontMatter(content: string): { name?: string; description?: string } {
  const result: { name?: string; description?: string } = {};
  const lines = content.split('\n');
  if ((lines[0] ?? '').trim() !== '---') return result;
  const endIndex = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (endIndex < 0) return result;

  const fm = lines.slice(1, endIndex);
  for (let i = 0; i < fm.length; i++) {
    const nameMatch = fm[i].match(/^name:\s*(.+)$/);
    if (nameMatch && !result.name) {
      result.name = stripQuotes(nameMatch[1]);
      continue;
    }
    const descMatch = fm[i].match(/^description:\s*(.*)$/);
    if (!descMatch || result.description) continue;

    const inline = descMatch[1].trim();
    if (/^[>|][-+]?$/.test(inline)) {
      // 块标量: 收集其后的缩进行（空行跳过；遇到非缩进行即结束）
      const chunk: string[] = [];
      for (let j = i + 1; j < fm.length; j++) {
        const line = fm[j];
        if (line.trim() === '') continue;
        if (!/^\s+\S/.test(line)) break;
        chunk.push(line.trim());
      }
      result.description = chunk.join(' ');
    } else {
      result.description = stripQuotes(inline);
    }
  }
  return result;
}

/** 去掉 YAML 标量两端的引号（单/双引号） */
function stripQuotes(raw: string): string {
  return raw.trim().replace(/^["']|["']$/g, '');
}

/**
 * 从 Markdown 内容中提取关键词 (用于 activationKeywords)。
 * 取前 200 字符中的有意义的词汇。
 */
function extractKeywords(content: string): string[] {
  const head = content.slice(0, 500);
  const words = head
    .replace(/[#*`[\]()]/g, '')
    .split(/[\s\n,.;:!?]+/)
    .map(w => w.trim().toLowerCase())
    .filter(w => w.length > 2 && !['the', 'and', 'for', 'are', 'this', 'that', 'with', 'from'].includes(w));
  return [...new Set(words)].slice(0, 20);
}

// ═══ Singleton ═══

let _skillLoader: SkillLazyLoader | null = null;
/** D986: 一次性自加载守卫（幂等 —— 重复调用只扫描一次） */
let _autoScanDone = false;

/**
 * 取全局 SkillLazyLoader 单例（D986: **首次调用**对 `DEFAULT_SKILLS_DIR` 做一次性自加载）。
 *
 * 为什么自加载挂在这里: `scanFromFiles()` 此前零调用点（46 个技能文件恒不加载），
 * 而本单例正是生产链上唯一被消费的实例 —— `src/l3/expert-dispatcher.ts:311` 调
 * `getSkillLoader().buildCatalogText(type)` 拼进专家 systemPrompt。首用即加载 = 最小接线面。
 *
 * 契约（铁律 47）:
 *   @input  — 无（目录口径 = `SYNOVA_SKILLS_DIR` 环境变量，缺省 `<cwd>/skills`）
 *   @output — 单例（索引为空亦为合法返回；`buildCatalogText()` 此时返回 ''）
 *   @degraded — 目录缺失 / 扫描抛错 ⇒ 空索引 + `log.debug|warn`，**不抛、不阻断**（铁律 24/31）
 *   @contract — 幂等: 重复调用只扫描一次（`_autoScanDone` 守卫，置位在扫描前，失败不重试）
 * @follow-up 要求「启动期确定性加载」时，在 `src/deploy/bootstrap.ts` Phase 2b 显式调用本函数
 *   （或 `scanFromFiles(DEFAULT_SKILLS_DIR)`）——本函数幂等，届时无副作用。
 */
export function getSkillLoader(): SkillLazyLoader {
  if (!_skillLoader) {
    _skillLoader = new SkillLazyLoader();
  }
  if (!_autoScanDone) {
    _autoScanDone = true;
    const count = _skillLoader.scanFromFiles(DEFAULT_SKILLS_DIR);
    log.info({ count, dir: DEFAULT_SKILLS_DIR }, 'Skill 自加载完成（D986）');
  }
  return _skillLoader;
}
