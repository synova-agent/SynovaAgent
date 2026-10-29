/**
 * agent/builtin-tools.ts — 内置工具注册 (Era 2.2)
 *
 * SynovaAgent 对话中可用的 4 个内置工具。
 * 内置工具集 + agent-tool-registry 注册范式（原 engine-core 工具集已随引擎退役）。
 */
import type { ToolDefinition, ToolRegistry } from './tools';
import type { SessionStore } from '../store/session-store';
import { ACCURACY_TOOLS, ORG_EXPERT_TOOLS, TECH_EXPERT_TOOLS, STRATEGY_EXPERT_TOOLS, FINANCE_EXPERT_TOOLS, ACTION_EXPERT_TOOLS, MARKETING_EXPERT_TOOLS } from '../tools';
import { createLogger } from '@synova/logger';
import { registerPandocTools } from '../../vendor/pandoc-skill/synova-tools';
import type { RoleKnowledgeFilter } from '../init/role-pack-knowledge-filter';

const log = createLogger('agent/builtin-tools');

/**
 * #1075 P2-4b-B: 构造**角色会话知识检索**系统工具（`search_knowledge`）。
 *
 * 为什么是"工厂 + provider"而不是 `register()`（规格 §2.2-D1，CTO A 类裁定）:
 *   · 系统工具**不属于**岗位包声明面 ⇒ 不注册进 `ToolRegistry.tools`（P2-4a 的
 *     `allToolNames()`／allowlist 编译语义保持纯净），改由 `setSystemToolProvider()` 注入；
 *   · 过滤器来自引擎运行期状态（撤销/换岗即时生效）⇒ 通过 `getFilter()` 闭包**每次求值**读取，
 *     工具对象本身不缓存任何判定结果。
 *
 * 契约（铁律 47）:
 *   @input    `getFilter()` — 返回当前会话的知识过滤面；`null` = 本会话无知识权限面（未绑定岗位/
 *             已回滚关闭）⇒ 工具返回结构化 `E_KNOWLEDGE_UNAVAILABLE`。工具入参:
 *             `query`（字符串，去空白后 1–200 字，**必填**）｜`limit`（1–10 的整数，缺省 5）
 *   @output   `{ results: [{id, text, snippet, domain}], count }`；拒绝型/降级过滤面照常返回
 *             `results: []`（**不假装有权限**，另带 `degraded:true`）
 *   @degraded 引擎侧未初始化（`getDatabase()` 抛）／L4 检索抛错 ⇒ 结构化
 *             `{ error: { name:'KnowledgeSearchError', code:'E_KNOWLEDGE_SEARCH_FAILED', phase:'execute' } }`
 *             ＋ `log.warn`（不抛，不静默）；filter 缺失 ⇒ `E_KNOWLEDGE_UNAVAILABLE`
 *   @authority 只读：只做检索，不写知识库、不改权限、不签发身份；过滤面由调用方（引擎）给定
 *   @not-here  scope/敏感度编译（`src/init/role-pack-knowledge-filter.ts`）、检索与过滤执行
 *             （`src/l4/knowledge-store.ts`）、工具注册/白名单（`src/agent/tools.ts`）
 *   @error    永不抛（全部收敛为结构化 error；`phase` 标 validate/execute，铁律 32）
 *
 * 已知限制:
 *   · 仅覆盖 sensitivity ＋ pkb_domain 两维（同过滤器模块）；`pkb_domain = NULL` 的历史 chunk 恒不返回。
 *   · `limit` 越界按 [1,10] **钳位**（不报错）：LLM 传 0/11 时退化为 1/10，避免一次入参抖动断掉整轮。
 */
