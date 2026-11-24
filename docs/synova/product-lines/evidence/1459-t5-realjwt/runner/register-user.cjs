/**
 * register-user.cjs — create the #1459 M1 test account THROUGH THE APP'S OWN ROUTE (DEV DOC v1.1 §10.2).
 *
 * Never hand-writes a password hash: the server's `POST /api/auth/register` runs
 * `UserStore.createUser` -> bcrypt(10), the same algorithm `POST /api/auth/login` verifies.
 *
 * usage: node register-user.cjs --base <url> --email <m> --role admin --org org-a \
 *          --password-file <p1> [--password-file <p2> ...]
 * @output stdout: registerOk / userId / role / orgId / loginOk / loginUserId / loginRole / loginOrgId
 * @exit 0 ok ｜ 1 register or login rejected ｜ 2 usage
 * @not-here never prints the password or the JWT.
 */
const { writeFileSync, mkdirSync } = require('node:fs');
const { dirname } = require('node:path');
const { randomInt } = require('node:crypto');

const argv = process.argv.slice(2);
const opts = { passwordFiles: [] };
for (let i = 0; i < argv.length; i += 1) {
  const key = argv[i];
  const value = argv[i + 1];
  if (key === '--password-file') { opts.passwordFiles.push(value); i += 1; continue; }
  if (key.startsWith('--')) { opts[key.slice(2)] = value; i += 1; }
}
const { base, email, role, org } = opts;
if (!base || !email || !role || !org || opts.passwordFiles.length === 0) {
  console.error('usage: node register-user.cjs --base <url> --email <m> --role admin --org org-a --password-file <p>');
  process.exit(2);
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
let password = '';
for (let i = 0; i < 20; i += 1) password += ALPHABET[randomInt(ALPHABET.length)];

for (const file of opts.passwordFiles) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, password + '\n', { encoding: 'utf8', mode: 0o600 });
}

async function postJson(path, body) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = { _unparsed: text.slice(0, 200) }; }
  return { status: response.status, json };
}

async function main() {
  const register = await postJson('/api/auth/register', { email, password, role, orgId: org });
  const reg = register.json ?? {};
  console.log(`registerHttp=${register.status} registerOk=${String(reg.ok)} userId=${String(reg.payload?.userId)} role=${String(reg.payload?.role)} orgId=${String(reg.payload?.orgId)}`);
  if (reg.ok !== true) {
    console.log(`registerError code=${String(reg.code)} message=${String(reg.message)}`);
    process.exit(1);
  }

  const login = await postJson('/api/auth/login', { email, password });
  const log = login.json ?? {};
  console.log(`loginHttp=${login.status} loginOk=${String(log.ok)} loginUserId=${String(log.payload?.userId)} loginRole=${String(log.payload?.role)} loginOrgId=${String(log.payload?.orgId)} tokenPresent=${String(typeof log.token === 'string' && log.token.length > 0)}`);
  if (log.ok !== true) {
    console.log(`loginError code=${String(log.code)} message=${String(log.message)}`);
    process.exit(1);
  }
  console.log(`passwordLength=${password.length} passwordWrittenTo=${opts.passwordFiles.length}File(s)`);
}

main().catch((err) => { console.error('fatal: ' + (err instanceof Error ? err.message : String(err))); process.exit(2); });
