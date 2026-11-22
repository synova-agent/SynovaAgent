/**
 * install-profile.ts — R3 chain evidence script (Issue #1455, T0).
 *
 * Installs the repo-owned `synova-sidecar` dsh profile into the task-isolated
 * DSH_HOME, reusing the PRODUCT functions (no re-implementation):
 *   loadSidecarProfile -> assertSidecarProfile -> installSidecarProfile
 * and prints one JSON line describing what was installed.
 *
 * @input  env SYNOVA_DSH_HOME (task-isolated DSH home, absolute)
 * @output stdout: JSON { ok, dshHome, profileDir, target, files, bundles, patchEntryCount, disabledIds }
 * @error  missing env / profile violations -> non-zero exit, message on stderr
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertSidecarProfile,
  defaultProfileDir,
  installSidecarProfile,
  loadSidecarProfile,
} from '../../../src/runtime/dsh/profile';

const dshHome = process.env.SYNOVA_DSH_HOME;
if (typeof dshHome !== 'string' || dshHome.length === 0) {
  throw new Error('install-profile: SYNOVA_DSH_HOME is required');
}
const profileDir = defaultProfileDir();
if (!existsSync(profileDir)) {
  throw new Error(`install-profile: profile dir missing: ${profileDir}`);
}
const profile = loadSidecarProfile(profileDir);
assertSidecarProfile(profile);
const target = installSidecarProfile({ profileDir, dshHome });

process.stdout.write(`${JSON.stringify({
  ok: true,
  dshHome,
  profileDir,
  target,
  files: readdirSync(target).sort(),
  bundles: profile.bundles,
  patchEntryCount: profile.patchEntries.length,
  disabledIds: profile.patchEntries.filter(entry => entry.disabled).map(entry => entry.id),
  sandboxEntry: profile.patchEntries.find(entry => entry.id === 'sandbox-policy') ?? null,
  approvalEntry: profile.patchEntries.find(entry => entry.id === 'approval') ?? null,
  targetFileCount: readdirSync(join(target)).length,
}, null, 2)}\n`);
