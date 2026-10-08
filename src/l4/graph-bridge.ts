/**
 * l4/graph-bridge.ts — 诊断→本体自动蒸馏桥接层 (Phase 1a)
 *
 * 诊断模块输出 → 自动写入 GraphStore。6 个 upsert 方法对应 6 个诊断模块。
 *
 * 接线状态 (C6, 2026-06-04):
 *   ✅ upsertFromKeyPersonRisk — diagnosis-launcher.ts
 *   ✅ upsertFromHONA — diagnosis-launcher.ts
 *   ✅ upsertFromFinancialImpact — diagnosis-launcher.ts
 *   ✅ upsertFromCapabilityGap — diagnosis-launcher.ts
 *   ✅ upsertFromSevenPowers — diagnosis-launcher.ts
 *   ✅ upsertFromCPC — diagnosis-launcher.ts
 *
 * 接口: Synova 自研 GraphStore 接口 (D10 后由自研引擎定义)
 *   createNode(type, props, graph) → returns auto-id
 *   createEdge(type, from, to, weight?, props?, graph?) → returns auto-id
 */
import { NodeType, EdgeType } from '@synova/ontology';
import { createLogger } from '@synova/logger';
import { wrapStandardKeyGuard } from '../adapters/standard-key-guard';
import { validateAndLog } from './sog-schema-validator';
import { deriveValidFrom, deriveValidTo } from '../l3/period-utils';

const log = createLogger('l4/graph-bridge');

// ═══ GraphStore Interface ═══
// D10: engine-core 退役 — 此接口由 Synova 自研引擎定义，不再镜像 engine-core。
// 使用 string 类型参数 (而非枚举) 以保持 synova-agent 独立。
// 结构兼容性由 tests/architecture/graphstore-compatibility.test.ts 验证。

export interface GraphStore {
  createNode(type: string, props: Record<string,unknown>, graph: string): string;
  createNodes(nodes: Array<{type:string, props:Record<string,unknown>}>, graph: string): string[];
  queryNodes(type: string, filters?: Record<string,unknown>, graph?: string): Array<{id:string, type:string, props:Record<string,unknown>}>;
  /** V3.8: 按标签查询节点/边。标签来自 extensions/ontology/tags.json。 */
  queryByTags?(tags: string[], options?: { matchMode?: 'any'|'all'; graph?: string }): Array<{id:string, type:string, props:Record<string,unknown>}>;
  queryEdges(type?: string, from?: string, to?: string, graph?: string): Array<{id:string, type:string, from:string, to:string, weight:number, props:Record<string,unknown>}>;
  createEdge(type: string, from: string, to: string, weight?: number, props?: Record<string,unknown>, graph?: string): string;
  createEdges(edges: Array<{type:string, from:string, to:string, weight?:number, props?:Record<string,unknown>}>, graph: string): string[];
  getNode(id: string, graph: string): unknown | null;
  updateNode(id: string, props: Record<string,unknown>, graph: string): void;
  deleteNode(id: string, graph: string): void;
  deleteEdge(id: string, graph: string): void;
  traverse(startNodeId: string, edgeType?: string, maxDepth?: number, graph?: string): unknown;
  findPaths(from: string, to: string, edgeType?: string, maxDepth?: number, graph?: string): unknown[];
  queryTriples(pattern: Record<string,unknown>, graph?: string): unknown[];
  getNodeAtTime(id: string, timestamp: string, graph: string): unknown | null;
}

// ═══ Types ═══

export interface BridgeResult {
  nodesCreated: number;
  edgesCreated: number;
  degraded: boolean;
  errors: string[];
}

export interface HONAInput { personId: string; name: string; role?: string }
export interface HONAEdge { from: string; to: string; weight?: number }

export interface KeyPersonRiskInput { roleId: string; riskLevel: string; knowledgeDomains: string[]; busFactor: number }

export interface FinancialImpactInput { dimension: string; amount: number; financialType: string; summary?: string }

export interface CapabilityGapInput { name: string; category: string; severity: number; requiredBy: string[]; suggestion?: string }

export interface SevenPowersInput { power: string; score: number; recommendation?: string }

export interface CPCInput { processName: string; teamId: string; efficiency?: number }

// ═══ GraphBridge ═══

