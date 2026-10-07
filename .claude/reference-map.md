# Reference Map

| 符号 | 文件 | 行 | 内容 |
|------|------|-----|------|

## validateNodeProps
| `validateNodeProps` | D | /novis-backup-20260526/Novis/.synova-wt-980/src/l4/sog-schema-validator.ts | `139:export function validateNodeProps(nodeType: string, props: Record<string, unknown>): ValidationError[] {` |
| `validateNodeProps` | D | /novis-backup-20260526/Novis/.synova-wt-980/src/l4/sog-schema-validator.ts | `169:  const errors = validateNodeProps(nodeType, props);` |

## validateAndLog
| `validateAndLog` | D | /novis-backup-20260526/Novis/.synova-wt-980/src/l4/graph-bridge.ts | `20:import { validateAndLog } from './sog-schema-validator';` |
| `validateAndLog` | D | /novis-backup-20260526/Novis/.synova-wt-980/src/l4/graph-bridge.ts | `82:    validateAndLog(type, props);` |
| `validateAndLog` | D | /novis-backup-20260526/Novis/.synova-wt-980/src/l4/sog-schema-validator.ts | `168:export function validateAndLog(nodeType: string, props: Record<string, unknown>): boolean {` |

## sog-schema-validator
| `sog-schema-validator` | D | /novis-backup-20260526/Novis/.synova-wt-980/src/l4/graph-bridge.ts | `20:import { validateAndLog } from './sog-schema-validator';` |
| `sog-schema-validator` | D | /novis-backup-20260526/Novis/.synova-wt-980/src/l4/sog-schema-validator.ts | `2: * l4/sog-schema-validator.ts — SOG 数据入库 Schema 校验 (v3.3 20.5)` |
| `sog-schema-validator` | D | /novis-backup-20260526/Novis/.synova-wt-980/src/l4/sog-schema-validator.ts | `10:const log = createLogger('l4/sog-schema-validator');` |

## ValidationError
| `ValidationError` | D | /novis-backup-20260526/Novis/.synova-wt-980/src/errors.ts | `16:  ValidationError,` |
| `ValidationError` | D | /novis-backup-20260526/Novis/.synova-wt-980/src/l4/sog-schema-validator.ts | `27:export interface ValidationError {` |
| `ValidationError` | D | /novis-backup-20260526/Novis/.synova-wt-980/src/l4/sog-schema-validator.ts | `102:function validateProp(value: unknown, rule: PropRule, nodeType: string, field: string): ValidationError \| null {` |
| `ValidationError` | D | /novis-backup-20260526/Novis/.synova-wt-980/src/l4/sog-schema-validator.ts | `139:export function validateNodeProps(nodeType: string, props: Record<string, unknown>): ValidationError[] {` |
| `ValidationError` | D | /novis-backup-20260526/Novis/.synova-wt-980/src/l4/sog-schema-validator.ts | `143:  const errors: ValidationError[] = [];` |
| `ValidationError` | D | /novis-backup-20260526/Novis/.synova-wt-980/src/routes/agent-observer.ts | `25:interface ValidationError { valid: false; error: string }` |
| `ValidationError` | D | /novis-backup-20260526/Novis/.synova-wt-980/src/routes/agent-observer.ts | `28:function validateActivity(body: unknown): ValidationError \| ValidationSuccess {` |
| `ValidationError` | D | /novis-backup-20260526/Novis/.synova-wt-980/packages/error-types/src/index.ts | `173:export class ValidationError extends DiagnosticAgentError {` |
| `ValidationError` | D | /novis-backup-20260526/Novis/.synova-wt-980/packages/error-types/src/index.ts | `176:    this.name = 'ValidationError';` |
| `ValidationError` | D | /novis-backup-20260526/Novis/.synova-wt-980/packages/sog-core/src/index.ts | `24:  SOGValidationError,` |
| `ValidationError` | D | /novis-backup-20260526/Novis/.synova-wt-980/packages/sog-core/src/sog-core-schema.ts | `276:export class SOGValidationError extends Error {` |
| `ValidationError` | D | /novis-backup-20260526/Novis/.synova-wt-980/packages/sog-core/src/sog-core-schema.ts | `283:    this.name = 'SOGValidationError';` |
| `ValidationError` | D | /novis-backup-20260526/Novis/.synova-wt-980/packages/sog-core/src/sog-sdk.ts | `5: * 校验失败 → 抛出 SOGValidationError，不吞错。` |
| `ValidationError` | D | /novis-backup-20260526/Novis/.synova-wt-980/packages/sog-core/src/sog-sdk.ts | `10:  validateEdgeEndpoints, SOGValidationError,` |
| `ValidationError` | D | /novis-backup-20260526/Novis/.synova-wt-980/packages/sog-core/src/sog-sdk.ts | `14:export { SOGNodeType, SOGEdgeType, SOG_CORE_VERSION, SOGValidationError };` |
| `ValidationError` | D | /novis-backup-20260526/Novis/.synova-wt-980/packages/sog-core/src/sog-sdk.ts | `23: * @throws {SOGValidationError} 如果类型非法或属性不符合 Schema` |
| `ValidationError` | D | /novis-backup-20260526/Novis/.synova-wt-980/packages/sog-core/src/sog-sdk.ts | `31:    throw new SOGValidationError(`未知节点类型: ${type}`);` |
| `ValidationError` | D | /novis-backup-20260526/Novis/.synova-wt-980/packages/sog-core/src/sog-sdk.ts | `34:    throw new SOGValidationError(`节点 ${type} 属性校验失败: ${JSON.stringify(props).slice(0, 200)}`);` |
| `ValidationError` | D | /novis-backup-20260526/Novis/.synova-wt-980/packages/sog-core/src/sog-sdk.ts | `45: * @throws {SOGValidationError} 如果类型非法、端点组合非法或属性不符合 Schema` |
| `ValidationError` | D | /novis-backup-20260526/Novis/.synova-wt-980/packages/sog-core/src/sog-sdk.ts | `55:    throw new SOGValidationError(`未知边类型: ${type}`);` |
| `ValidationError` | D | /novis-backup-20260526/Novis/.synova-wt-980/packages/sog-core/src/sog-sdk.ts | `58:    throw new SOGValidationError(`非法边端点组合: ${type} ${fromType}→${toType}`);` |
| `ValidationError` | D | /novis-backup-20260526/Novis/.synova-wt-980/packages/sog-core/src/sog-sdk.ts | `61:    throw new SOGValidationError(`边 ${type} 属性校验失败: ${JSON.stringify(props).slice(0, 200)}`);` |
| `ValidationError` | **D** 📋 | /novis-backup-20260526/Novis/.synova-wt-980/tests/error-types.test.ts | `18:  ValidationError,` |
| `ValidationError` | **D** 📋 | /novis-backup-20260526/Novis/.synova-wt-980/tests/error-types.test.ts | `65:  it('Given ValidationError, Then retryable=false', () => {` |
| `ValidationError` | **D** 📋 | /novis-backup-20260526/Novis/.synova-wt-980/tests/error-types.test.ts | `66:    const e = new ValidationError('orgId', '格式无效');` |

