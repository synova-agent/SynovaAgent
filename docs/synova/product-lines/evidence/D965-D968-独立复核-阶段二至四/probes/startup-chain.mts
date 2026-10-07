/**
 * startup-chain.mts — D968 关键声称 4「生产启动链 = 文件驱动单入口」运行时核验
 * 调生产同款 initFileDrivenLoaders()（Phase 3b 的实际被调函数），断言 registry 内容全部来自文件驱动。
 * 用法: tsx startup-chain.mts --wt=<tree> [--also-path1]
 */
import Database from 'better-sqlite3';
const WT = process.argv.find(a => a.startsWith('--wt='))!.slice(5);
const ALSO_PATH1 = process.argv.includes('--also-path1');
process.chdir(WT);
process.env.SYNOVA_DB_PATH = `/tmp/verify-d968/startup-${Date.now()}.db`;

const { loadSentinels } = await import(`${WT}/src/sentinel/sentinel-loader.ts`);
const { getSentinelRegistry, destroySentinelRegistry } = await import(`${WT}/src/sentinel/registry.ts`);
const { initFileDrivenLoaders } = await import(`${WT}/src/init/file-driven-loaders.ts`);

destroySentinelRegistry();
const disk = loadSentinels();
console.log(`# 磁盘 manifest 数（loader 源）= ${disk.sentinels.length}`);
await initFileDrivenLoaders();
const reg = getSentinelRegistry();
const ids = reg.list().map(s => s.config.id).sort();
console.log(`# initFileDrivenLoaders() 后 registry.count() = ${reg.count()}`);

const expected = disk.sentinels.map(s => `sentinel-${s.manifest.name}`).sort();
const sameSet = JSON.stringify(ids) === JSON.stringify(expected);
console.log(`# ASSERT registry 集合 == 文件驱动 manifest 集合 → ${sameSet ? 'HOLDS' : 'VIOLATED'}`);
const notFromFiles = ids.filter(id => !expected.includes(id));
console.log(`# 非文件驱动来源的注册项 = ${JSON.stringify(notFromFiles)}`);

// 路径1 的四个适配器若存在会以这些 id 注册（其 config.id）。
// 注: 具体 id 依赖 adapter 内部 config.id；用"是否出现旧适配器的导入路径产物"作代理断言：
const oldAdapterHint = ids.filter(id => /cash-flow|cpc|goal|integration-health/i.test(id));
console.log(`# 疑似路径1 产物 id = ${JSON.stringify(oldAdapterHint)}（期望空）`);

if (ALSO_PATH1) {
  const { registerBuiltinSentinels } = await import(`${WT}/src/sentinel/builtins.ts`);
  const before = reg.count();
  await registerBuiltinSentinels();
  const after = reg.count();
  console.log(`# [path1] registerBuiltinSentinels() 前后 registry.count() = ${before} → ${after}（期望不变）`);
  console.log(`# [path1] ASSERT 路径1 增量为 0 → ${after - before === 0 ? 'HOLDS' : 'VIOLATED'}`);
}
process.exit(0);