export function createGraphBridge(store: GraphStore, graph: string, onGraphUpdated?: () => void) {
  const notify = () => onGraphUpdated?.();

  // v3.3 20.5: SOG schema 校验 — 包装 createNode/updateNode
  // D29: 可选冲突检测 — props.standardKey 触发标准键查询 + data_versions 追加
  // D33: 时间字段 — props.period 触发 valid_from/valid_to/observed_at 自动填充
  const _createNode = store.createNode.bind(store);
  const _updateNode = store.updateNode?.bind(store);
  // #1403：标准键冲突检测 ⇒ **共享守卫**（一处收口；逐字平移，行为不变）
  //   本处只保留 graph-bridge 自有语义：SOG schema 校验（validateAndLog）+ D33 时间字段推导
  const _guarded = wrapStandardKeyGuard({
    createNode: _createNode,
    queryNodes: store.queryNodes.bind(store),
    updateNode: _updateNode,
  });
  store.createNode = (type: string, props: Record<string,unknown>, g: string): string => {
    validateAndLog(type, props);

    // D33: 时间字段推导 — 从 period 映射 valid_from/valid_to
    if (props?.period) {
      const period = String(props.period);
      props.valid_from = deriveValidFrom(period);
      props.valid_to = deriveValidTo(period);
    }
    props.observed_at = props.observed_at || new Date().toISOString();

    return _guarded.createNode(type, props, g);
  };
  if (_updateNode) {
    store.updateNode = (id: string, props: Record<string,unknown>, g: string): void => {
      // updateNode 不传 type — 校验跳过（无法在更新时获取节点类型）
      _updateNode(id, props, g);
    };
  }

  return {
    upsertFromHONA(people: HONAInput[], interactions: HONAEdge[]): BridgeResult {
      const result: BridgeResult = { nodesCreated: 0, edgesCreated: 0, degraded: false, errors: [] };
      if (people.length === 0) return result;

      try {
        // Batch create Person nodes
        const nodeIds = store.createNodes(
          people.map(p => ({ type: NodeType.RESOURCE_PERSON, props: { name: p.name, role: p.role || 'unknown' } })),
          graph,
        );
        result.nodesCreated = nodeIds.length;

        // Create INTERACTS_WITH edges
        for (const ia of interactions) {
          try {
            store.createEdge(EdgeType.INFORMATION_FLOW, ia.from, ia.to, ia.weight || 0.5, {}, graph);
            result.edgesCreated++;
          } catch (err: any) {
            log.warn({ err: err instanceof Error ? err.message : String(err) }, "Create INTERACTS_WITH edges");
            result.errors.push(`HONA edge failed: ${err.message}`);
          }
        }
      } catch (err: any) {
        result.degraded = true;
        result.errors.push(`upsertFromHONA: ${err.message}`);
        log.warn({ err }, 'upsertFromHONA 失败');
      }
      return result;
    },

    upsertFromKeyPersonRisk(profiles: KeyPersonRiskInput[]): BridgeResult {
      const result: BridgeResult = { nodesCreated: 0, edgesCreated: 0, degraded: false, errors: [] };
      if (profiles.length === 0) return result;

      try {
        for (const p of profiles) {
          const riskNodeId = store.createNode(NodeType.OUTCOME_RISK, {
            name: `关键人风险: ${p.roleId}`,
            severity: p.riskLevel,
            riskType: 'key_person',
            busFactor: p.busFactor,
            knowledgeDomains: p.knowledgeDomains,
          }, graph);
          result.nodesCreated++;

          // AFFECTS edges to Person nodes matching roleId
          const persons = store.queryNodes(NodeType.RESOURCE_PERSON, { name: p.roleId }, graph);
          for (const person of persons) {
            store.createEdge(EdgeType.TALENT_DEPLOYMENT, riskNodeId, person.id, 0.8, {}, graph);
            result.edgesCreated++;
          }
        }
      } catch (err: any) {
        result.degraded = true;
        result.errors.push(`upsertFromKeyPersonRisk: ${err.message}`);
        log.warn({ err }, 'upsertFromKeyPersonRisk 失败');
      }
      if (result.nodesCreated > 0) notify(); // T3.2: SOG更新→触发专家
      return result;
    },

    upsertFromFinancialImpact(items: FinancialImpactInput[]): BridgeResult {
      const result: BridgeResult = { nodesCreated: 0, edgesCreated: 0, degraded: false, errors: [] };
      if (items.length === 0) return result;

      try {
        for (const item of items) {
          store.createNode(NodeType.OUTCOME_FINANCIAL /* ONTOLOGY-MIGRATION: NodeType.OUTCOME_FINANCIAL -> outcome/financial or resource/money? Context-dependent. */, {
            name: item.dimension,
            amount: item.amount,
            financialType: item.financialType,
            description: item.summary || '',
          }, graph);
          result.nodesCreated++;
        }
      } catch (err: any) {
        result.degraded = true;
        result.errors.push(`upsertFromFinancialImpact: ${err.message}`);
      }
      return result;
    },

    upsertFromCapabilityGap(gaps: CapabilityGapInput[]): BridgeResult {
      const result: BridgeResult = { nodesCreated: 0, edgesCreated: 0, degraded: false, errors: [] };
      if (gaps.length === 0) return result;

      try {
        for (const gap of gaps) {
          store.createNode(NodeType.RESOURCE_KNOWLEDGE /* ONTOLOGY-MIGRATION: NodeType.RESOURCE_KNOWLEDGE has no direct match. Using resource/knowledge. */, {
            name: gap.name,
            category: gap.category,
            proficiencyLevel: 1 - gap.severity,
            status: 'required',
            description: gap.suggestion || '',
          }, graph);
          result.nodesCreated++;
        }
      } catch (err: any) {
        result.degraded = true;
        result.errors.push(`upsertFromCapabilityGap: ${err.message}`);
      }
      return result;
    },

    upsertFromSevenPowers(powers: SevenPowersInput[]): BridgeResult {
      const result: BridgeResult = { nodesCreated: 0, edgesCreated: 0, degraded: false, errors: [] };
      if (powers.length === 0) return result;

      try {
        for (const p of powers) {
          store.createNode(NodeType.ACTIVITY_GOVERNANCE /* ONTOLOGY-MIGRATION: NodeType.ACTIVITY_GOVERNANCE has no direct match. Using activity/governance (strategic alignment). */, {
            name: p.power,
            goalType: 'north_star',
            description: p.recommendation || '',
            progress: p.score,
          }, graph);
          result.nodesCreated++;
        }
      } catch (err: any) {
        result.degraded = true;
        result.errors.push(`upsertFromSevenPowers: ${err.message}`);
      }
      return result;
    },

    upsertFromCPC(processes: CPCInput[]): BridgeResult {
      const result: BridgeResult = { nodesCreated: 0, edgesCreated: 0, degraded: false, errors: [] };
      if (processes.length === 0) return result;

      try {
        for (const proc of processes) {
          const nodeId = store.createNode(NodeType.ACTIVITY_PRODUCTION /* ONTOLOGY-MIGRATION: NodeType.ACTIVITY_PRODUCTION is approximate. Check processType and map to correct activity type. */, {
            name: proc.processName,
            processType: 'workflow',
          }, graph);
          result.nodesCreated++;

          // BELONGS_TO edge to team
          const teams = store.queryNodes(NodeType.RESOURCE_TEAM, { name: proc.teamId }, graph);
          for (const team of teams) {
            store.createEdge(EdgeType.TALENT_DEPLOYMENT, nodeId, team.id, 1, {}, graph);
            result.edgesCreated++;
          }
        }
      } catch (err: any) {
        result.degraded = true;
        result.errors.push(`upsertFromCPC: ${err.message}`);
      }
      return result;
    },
  };
}

// ═══ D37: 数据冲突只读查询 ═══

export interface NodeConflictInfo {
  hasConflict: boolean;
  versions: Array<Record<string, unknown>>;
  currentVersion: Record<string, unknown>;
}

/**
 * 查询节点数据冲突信息（只读，不修改数据）。
 * D29 在 createNode 时写入 has_conflict/data_versions，本函数暴露给 L3 层。
 *
 * @param nodeId - 节点 ID
 * @param g - GraphStore 实例
 * @param graph - 图名称（多租户）
 * @returns {NodeConflictInfo} 冲突状态、版本列表、当前版本摘要
 */
export function getNodeConflictInfo(nodeId: string, g: GraphStore, graph: string): NodeConflictInfo {
  const node = g.getNode(nodeId, graph);
  if (!node) return { hasConflict: false, versions: [], currentVersion: {} };
  const record = node as Record<string, unknown>;
  const props = (record.props || {}) as Record<string, unknown>;
  const versions = Array.isArray(props.data_versions)
    ? props.data_versions as Array<Record<string, unknown>>
    : [];
  const current: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (k !== 'data_versions' && k !== 'has_conflict') current[k] = v;
  }
  return { hasConflict: props.has_conflict === true, versions, currentVersion: current };
}
