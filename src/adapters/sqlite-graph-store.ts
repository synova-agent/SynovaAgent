/**
 * src/adapters/sqlite-graph-store.ts — SQLite → GraphStore 适配器 (D224 → D286 统一)
 *
 * D286: 统一 GraphStore 双轨。取代旧 graph-store 包（tsconfig paths 映射的 synova/graph-store 别名）。
 * 表结构对齐旧包（graph_nodes + graph_triples，与 engine-core graph-store 兼容）：
 *   - graph 默认 'default'（对齐旧包；UserStore 显式传 'enterprise' 不受影响）
 *   - 软删除（valid_from/valid_to 时间线），deleteNode/deleteEdge 置 valid_to 而非物理删除
 *   - 构造时启用 WAL（不可用时降级 DELETE 模式）
 *
 * 契约:
 *   @input  — better-sqlite3 Database 实例
 *   @output — GraphStore 接口 { createNode, createEdge, queryNodes, queryEdges,
 *              queryTriples, getNode, updateNode, deleteNode, deleteEdge }
 *   @degraded — SQL 错误 → log.error + 返回空/抛出（D355: 查询层 fail-open 升级，
 *               schema 漂移 "no such column" 单独识别并提示运行迁移）
 */
import type Database from "better-sqlite3";
import { createLogger } from "@synova/logger";
import { reconcileSchema } from "../store/schema-migration";
import { wrapStandardKeyGuard } from "./standard-key-guard";   // #1412 (C)：默认守卫（复用，不造第二套）

const log = createLogger("adapters/sqlite-graph-store");

