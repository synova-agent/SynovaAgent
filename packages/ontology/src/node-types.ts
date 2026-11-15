/**
 * @synova/ontology — Node Type Constants
 *
 * Node type string constants derived from extensions/ontology/ JSON Schema.
 * Replaces old SOGNodeType enum. DO NOT add backward-compatible aliases.
 *
 * Source of truth: extensions/ontology/ (activity/, outcome/, resource/)
 *
 * @module @synova/ontology/node-types
 */

// ─── Activity Types ───
export const NodeType = {
  ACTIVITY_PRODUCTION: 'activity/production',
  ACTIVITY_ACQUISITION: 'activity/acquisition',
  ACTIVITY_INNOVATION: 'activity/innovation',
  ACTIVITY_COORDINATION: 'activity/coordination',
  ACTIVITY_LEARNING: 'activity/learning',
  ACTIVITY_GOVERNANCE: 'activity/governance',
  ACTIVITY_MAINTENANCE: 'activity/maintenance',
  ACTIVITY_COMPLIANCE: 'activity/compliance',
  ACTIVITY_DELIVERY_BATCH: 'activity/delivery_batch',

  // ─── Outcome Types ───
  OUTCOME_FINANCIAL: 'outcome/financial',
  OUTCOME_MARKET: 'outcome/market',
  OUTCOME_OPERATIONAL: 'outcome/operational',
  OUTCOME_PEOPLE: 'outcome/people',
  OUTCOME_INNOVATION: 'outcome/innovation',
  OUTCOME_RISK: 'outcome/risk',
  OUTCOME_COMPETITIVE: 'outcome/competitive',
  OUTCOME_EXTERNAL: 'outcome/external',
  OUTCOME_DELIVERY_RESULT: 'outcome/delivery_result',

  // ─── Resource Types ───
  RESOURCE_MONEY: 'resource/money',
  RESOURCE_PERSON: 'resource/person',
  RESOURCE_TEAM: 'resource/team',
  RESOURCE_AGENT: 'resource/agent',
  RESOURCE_TOOL: 'resource/tool',
  RESOURCE_KNOWLEDGE: 'resource/knowledge',
  RESOURCE_CLIENT: 'resource/client',
  RESOURCE_BRAND: 'resource/brand',
  RESOURCE_DATA: 'resource/data',
  RESOURCE_IP: 'resource/ip',
  RESOURCE_LOCATION: 'resource/location',
  RESOURCE_CHANNEL: 'resource/channel',
  RESOURCE_SUPPLIER: 'resource/supplier',
  RESOURCE_DELIVERY_TEAM: 'resource/delivery_team',

  // ─── Pool Types: 存量池(9) — 15概念节点池体系 §一 ───
  POOL_CAPITAL: 'pool/capital',
  POOL_HUMAN_CAPITAL: 'pool/human_capital',
  POOL_EQUIPMENT_CAPACITY: 'pool/equipment_capacity',
  POOL_KNOWLEDGE: 'pool/knowledge',
  POOL_BRAND: 'pool/brand',
  POOL_REPUTATION: 'pool/reputation',
  POOL_DATA: 'pool/data',
  POOL_REVENUE: 'pool/revenue',
  POOL_SENSING: 'pool/sensing',

  // ─── Pool Types: 活动池(6) — 统一引用为 pool/activity ───
  POOL_ACTIVITY_PRODUCTION: 'pool/activity',
  POOL_ACTIVITY_ACQUISITION: 'pool/activity',
  POOL_ACTIVITY_INNOVATION: 'pool/activity',
  POOL_ACTIVITY_GOVERNANCE: 'pool/activity',
  POOL_ACTIVITY_LEARNING: 'pool/activity',
  POOL_ACTIVITY_MAINTENANCE: 'pool/activity',

  // ─── External Types (1) ───
  EXTERNAL_BASELINE: 'external/baseline',
} as const;

/** Union type of canonical node type string values */
export type NodeType = typeof NodeType[keyof typeof NodeType];

// ─── Category helpers ───
export const ACTIVITY_TYPES: readonly NodeType[] = [
  NodeType.ACTIVITY_PRODUCTION,
  NodeType.ACTIVITY_ACQUISITION,
  NodeType.ACTIVITY_INNOVATION,
  NodeType.ACTIVITY_COORDINATION,
  NodeType.ACTIVITY_LEARNING,
  NodeType.ACTIVITY_GOVERNANCE,
  NodeType.ACTIVITY_MAINTENANCE,
  NodeType.ACTIVITY_COMPLIANCE,
  NodeType.ACTIVITY_DELIVERY_BATCH,
] as const;

export const OUTCOME_TYPES: readonly NodeType[] = [
  NodeType.OUTCOME_FINANCIAL,
  NodeType.OUTCOME_MARKET,
  NodeType.OUTCOME_OPERATIONAL,
  NodeType.OUTCOME_PEOPLE,
  NodeType.OUTCOME_INNOVATION,
  NodeType.OUTCOME_RISK,
  NodeType.OUTCOME_COMPETITIVE,
  NodeType.OUTCOME_EXTERNAL,
  NodeType.OUTCOME_DELIVERY_RESULT,
] as const;

export const RESOURCE_TYPES: readonly NodeType[] = [
  NodeType.RESOURCE_MONEY,
  NodeType.RESOURCE_PERSON,
  NodeType.RESOURCE_TEAM,
  NodeType.RESOURCE_AGENT,
  NodeType.RESOURCE_TOOL,
  NodeType.RESOURCE_KNOWLEDGE,
  NodeType.RESOURCE_CLIENT,
  NodeType.RESOURCE_BRAND,
  NodeType.RESOURCE_DATA,
  NodeType.RESOURCE_IP,
  NodeType.RESOURCE_LOCATION,
  NodeType.RESOURCE_CHANNEL,
  NodeType.RESOURCE_SUPPLIER,
  NodeType.RESOURCE_DELIVERY_TEAM,
] as const;

// ─── Pool category arrays ───
export const POOL_TYPES: readonly NodeType[] = [
  NodeType.POOL_CAPITAL,
  NodeType.POOL_HUMAN_CAPITAL,
  NodeType.POOL_EQUIPMENT_CAPACITY,
  NodeType.POOL_KNOWLEDGE,
  NodeType.POOL_BRAND,
  NodeType.POOL_REPUTATION,
  NodeType.POOL_DATA,
  NodeType.POOL_REVENUE,
  NodeType.POOL_SENSING,
  NodeType.POOL_ACTIVITY_PRODUCTION,
  NodeType.POOL_ACTIVITY_ACQUISITION,
  NodeType.POOL_ACTIVITY_INNOVATION,
  NodeType.POOL_ACTIVITY_GOVERNANCE,
  NodeType.POOL_ACTIVITY_LEARNING,
  NodeType.POOL_ACTIVITY_MAINTENANCE,
] as const;

export const EXTERNAL_TYPES: readonly NodeType[] = [
  NodeType.EXTERNAL_BASELINE,
] as const;

/** All canonical node types in a flat array */
export const ALL_NODE_TYPES: readonly NodeType[] = [
  ...ACTIVITY_TYPES,
  ...OUTCOME_TYPES,
  ...RESOURCE_TYPES,
  ...POOL_TYPES,
  ...EXTERNAL_TYPES,
] as const;
