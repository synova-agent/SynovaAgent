/**
 * done5-read-real-db.cjs — #237 (K4-04) Done⑤ 读数（CTO 2026-10-11 指定口径）
 *
 * 本机无 `sqlite3` CLI（实测 `Get-Command sqlite3` → NOT_FOUND）⇒ 用 node + better-sqlite3
 * **只读**（`readonly: true`）读真机库：
 *   `D:\novis-backup-20260526\Novis\synova-agent\data\synova.db`（旧树真机库；🔴 只读，禁写、禁拷）
 *
 * 判据（Done⑤）：`PRAGMA table_info(graph_triples)` 须见 `props_json` 在、`props` 不在。
 * 用法：`node done5-read-real-db.cjs <db-path>`
 */
const Database = require("better-sqlite3");

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("usage: node done5-read-real-db.cjs <db-path>");
  process.exit(2);
}

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
try {
  const cols = db
    .pragma("table_info(graph_triples)")
    .map((c) => ({ name: c.name, type: c.type, pk: c.pk }));

  console.log("[db]", dbPath);
  console.log("[readonly]", true);
  console.log("[count]", cols.length);
  console.log("[cols]", cols.map((c) => `${c.name}:${c.type}${c.pk ? "(pk)" : ""}`).join(", "));
  console.log("[has_props_json]", cols.some((c) => c.name === "props_json"));
  console.log("[has_props]", cols.some((c) => c.name === "props"));
  const id = cols.find((c) => c.name === "id");
  console.log("[id_type]", id ? id.type : "(missing)");
} finally {
  db.close();
}
