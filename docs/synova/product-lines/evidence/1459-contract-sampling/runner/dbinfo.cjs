/**
 * dbinfo.cjs — read-only inspection of the #1459 isolated scan DB (T0 product).
 * Prints: tables, graph/type census, USER nodes (email/role/org only; never a hash or secret).
 * usage: node dbinfo.cjs <dbPath>
 */
const B = require('better-sqlite3');
const dbPath = process.argv[2];
if (!dbPath) {
  console.error('usage: node dbinfo.cjs <dbPath>');
  process.exit(2);
}
const db = new B(dbPath, { readonly: true });
const all = (sql) => db.prepare(sql).all();
const one = (sql) => db.prepare(sql).get();

const tables = all("select name from sqlite_master where type='table' order by name").map((r) => r.name);
console.log('dbPath=' + dbPath);
console.log('tables=' + tables.join(','));

const hasGraphNodes = tables.includes('graph_nodes');
if (hasGraphNodes) {
  const groups = all('select graph, type, count(*) c from graph_nodes group by graph, type order by graph, type');
  console.log('graph_nodes groups=' + groups.length);
  for (const r of groups) console.log('  ' + r.graph + ' | ' + r.type + ' | ' + r.c);
  const total = one('select count(*) c from graph_nodes');
  console.log('graph_nodes total=' + total.c);
  if (tables.includes('graph_triples')) {
    const tripleGroups = all('select graph, predicate, count(*) c from graph_triples group by graph, predicate');
    console.log('graph_triples=' + tripleGroups.map((r) => r.graph + '/' + r.predicate + ':' + r.c).join(', '));
  }
  const nodes = all('select id, graph, type, props from graph_nodes order by graph, type, id');
  for (const r of nodes) {
    let p = {};
    try { p = JSON.parse(r.props); } catch { p = {}; }
    const bk = p.businessKey === undefined ? '-' : String(p.businessKey);
    console.log('  NODE ' + r.graph + ' | ' + r.type + ' | ' + r.id + ' | businessKey=' + bk);
  }
  const users = all("select id, props from graph_nodes where type='USER'");
  console.log('USER nodes=' + users.length);
  for (const r of users) {
    let p = {};
    try { p = JSON.parse(r.props); } catch { p = { parse: 'failed' }; }
    console.log('  ' + r.id + ' | ' + String(p.email) + ' | ' + String(p.role) + ' | ' + String(p.orgId) + ' | status=' + String(p.status));
  }
}
db.close();