/** 图节点/边表结构（对齐旧包 graph-store + engine-core graph-store） */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS graph_nodes (
  id TEXT PRIMARY KEY,
  graph TEXT NOT NULL DEFAULT 'default',
  type TEXT NOT NULL,
  name TEXT,
  props TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  valid_from TEXT NOT NULL DEFAULT (datetime('now')),
  valid_to TEXT
);
CREATE INDEX IF NOT EXISTS idx_gn_type ON graph_nodes(graph, type);
CREATE INDEX IF NOT EXISTS idx_gn_name ON graph_nodes(graph, name);
CREATE INDEX IF NOT EXISTS idx_gn_valid ON graph_nodes(graph, valid_to);
CREATE TABLE IF NOT EXISTS graph_triples (
  id TEXT PRIMARY KEY,
  graph TEXT NOT NULL DEFAULT 'default',
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  props TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  valid_from TEXT NOT NULL DEFAULT (datetime('now')),
  valid_to TEXT
);
CREATE INDEX IF NOT EXISTS idx_gt_subject ON graph_triples(graph, subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_gt_object ON graph_triples(graph, object_type, object_id);
CREATE INDEX IF NOT EXISTS idx_gt_predicate ON graph_triples(graph, predicate);
CREATE INDEX IF NOT EXISTS idx_gt_weight ON graph_triples(graph, predicate, weight);
CREATE INDEX IF NOT EXISTS idx_gt_valid ON graph_triples(graph, valid_from, valid_to);
`;

/** UUID v4 生成（零外部依赖） */
function uuid(): string {
  const hex = "0123456789abcdef";
  let id = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      id += "-";
    } else if (i === 14) {
      id += "4";
    } else if (i === 19) {
      id += hex[(Math.random() * 16) | 0];
    } else {
      id += hex[(Math.random() * 16) | 0];
    }
  }
  return id;
}

/** 节点查询结果行 */
interface GraphNodeRow {
  id: string;
  type: string;
  props: string;
}

/** 边查询结果行 */
interface GraphEdgeRow {
  id: string;
  predicate: string;
  subject_id: string;
  object_id: string;
  weight: number;
  props: string;
}

/**
 * SqliteGraphStore — 将 SQLite 数据库包装为 GraphStore 接口。
 *
 * 创建节点 → INSERT INTO graph_nodes
 * 查询节点 → SELECT FROM graph_nodes WHERE graph=? AND type=? AND valid_to IS NULL
 * 创建边   → INSERT INTO graph_triples（subject/object 类型从节点推断）
 * 查询边   → SELECT FROM graph_triples WHERE graph=? [AND predicate=? ...] AND valid_to IS NULL
 * 删除     → 软删除：UPDATE SET valid_to = datetime('now')
 */
export interface SqliteGraphStoreOptions {
  /**
   * **标准键写入守卫**（#1412 (C)）：**默认 true** —— 同 `props.standardKey` 先查后写（不重复插入）。
   * 🔴 设为关闭（`false`）的唯一合法场景 = **测试需要"裸语义"**；审计口径：**生产路径必须零 opt-out**（判据见 tests/adapters/standard-key-guard.test.ts 的 V4-new）。
   */
  standardKeyGuard?: boolean;
}

export class SqliteGraphStore {
  private db: Database.Database;
  /** #1412 (C)：默认守卫（**默认行为**，不依赖"枚举构造点"） */
  private standardKeyGuardEnabled: boolean;
  private guardedCreateNode!: (type: string, props: Record<string, unknown>, graph: string) => string;

  constructor(db: Database.Database, options?: SqliteGraphStoreOptions) {
    this.db = db;
    this.standardKeyGuardEnabled = options?.standardKeyGuard !== false;
    this.enableWAL();
    this.initSchema();
    // D355: schema 版本化迁移（幂等）。fail-closed: 不 catch — 迁移失败必须阻止启动
    //（框架契约），修复 K3 P0-3 旧库 props_json 无 props 列的 schema 漂移。
    reconcileSchema(this.db);
  }

  /** 启用 WAL 模式；网络文件系统不可用时降级 DELETE（对齐旧包行为） */
  private enableWAL(): void {
    try {
      const result = this.db.pragma("journal_mode = WAL", { simple: true });
      if (result !== "wal") {
        this.db.pragma("journal_mode = DELETE", { simple: true });
        log.warn({ pragmaResult: result }, "WAL 不可用 — 降级到 DELETE 模式");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg }, "WAL 启用失败 — 使用 SQLite 默认日志模式");
    }
  }

  private initSchema(): void {
    try {
      this.db.exec(SCHEMA_SQL);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg }, "图存储表初始化失败");
    }
  }

  /** 创建节点，返回节点 ID */
  createNode(
    type: string,
    props: Record<string, unknown>,
    graph: string = "default",
  ): string {
    // #1412 (C)：**默认带守卫**（复用共享守卫 ⇒ 无第二套逻辑；只有显式 opt-out 才走裸写）
    if (this.standardKeyGuardEnabled) {
      if (!this.guardedCreateNode) {
        this.guardedCreateNode = wrapStandardKeyGuard({
          createNode: (t, p, g) => this._insertNodeRaw(t, p, g),
          queryNodes: (t, f, g) => this.queryNodes(t, f, g),
          updateNode: (id, p, g) => this.updateNode(id, p, g),
        }).createNode;
      }
      return this.guardedCreateNode(type, props, graph);
    }
    return this._insertNodeRaw(type, props, graph);
  }

  /** 裸写入（无守卫）—— 仅供 opt-out 与守卫内部使用 */
  private _insertNodeRaw(
    type: string,
    props: Record<string, unknown>,
    graph: string = "default",
  ): string {
    const id = `node-${uuid()}`;
    const name = (props.name as string) || (props.label as string) || type;
    try {
      this.db
        .prepare(
          "INSERT INTO graph_nodes (id, graph, type, name, props) VALUES (?, ?, ?, ?, ?)",
        )
        .run(id, graph, type, name, JSON.stringify(props));
      return id;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg, type, graph }, "创建图节点失败");
      throw err;
    }
  }

  /** 创建边，返回边 ID（subject/object 类型从节点推断，节点不存在则 'unknown'） */
  createEdge(
    type: string,
    from: string,
    to: string,
    weight?: number,
    props?: Record<string, unknown>,
    graph: string = "default",
  ): string {
    const id = `edge-${uuid()}`;
    try {
      const fromNode = this.getNode(from, graph);
      const toNode = this.getNode(to, graph);
      const subjectType = fromNode?.type || "unknown";
      const objectType = toNode?.type || "unknown";
      this.db
        .prepare(
          `INSERT INTO graph_triples
             (id, graph, subject_type, subject_id, predicate, object_type, object_id, weight, props)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, graph, subjectType, from, type, objectType, to, weight ?? 1.0, JSON.stringify(props || {}));
      return id;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg, type, from, to }, "创建图边失败");
      throw err;
    }
  }

  /** 查询节点，支持按 JSON 属性和图过滤（仅返回未删除节点） */
  queryNodes(
    type: string,
    filters?: Record<string, unknown>,
    graph?: string,
  ): Array<{ id: string; type: string; props: Record<string, unknown> }> {
    try {
      const g = graph || "default";
      let sql = "SELECT id, type, props FROM graph_nodes WHERE graph = ? AND type = ? AND valid_to IS NULL";
      const params: unknown[] = [g, type];

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          if (value !== undefined && value !== null) {
            sql += ` AND json_extract(props, '$.${key}') = ?`;
            params.push(String(value));
          }
        }
      }

      const rows = this.db.prepare(sql).all(...params) as GraphNodeRow[];
      return rows.map((row) => ({
        id: row.id,
        type: row.type,
        props: JSON.parse(row.props || "{}") as Record<string, unknown>,
      }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // D355 (K3 P0-3): 静默 fail-open 升级 — 失效在日志层可见（不再 log.warn）
      if (msg.includes("no such column")) {
        // schema 漂移 → 升级 error，提示运行迁移
        log.error({ err: msg, type }, "图节点 schema 漂移——props 列缺失，需运行迁移");
        return [];
      }
      log.error({ err: msg, type }, "查询图节点失败");
      return [];
    }
  }

  /** 查询边，支持按类型/起点/终点/图过滤（仅返回未删除边） */
  queryEdges(
    type?: string,
    from?: string,
    to?: string,
    graph?: string,
  ): Array<{ id: string; type: string; from: string; to: string; weight: number; props: Record<string, unknown> }> {
    try {
      const g = graph || "default";
      const conditions: string[] = ["graph = ?", "valid_to IS NULL"];
      const params: unknown[] = [g];

      if (type) { conditions.push("predicate = ?"); params.push(type); }
      if (from) { conditions.push("subject_id = ?"); params.push(from); }
      if (to) { conditions.push("object_id = ?"); params.push(to); }

      const sql = `SELECT id, predicate, subject_id, object_id, weight, props FROM graph_triples WHERE ${conditions.join(" AND ")}`;
      const rows = this.db.prepare(sql).all(...params) as GraphEdgeRow[];
      return rows.map((row) => ({
        id: row.id,
        type: row.predicate,
        from: row.subject_id,
        to: row.object_id,
        weight: row.weight,
        props: JSON.parse(row.props || "{}") as Record<string, unknown>,
      }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg }, "查询图边失败");
      return [];
    }
  }

  /** 按属性模式查询三元组（原样返回行） */
  queryTriples(
    pattern: Record<string, unknown>,
    graph?: string,
  ): Array<Record<string, unknown>> {
    try {
      const g = graph || "default";
      const conditions: string[] = ["graph = ?", "valid_to IS NULL"];
      const params: unknown[] = [g];

      const fieldMap: Record<string, string> = {
        subject_type: "subject_type", subjectId: "subject_id", subject_id: "subject_id",
        predicate: "predicate",
        object_type: "object_type", objectId: "object_id", object_id: "object_id",
      };

      for (const [key, col] of Object.entries(fieldMap)) {
        if (pattern[key] !== undefined && pattern[key] !== null) {
          conditions.push(`${col} = ?`);
          params.push(String(pattern[key]));
        }
      }

      const sql = `SELECT * FROM graph_triples WHERE ${conditions.join(" AND ")}`;
      return this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg }, "查询图三元组失败");
      return [];
    }
  }

  /** 获取单个节点（仅未删除） */
  getNode(
    id: string,
    graph: string = "default",
  ): { id: string; type: string; props: Record<string, unknown> } | null {
    try {
      const row = this.db
        .prepare("SELECT id, type, props FROM graph_nodes WHERE id = ? AND graph = ? AND valid_to IS NULL")
        .get(id, graph) as GraphNodeRow | undefined;

      if (!row) return null;
      return {
        id: row.id,
        type: row.type,
        props: JSON.parse(row.props || "{}") as Record<string, unknown>,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg, id }, "获取图节点失败");
      return null;
    }
  }

  /** 更新节点属性（与现有 props 合并） */
  updateNode(
    id: string,
    props: Record<string, unknown>,
    graph: string = "default",
  ): void {
    try {
      const existing = this.getNode(id, graph);
      const merged = { ...(existing?.props || {}), ...props };
      this.db
        .prepare("UPDATE graph_nodes SET props = ? WHERE id = ? AND graph = ?")
        .run(JSON.stringify(merged), id, graph);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg, id }, "更新图节点失败");
      throw err;
    }
  }

  /** 删除节点（软删除：置 valid_to，查询不再可见） */
  deleteNode(id: string, graph: string = "default"): void {
    try {
      this.db
        .prepare("UPDATE graph_nodes SET valid_to = datetime('now') WHERE id = ? AND graph = ?")
        .run(id, graph);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg, id }, "删除图节点失败");
      throw err;
    }
  }

  /** 删除边（软删除：置 valid_to，查询不再可见） */
  deleteEdge(id: string, graph: string = "default"): void {
    try {
      this.db
        .prepare("UPDATE graph_triples SET valid_to = datetime('now') WHERE id = ? AND graph = ?")
        .run(id, graph);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg, id }, "删除图边失败");
      throw err;
    }
  }
}