## NODE_SCHEMAS
| `NODE_SCHEMAS` | D | /novis-backup-20260526/Novis/.synova-wt-980/src/l4/sog-schema-validator.ts | `36:const NODE_SCHEMAS: Record<string, SchemaRule> = {` |
| `NODE_SCHEMAS` | D | /novis-backup-20260526/Novis/.synova-wt-980/src/l4/sog-schema-validator.ts | `140:  const schema = NODE_SCHEMAS[nodeType];` |

## createGraphBridge
| `createGraphBridge` | D | /novis-backup-20260526/Novis/.synova-wt-980/src/agent/conversation-engine.ts | `32:import type { createGraphBridge } from '../l4/graph-bridge';` |
| `createGraphBridge` | D | /novis-backup-20260526/Novis/.synova-wt-980/src/agent/conversation-engine.ts | `90:  graphBridge?: ReturnType<typeof createGraphBridge>;` |
| `createGraphBridge` | D | /novis-backup-20260526/Novis/.synova-wt-980/src/agent/conversation-engine.ts | `363:  private graphBridge: ReturnType<typeof createGraphBridge> \| null = null;` |
| `createGraphBridge` | D | /novis-backup-20260526/Novis/.synova-wt-980/src/agent/engine-context.ts | `14:import type { createGraphBridge, GraphStore } from '../l4/graph-bridge';` |
| `createGraphBridge` | D | /novis-backup-20260526/Novis/.synova-wt-980/src/agent/engine-context.ts | `39:  graphBridge: ReturnType<typeof createGraphBridge> \| null;` |
| `createGraphBridge` | D | /novis-backup-20260526/Novis/.synova-wt-980/src/agent/post-diagnosis-processor.ts | `108:    graphBridge = bridgeMod.createGraphBridge(graphStore, teamId) as unknown as GraphBridgeLike;` |
| `createGraphBridge` | D | /novis-backup-20260526/Novis/.synova-wt-980/src/l4/graph-bridge.ts | `73:export function createGraphBridge(store: GraphStore, graph: string, onGraphUpdated?: () => void) {` |
| `createGraphBridge` | D | /novis-backup-20260526/Novis/.synova-wt-980/src/l4/index.ts | `4:export { createGraphBridge } from './graph-bridge';` |
| `createGraphBridge` | **D** 📋 | /novis-backup-20260526/Novis/.synova-wt-980/tests/agent/post-diagnosis-processor.test.ts | `14:  createGraphBridge: (store: GraphStoreLike, _teamId: string) => ({` |
| `createGraphBridge` | **D** 📋 | /novis-backup-20260526/Novis/.synova-wt-980/tests/l3/e2e-graphbridge.integration.test.ts | `10:import { createGraphBridge } from '../../src/l4/graph-bridge';` |
| `createGraphBridge` | **D** 📋 | /novis-backup-20260526/Novis/.synova-wt-980/tests/l3/e2e-graphbridge.integration.test.ts | `42:      const bridge = createGraphBridge(fakeStore, 'e2e-org');` |
| `createGraphBridge` | **D** 📋 | /novis-backup-20260526/Novis/.synova-wt-980/tests/l3/graphbridge-wiring.test.ts | `10:import { createGraphBridge } from '../../src/l4/graph-bridge';` |
| `createGraphBridge` | **D** 📋 | /novis-backup-20260526/Novis/.synova-wt-980/tests/l3/graphbridge-wiring.test.ts | `32:    const bridge = createGraphBridge(fakeStore, 'org-1');` |
| `createGraphBridge` | **D** 📋 | /novis-backup-20260526/Novis/.synova-wt-980/tests/l3/graphbridge-wiring.test.ts | `63:    const bridge = createGraphBridge(fakeStore, 'org-1');` |
| `createGraphBridge` | **D** 📋 | /novis-backup-20260526/Novis/.synova-wt-980/tests/l3/graphbridge-wiring.test.ts | `91:    const bridge = createGraphBridge(fakeStore, 'org-1');` |
| `createGraphBridge` | **D** 📋 | /novis-backup-20260526/Novis/.synova-wt-980/tests/l4/graph-bridge.test.ts | `10:import { createGraphBridge, getNodeConflictInfo } from '../../src/l4/graph-bridge';` |
| `createGraphBridge` | **D** 📋 | /novis-backup-20260526/Novis/.synova-wt-980/tests/l4/graph-bridge.test.ts | `79:  let bridge: ReturnType<typeof createGraphBridge>;` |
| `createGraphBridge` | **D** 📋 | /novis-backup-20260526/Novis/.synova-wt-980/tests/l4/graph-bridge.test.ts | `84:    bridge = createGraphBridge(store, orgId);` |
| `createGraphBridge` | **D** 📋 | /novis-backup-20260526/Novis/.synova-wt-980/tests/l4/graph-bridge.test.ts | `200:  let bridge: ReturnType<typeof createGraphBridge>;` |
| `createGraphBridge` | **D** 📋 | /novis-backup-20260526/Novis/.synova-wt-980/tests/l4/graph-bridge.test.ts | `205:    bridge = createGraphBridge(store, orgId);` |
| `createGraphBridge` | **D** 📋 | /novis-backup-20260526/Novis/.synova-wt-980/tests/l4/graph-bridge.test.ts | `278:  let bridge: ReturnType<typeof createGraphBridge>;` |
| `createGraphBridge` | **D** 📋 | /novis-backup-20260526/Novis/.synova-wt-980/tests/l4/graph-bridge.test.ts | `283:    bridge = createGraphBridge(store, orgId);` |
| `createGraphBridge` | **D** 📋 | /novis-backup-20260526/Novis/.synova-wt-980/tests/l4/graph-bridge.test.ts | `340:    // 手动设置冲突状态（D29 冲突检测在 createGraphBridge 包装层，本测试直接测只读查询）` |
| `createGraphBridge` | **D** 📋 | /novis-backup-20260526/Novis/.synova-wt-980/tests/orchestrator/l3-wiring.test.ts | `17:import { createGraphBridge } from '../../src/l4/graph-bridge';` |
| `createGraphBridge` | **D** 📋 | /novis-backup-20260526/Novis/.synova-wt-980/tests/orchestrator/l3-wiring.test.ts | `77:    const bridge = createGraphBridge(fakeStore, 'org-1');` |
| `createGraphBridge` | **D** 📋 | /novis-backup-20260526/Novis/.synova-wt-980/tests/orchestrator/l3-wiring.test.ts | `165:    expect(createGraphBridge).toBeDefined();` |
