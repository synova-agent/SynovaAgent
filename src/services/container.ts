/**
 * services/container.ts — 依赖注入容器 (P2 单例 DI 深化)
 *
 * server.ts 集中创建所有服务实例，存储在此容器中。
 * Routes 通过 req.app.locals.container 获取，不再调用 getXxx()。
 *
 * 原则: server.ts 是唯一的组合根 (composition root)。
 *       所有服务生命周期由 server.ts 管理，不在模块内部隐藏创建。
 */

import type { EventBus } from '../orchestrator/event-bus';
import type { HookRunner } from '../orchestrator/hook-runner';
import type { SessionManager } from '../orchestrator/session-manager';
import type { PhaseStateMachine } from '../orchestrator/phase-state-machine';
import type { ToolRegistry } from '../agent/tools';
import type { PIIScrubber } from '../security/pii-scrubber';
import type { CredentialVault } from '../security/credential-vault';
import type { CredentialPool } from '../security/credential-vault';
import type { FileGuard } from '../security/file-guard';
import type { FederalAdapter } from '../adapters/federal-adapter';
import type { AlertRuleEngine } from '../l5/alert-rules';
import type { IMRegistry } from '../l1/im-channel';
import type { LLMCache } from './llm-cache';
import type { ProposalManager } from '../l2/proposal-manager';
import type { ExpertRegistry } from '../l3/expert-registry';
import type { BriefingGenerator } from '../l3/briefing-generator';
import type { ReportTemplateRegistry } from '../l3/report-templates';
import type { FaultRecovery } from './fault-recovery';
import type { MCPBridge } from '../mcp/bridge';
import type { Database } from 'better-sqlite3';
import type { EnterpriseScanService } from '../agent/enterprise-scan-service';

/**
 * 应用级服务容器。
 * server.ts 启动时填充，Routes 通过 req.app.locals.container 访问。
 */
export interface ServiceContainer {
  // 数据库
  db: Database;

  // 编排层 (L2)
  eventBus: EventBus;
  hookRunner: HookRunner;
  sessionManager: SessionManager;
  stateMachine: PhaseStateMachine;

  // 安全
  piiScrubber: PIIScrubber;
  credentialVault?: CredentialVault;
  credentialPool?: CredentialPool;
  fileGuard?: FileGuard;

  // 联邦进化
  federalAdapter: FederalAdapter;

  // ⓪ 首次企业扫描（L2 编排，由 Bootstrap 装配）
  enterpriseScanService?: EnterpriseScanService;

  // L3 洞察
  alertRules?: AlertRuleEngine;
  expertRegistry: ExpertRegistry;
  proposalManager: ProposalManager;
  briefingGenerator?: BriefingGenerator;
  reportTemplates: ReportTemplateRegistry;

  // L5
  imRegistry?: IMRegistry;
  connectorToolRegistry?: ToolRegistry;
  mcpToolRegistry?: ToolRegistry;

  // 基础设施
  llmCache: LLMCache;
  faultRecovery: FaultRecovery;
  mcpBridge: MCPBridge;
}

/**
 * Express 类型扩展 — 让 TypeScript 认识 app.locals.container
 */
declare global {
  namespace Express {
    interface Locals {
      container: ServiceContainer;
    }
  }
}
