/**
 * ingest/knowledge-ingest-bridge.ts — 知识摄取管线
 *
 * Day 4 T4.4: PDF/DOCX/Excel 上传 → 自动解析 → SOG本体构建。
 * 诊断基于事实而非记忆。
 */
import { createLogger } from '@synova/logger';
import type { GraphStore } from '../l4/graph-bridge';

const log = createLogger('ingest/knowledge-bridge');

export interface IngestResult {
  nodesCreated: number;
  edgesCreated: number;
  errors: string[];
}

/**
 * #667: 边写入前断言 target 存在。
 * 不存在 ⇒ 抛错（调用方转 errors[] + log.error），不静默（铁律 11/24）。
 */
function assertNodeExists(store: GraphStore, nodeId: string, graph: string): void {
  const node = store.getNode(nodeId, graph);
  if (node === null || node === undefined) {
    throw new Error(`MENTIONS edge target not found: ${nodeId}`);
  }
}

/**
 * #667: 建一条 MENTIONS 边；target 必须是真实节点（不再用 `doc_${fileName}`）。
 * @input  store — GraphStore（getNode/queryEdges/createEdge）
 * @input  personId/documentId — 必须已存在；documentId 不存在 ⇒ 抛错
 * @output true=新建；false=边已存在（幂等，不重复写）
 * @degraded — 不吞错：target 缺失/写入失败由调用方转 errors[] + log.error
 * @authority — 只写 MENTIONS 边；不建节点、不改节点
 */
export function createMentionsEdge(
  store: GraphStore, personId: string, documentId: string, orgId: string,
): boolean {
  assertNodeExists(store, documentId, orgId);
  const existing = store.queryEdges('MENTIONS', personId, documentId, orgId);
  if (existing.length > 0) {
    log.debug({ personId, documentId }, 'MENTIONS 边已存在 — 幂等跳过');
    return false;
  }
  store.createEdge('MENTIONS', personId, documentId, 0.5, {}, orgId);
  return true;
}

/**
 * Ingest raw text content into SOG ontology.
 * Extracts entities (Person, Team) and relationships from document content.
 *
 * Simple heuristic extraction: quoted names → Person, department keywords → Team.
 * Full NLP pipeline (sentence-transformers) comes in Phase B via Python bridge.
 */
export async function ingestDocumentText(
  text: string, fileName: string, orgId: string, store: GraphStore,
): Promise<IngestResult> {
  const result: IngestResult = { nodesCreated: 0, edgesCreated: 0, errors: [] };

  try {
    // Heuristic: quoted names → Person nodes
    const namePattern = /[""""]([^""""]{1,20})[""""]/g;
    let match: RegExpExecArray | null;
    const personIds: string[] = [];
    while ((match = namePattern.exec(text)) !== null) {
      const nodeId = store.createNode('Person', {
        name: match[1], source: 'document', sourceFile: fileName,
      }, orgId);
      personIds.push(nodeId);
      result.nodesCreated++;
    }

    // Heuristic: department keywords → Team nodes
    const deptPattern = /(部门|团队|组|中心|事业部)[：:\s]*([一-鿿a-zA-Z0-9]+)/g;
    const teamIds: string[] = [];
    while ((match = deptPattern.exec(text)) !== null) {
      const nodeId = store.createNode('Team', {
        name: `${match[1]}${match[2]}`, source: 'document', sourceFile: fileName,
      }, orgId);
      teamIds.push(nodeId);
      result.nodesCreated++;
    }

    // Create document node（#667: 接住返回 id；MENTIONS 边 target 用它）
    const documentId = store.createNode('Document', {
      name: fileName, content: text.slice(0, 5000), source: 'upload',
    }, orgId);
    result.nodesCreated++;

    // Link persons to document（#667: target = 真实 Document id；缺失/失败不静默）
    for (const pid of personIds) {
      try {
        if (createMentionsEdge(store, pid, documentId, orgId)) result.edgesCreated++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`MENTIONS_EDGE_FAILED: ${msg}`);
        log.error({ err: msg, fileName, personId: pid, documentId }, 'MENTIONS 边写入失败（不静默）');
      }
    }

    log.info({ fileName, nodes: result.nodesCreated, edges: result.edgesCreated }, '文档知识摄取完成');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(msg);
    log.warn({ err: msg, fileName }, '文档知识摄取失败');
  }

  return result;
}