export function createKnowledgeSearchTool(getFilter: () => RoleKnowledgeFilter | null): ToolDefinition {
  return {
    name: 'search_knowledge',
    description:
      '在当前岗位的知识权限范围内检索知识库（scope ＋ 敏感度双重过滤；越权内容不可见）。'
      + 'query: 关键词（1–200 字）；limit: 返回条数（1–10，默认 5）。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索关键词（1–200 字）' },
        limit: { type: 'integer', description: '返回条数（1–10，默认 5）' },
      },
      required: ['query'],
    },
    operationType: 'read',
    sideEffects: 'none',
    handler: async (params) => {
      // ① 权限面：没有过滤面 ⇒ 无知识检索权限（不回落全库）
      const filter = getFilter();
      if (filter === null) {
        return {
          error: {
            name: 'KnowledgeSearchError',
            code: 'E_KNOWLEDGE_UNAVAILABLE',
            message: '当前会话没有知识检索权限面（未绑定岗位或已关闭角色知识工具）',
            phase: 'validate',
          },
        };
      }

      // ② 入参：schema 只声明类型（ToolParameter 无区间关键字）⇒ 区间在此 fail-closed
      const rawQuery = params.query;
      const query = typeof rawQuery === 'string' ? rawQuery.trim() : '';
      if (query.length < 1 || query.length > 200) {
        return {
          error: {
            name: 'KnowledgeSearchError',
            code: 'E_KNOWLEDGE_INVALID_ARGS',
            message: `query 必须是 1–200 字（实际 ${query.length} 字）`,
            phase: 'validate',
          },
        };
      }
      const rawLimit = params.limit;
      const limit = typeof rawLimit === 'number' && Number.isFinite(rawLimit)
        ? Math.min(10, Math.max(1, Math.trunc(rawLimit)))
        : 5;

      // ③ 检索：动态 import L4（`scripts/check-architecture.sh:40-51` 禁 L2→L4 **静态** import；
      //    本文件在 L2 编排面）。与 `src/agent/synova-agent.ts:199` 同一先例。
      try {
        const { KnowledgeStore } = await import('../l4/knowledge-store');
        const { getDatabase } = await import('../init/engine-context');
        const store = new KnowledgeStore(getDatabase());
        const found = store.search(query, { conditions: filter.conditions }, limit);
        return {
          results: found.results.map((r) => ({
            id: r.id,
            text: r.text,
            snippet: r.snippet,
            // 只在**工具边界**把内部字段 `pkbDomain` 映射为对外 `domain`（规格 §2.2-D5）
            domain: r.pkbDomain ?? null,
          })),
          count: found.results.length,
          // 降级面照常返回（空结果），但显式标记：不把"看不见"说成"没有"
          ...(filter.degraded ? { degraded: true } : {}),
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn(
          { err: message, degraded: true, code: 'E_KNOWLEDGE_SEARCH_FAILED' },
          '角色会话知识检索失败 — 结构化返回（不抛）',
        );
        return {
          error: {
            name: 'KnowledgeSearchError',
            code: 'E_KNOWLEDGE_SEARCH_FAILED',
            message: `知识检索不可用: ${message}`,
            phase: 'execute',
          },
        };
      }
    },
  };
}

