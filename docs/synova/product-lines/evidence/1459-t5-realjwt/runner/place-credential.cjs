/**
 * place-credential.cjs — copy ONLY the DEEPSEEK_API_KEY ref from the user-level DSH credential
 * store into an isolated per-instance DSH home (#1459 M1 runner step S1).
 *
 * Contract:
 *   @input  srcStore  — path to a dsh-credentials-local file (version:1 + refs:)
 *           outStore  — path to write (isolated dsh-home/.credentials.yaml)
 *   @output stdout    — one line: refName=<name> len=<n> outBytes=<n>   (NEVER the value)
 *   @exit   0 written ｜ 1 no DEEPSEEK_API_KEY ref found ｜ 2 bad usage / read failure
 * @not-here does not print, log, or otherwise expose the secret; writes only the single ref.
 */
const { readFileSync, writeFileSync, mkdirSync, existsSync } = require('node:fs');
const { dirname } = require('node:path');

const [srcStore, outStore] = process.argv.slice(2);
if (!srcStore || !outStore) {
  console.error('usage: node place-credential.cjs <srcStore> <outStore>');
  process.exit(2);
}
if (!existsSync(srcStore)) {
  console.error('source store missing: ' + srcStore);
  process.exit(2);
}

const lines = readFileSync(srcStore, 'utf8').split(/\r?\n/);
let value = null;
let inRefs = false;
for (const line of lines) {
  if (/^refs:\s*$/.test(line)) { inRefs = true; continue; }
  if (inRefs && /^\S/.test(line)) { inRefs = false; }
  if (!inRefs) continue;
  const match = /^ {2}DEEPSEEK_API_KEY:\s*(.+?)\s*$/.exec(line);
  if (match) { value = match[1].replace(/^["']|["']$/g, ''); }
}
if (value === null || value.length === 0) {
  console.error('no DEEPSEEK_API_KEY ref in source store');
  process.exit(1);
}

mkdirSync(dirname(outStore), { recursive: true });
const payload = `version: 1\nrefs:\n  DEEPSEEK_API_KEY: ${value}\n`;
writeFileSync(outStore, payload, { encoding: 'utf8', mode: 0o600 });
process.stdout.write(`refName=DEEPSEEK_API_KEY len=${value.length} outBytes=${Buffer.byteLength(payload, 'utf8')}\n`);
