/**
 * done5-read-real-db.cjs — #237 (K4-04) Done⑤ 读数
 *
 * 本机无 `sqlite3` CLI（实测 `Get-Command sqlite3` → NOT_FOUND）⇒ 用 node + better-sqlite3 只读读真机库：
 *   `D:\novis-backup-20260526\Novis\synova-agent\data\synova.db`（旧树真机库；🔴 只读，禁写、禁拷）
 *
 * 读数口径（CTO v3 §二，2026-10-11 裁）：
 *   · 首选 `immutable=1`；**实测经 better-sqlite3 不可用**（该库不传 `SQLITE_OPEN_URI`，
 *     `file:…?immutable=1` 被当成字面文件名 ⇒ 报 `unable to open database file`
 *     ／早期一次同因报 `Cannot open database because the directory does not exist`）
 *   · 次选 `readonly: true` + `PRAGMA query_only = 1`（本脚本采用）—— 避免写 WAL 共享内存
 *   · **零改动判据 = `data/synova.db` 本体 sha256 前后一致**（脚本内自测前后各一次并在输出里比对）
 *     （`-shm` / `-wal` 的 mtime 由 SQLite 管理，**非**数据写入 ⇒ 已由 CTO 准予豁免）
 *
 * 判据（Done⑤）：`PRAGMA table_info(graph_triples)` 须见 `props_json` 在、`props` 不在。
 * 用法：`node done5-read-real-db.cjs <db-path>`
 */
const crypto = require("crypto");
const fs = require("fs");
const Database = require("better-sqlite3");

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("usage: node done5-read-real-db.cjs <db-path>");
  process.exit(2);
}

const sha256 = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const colsOf = (db) =>
  db.pragma("table_info(graph_triples)").map((c) => ({ name: c.name, type: c.type, pk: c.pk }));

console.log("[db]", dbPath);
console.log("[file_bytes]", fs.statSync(dbPath).size);

// ① 首选口径：immutable=1（失败也是读数，照记）
try {
  const uri = "file:" + dbPath.replace(/\\/g, "/") + "?immutable=1";
  const idb = new Database(uri, { readonly: true, fileMustExist: true });
  const c = colsOf(idb);
  idb.close();
  console.log(
    "[mode_immutable1] OK | count =",
    c.length,
    "| has_props_json =",
    c.some((x) => x.name === "props_json"),
    "| has_props =",
    c.some((x) => x.name === "props"),
  );
} catch (err) {
  console.log("[mode_immutable1] FAILED:", err.message, "⇒ 回落 readonly + query_only");
}

// ② 次选口径：readonly + PRAGMA query_only=1（含本体 sha256 前后自测）
const before = sha256(dbPath);
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
try {
  db.pragma("query_only = 1");
  const cols = colsOf(db);

  console.log("[mode]", "readonly:true + PRAGMA query_only=1");
  console.log("[count]", cols.length);
  console.log("[cols]", cols.map((c) => `${c.name}:${c.type}${c.pk ? "(pk)" : ""}`).join(", "));
  console.log("[has_props_json]", cols.some((c) => c.name === "props_json"));
  console.log("[has_props]", cols.some((c) => c.name === "props"));
  const id = cols.find((c) => c.name === "id");
  console.log("[id_type]", id ? id.type : "(missing)");
} finally {
  db.close();
}
const after = sha256(dbPath);
console.log("[sha256_before]", before);
console.log("[sha256_after]", after);
console.log("[sha256_unchanged]", before === after);