export function registerBuiltinTools(
  registry: ToolRegistry,
  store: SessionStore,
  sessionId: string,
  getPhase: () => number,
  getOrgId: () => string,
): void {
  // ═══ query_ontology ═══
  registry.register({
    name: 'query_ontology',
    description: '查询当前组织的本体图（节点数、边数、实体类型分布）',
    parameters: {
      type: 'object',
      properties: {
        orgId: { type: 'string', description: '组织 ID，默认使用当前诊断组织' },
      },
    },
    handler: async (params) => {
      const orgId = (params.orgId as string) || getOrgId();
      log.info({ orgId }, 'query_ontology 工具调用');
      try {
        const BASE = `http://localhost:${process.env.PORT || 3000}`;
        const res = await fetch(`${BASE}/api/ontology/graph/${orgId}`);
        if (res.ok) {
          const data = await res.json() as { nodes?: Array<{ type?: string }>; edges?: unknown[]; nodeCount?: number; edgeCount?: number; orgId?: string };
          const nodeTypes = [...new Set((data.nodes || []).map(n => n.type).filter(Boolean))];
          return {
            orgId: data.orgId || orgId,
            nodeCount: data.nodeCount || 0,
            edgeCount: data.edgeCount || 0,
            nodeTypes,
            summary: nodeTypes.length > 0
              ? `本体图包含 ${data.nodeCount} 个节点 (${nodeTypes.join(', ')})、${data.edgeCount} 条边`
              : '本体图当前无数据',
            hint: data.nodeCount === 0 ? '使用 POST /api/ontology/ingest 上传文档来构建本体图' : undefined,
          };
        }
      } catch (err: any) {
        log.warn({ err: err.message }, 'query_ontology API 不可达');
        return { orgId, error: '本体 API 不可达——请确保 SynovaAgent 服务已启动' };
      }
      return { orgId, nodeCount: 0, edgeCount: 0, summary: '本体图当前无数据' };
    },
  });

  // ═══ show_diagnosis_progress ═══
  registry.register({
    name: 'show_diagnosis_progress',
    description: '显示当前诊断的进度（Phase、完成百分比、当前步骤）',
    parameters: {
      type: 'object',
      properties: {},
    },
    handler: async () => {
      const phase = getPhase();
      const labels = ['组织访谈', '数据采集', '假设生成', '根因分析', '报告生成', '交付'];
      return {
        phase,
        label: labels[phase] || `Phase ${phase}`,
        percent: Math.round((phase / 5) * 100),
        totalPhases: 5,
        currentStage: phase === 0 ? '正在通过访谈了解你的组织' : `诊断流水线 Phase ${phase}/5 进行中`,
      };
    },
  });

  // ═══ explain_finding ═══
  registry.register({
    name: 'explain_finding',
    description: '详细解释诊断中的某个发现或假设',
    parameters: {
      type: 'object',
      properties: {
        findingId: { type: 'string', description: '发现 ID 或关键词' },
      },
      required: ['findingId'],
    },
    handler: async (params) => {
      const findingId = params.findingId as string;
      // 搜索会话历史中匹配的消息
      const msgs = store.getMessages(sessionId);
      const related = msgs.filter(m =>
        m.content.toLowerCase().includes(findingId.toLowerCase())
      ).slice(-5);
      if (related.length > 0) {
        return {
          findingId,
          explanation: `在会话历史中找到 ${related.length} 条相关内容`,
          relatedMessages: related.map(m => ({ role: m.role, content: m.content.slice(0, 300), timestamp: m.timestamp })),
          suggestion: '可运行完整诊断获取更详细的分析',
        };
      }
      // 搜索所有历史会话
      const searchResults = store.search(findingId, 5);
      if (searchResults.length > 0) {
        return {
          findingId,
          explanation: `在历史诊断中找到 ${searchResults.length} 条相关内容`,
          relatedSessions: searchResults.map(r => ({ orgId: r.orgId, snippet: r.snippet, updatedAt: r.updatedAt })),
          suggestion: '可查看历史诊断获取详细分析',
        };
      }
      return {
        findingId,
        explanation: `未找到与"${findingId}"相关的历史诊断数据`,
        suggestion: '配置 LLM_API_KEY 并运行诊断获取详细分析',
      };
    },
  });

  // ═══ list_sessions ═══
  registry.register({
    name: 'list_sessions',
    description: '列出历史诊断会话',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '返回数量，默认 5' },
      },
    },
    handler: async (params) => {
      const limit = (params.limit as number) || 5;
      const sessions = store.listSessions(limit);
      return {
        sessions: sessions.map(s => ({
          id: s.id,
          orgId: s.orgId,
          phase: s.phase,
          updatedAt: s.updatedAt,
        })),
        total: sessions.length,
      };
    },
  });

  // ═══ read_document — 读取已摄取的文档内容 ═══
  registry.register({
    name: 'read_document',
    description: '读取已上传到知识库的文档内容。用于专家 Agent 查询历史诊断报告、上传的 PDF/TXT 等。',
    parameters: {
      type: 'object',
      properties: {
        orgId: { type: 'string', description: '组织 ID' },
        query: { type: 'string', description: '搜索关键词 (可选, 留空返回最近5条)' },
        limit: { type: 'number', description: '返回条数 (默认5)' },
      },
      required: ['orgId'],
    },
    operationType: 'read',
    sideEffects: 'none',
    handler: async (params) => {
      try {
        const orgId = String(params.orgId || getOrgId());
        const BASE = `http://localhost:${process.env.PORT || 3000}`;
        const res = await fetch(`${BASE}/api/ontology/graph/${orgId}`);
        if (!res.ok) return { documents: [], count: 0, hint: '本体 API 不可达' };
        const data = await res.json() as { nodes?: Array<{ type?: string; props?: Record<string, unknown> }> };
        const docs = (data.nodes || [])
          .filter(n => n.type === 'Document')
          .map(n => {
            const p = n.props as { name?: string; docType?: string };
            return { type: n.type, name: p?.name || '未命名', docType: p?.docType };
          });
        const limit = Number(params.limit || 5);
        const query = String(params.query || '').toLowerCase();
        const filtered = query
          ? docs.filter(d => d.name.toLowerCase().includes(query))
          : docs.slice(-limit);
        return { documents: filtered.slice(0, limit), count: filtered.length, totalDocs: docs.length, orgId };
      } catch (err: any) {
        log.warn({ err: err instanceof Error ? err.message : String(err) }, "工具参数格式化");
        return { error: `读取文档失败: ${err.message}` };
      }
    },
  });

  // ═══ Cron: schedule_task (用户通过对话设定定时任务) ═══
  registry.register({
    name: 'schedule_task',
    description: '设定定时任务。支持 cron 表达式 (分 时 日 月 周) 或自然语言描述。示例: 每天19:00发送简报 → cron="0 19 * * *"',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '任务名称' },
        cron: { type: 'string', description: 'cron 表达式, 如 "0 19 * * *" (每天19:00), "*/5 * * * *" (每5分钟)' },
        action: { type: 'string', description: '任务描述: "daily_briefing"=每日简报, "connector_sync"=连接器同步, "custom"=自定义' },
      },
      required: ['name', 'cron'],
    },
    operationType: 'write',
    sideEffects: 'mutating',
    handler: async (params) => {
      try {
        const { getGlobalScheduler } = await import('../cron/scheduler');
        const { getDatabase } = await import('../init/engine-context');
        const scheduler = getGlobalScheduler(getDatabase());

        const id = scheduler.schedule(
          String(params.name),
          String(params.cron),
          async () => {
            log.info({ task: params.name }, '定时任务触发');
            // Future: trigger actual action (briefing/connector sync/custom)
          },
        );

        return { ok: true, id, name: params.name, cron: params.cron, message: `定时任务 "${params.name}" 已设定 (${params.cron})` };
      } catch (err: any) {
        log.warn({ err: err instanceof Error ? err.message : String(err) }, "动态模块加载失败");
        return { error: `定时任务设定失败: ${err.message}` };
      }
    },
  });

  // ═══ Cron: list_scheduled_tasks ═══
  registry.register({
    name: 'list_scheduled_tasks',
    description: '查看所有已设定的定时任务，包括上次运行时间和失败次数',
    parameters: { type: 'object', properties: {} },
    operationType: 'read',
    sideEffects: 'none',
    handler: async () => {
      try {
        const { getGlobalScheduler } = await import('../cron/scheduler');
        const { getDatabase } = await import('../init/engine-context');
        const scheduler = getGlobalScheduler(getDatabase());
        const jobs = scheduler.listJobs();
        return {
          count: jobs.length,
          jobs: jobs.map(j => ({
            id: j.id, name: j.name, cron: j.cron,
            lastRunAt: j.lastRunAt, failures: j.failures, runs: j.runs,
          })),
        };
      } catch (err: any) {
        log.warn({ err: err instanceof Error ? err.message : String(err) }, "动态模块加载失败");
        return { error: `查询定时任务失败: ${err.message}` };
      }
    },
  });

  // ═══ Skill 安装器 — 用户对话"安装 XXX"触发 ═══
  registry.register({
    name: 'install_skill',
    description: '安装一个 Skill 或 MCP Server。系统自动执行安全审计后注册。用法: install_skill(skillName="brave-search")',
    parameters: {
      type: 'object',
      properties: {
        skillName: { type: 'string', description: 'Skill 名称: brave-search / github / memory / filesystem' },
      },
      required: ['skillName'],
    },
    operationType: 'write',
    sideEffects: 'mutating',
    handler: async (params) => {
      try {
        const { getSkillInstaller } = await import('../mcp/skill-installer');
        const { getMCPBridge } = await import('../mcp/bridge');
        const skillName = String(params.skillName);
        const installer = getSkillInstaller('vendor/mcp-servers');
        const manifests = installer.discover();
        const match = manifests.find(m => m.name === skillName);
        if (!match) return { error: `未找到 Skill: ${skillName}。可用: ${manifests.map(m => m.name).join(', ') || '无'}` };

        const result = await installer.install(
          `vendor/mcp-servers/${skillName}`,
          registry,
        );
        if (result.success) {
          return { ok: true, skill: skillName, auditScore: result.auditReport.score, tools: result.installedTools };
        }
        return { error: result.error || '安装失败', auditScore: result.auditReport.score };
      } catch (err: any) {
        log.warn({ err: err instanceof Error ? err.message : String(err) }, "动态模块加载失败");
        return { error: `安装失败: ${err.message}` };
      }
    },
  });

  // Phase B: 注册共享准确率工具
  for (const tool of ACCURACY_TOOLS) {
    registry.register(tool);
  }
  // Phase C: 注册全部专家工具链
  for (const t of ORG_EXPERT_TOOLS) registry.register(t);
  for (const t of TECH_EXPERT_TOOLS) registry.register(t);
  for (const t of STRATEGY_EXPERT_TOOLS) registry.register(t);
  for (const t of FINANCE_EXPERT_TOOLS) registry.register(t);
  for (const t of ACTION_EXPERT_TOOLS) registry.register(t);
  for (const t of MARKETING_EXPERT_TOOLS) registry.register(t);
  log.info({ total: ACCURACY_TOOLS.length + ORG_EXPERT_TOOLS.length + TECH_EXPERT_TOOLS.length + STRATEGY_EXPERT_TOOLS.length + FINANCE_EXPERT_TOOLS.length + ACTION_EXPERT_TOOLS.length + MARKETING_EXPERT_TOOLS.length }, '全部工具已注册');

  // Pandoc 文档转换工具
  try {
    registerPandocTools(registry);
    log.info('Pandoc 文档转换工具已注册');
  } catch (err: any) {
    log.warn({ err: err.message }, 'Pandoc 文档转换工具注册失败 — 可能未安装 Pandoc');
  }
}
