/**
 * src/init/file-driven-loaders.ts — 内容面装配入口（boot）
 *
 * 在 server.ts 启动时调用，把 extensions/ 内容面接入运行时。
 * 接线审计 (铁律 5): 每个新 export 必须有调用方。
 *
 * 🔴 #1465（K10·EXT-WIRE）重构：**收敛为 content-registry 驱动**。
 *   原实现把 8 个 loader 的 `await import(...)` 硬编码在本文件里（散点 8 处，实测
 *   `grep -cE "await import\('.*-loader'\)" origin/main:src/init/file-driven-loaders.ts` = 8）。
 *   规范《extensions内容面规范-v0》§5.2 修法 = 建引擎侧唯一 `type→loader` 表 ⇒ 本文件不再持有映射，
 *   只调用 `initContentTypes()`（`src/deploy/content-registry.ts`）。
 *   ⇒ 新增内容项 = 在 registry 加一条声明，**本文件零改动**（规范 §5.4「0 宿主改动」）。
 *
 * 仍留在本文件的唯一块：D36 `field-mappings` 自动发现 —— 它扫描的是
 *   `extensions/ontology/field-mappings/` **子路径**，走的是 `src/agent/adapter-scanner` +
 *   `src/agent/adapter-registry` 的**注册通道**（非 loader 通道），故不在 content-registry 的
 *   `type→loader` 表内；已在 registry 的 `ontology` 项 `readers[]` 中登记，避免成为隐形缺口。
 */
import { createLogger } from '@synova/logger';

const log = createLogger('init/file-driven-loaders');

/**
 * 初始化所有内容面文件驱动加载器。
 * 在 server.ts 启动流程中调用。
 *
 * 降级契约（铁律 11/24/31）: 逐项失败隔离在 `initContentTypes()` 内完成；
 * 本函数**不抛出**，只把 degraded 信号写 log 供上层观测。
 */
export function initFileDrivenLoaders(): Promise<void> {
  return _initFileDrivenLoaders();
}

async function _initFileDrivenLoaders(): Promise<void> {
  // 内容面全部 loader —— 由 content-registry 唯一驱动（9 项: sentinel/ontology/framework/
  // report-template/rule/locale/notification/adapter/business-model）
  try {
    const { describeContentRegistry, initContentTypes } = await import('../deploy/content-registry');

    // 规范 §5.3「早激活：boot 全量解析，选择前暴露失败」—— 先打印注册表构成 + 完整性问题
    const snapshot = describeContentRegistry();
    if (snapshot.integrityProblems.length > 0) {
      log.warn(
        { problems: snapshot.integrityProblems },
        'content-registry 表自身完整性问题 — 编程错误，需修表',
      );
    }
    log.info(
      {
        total: snapshot.counts.total,
        reachable: snapshot.counts.reachable,
        retired: snapshot.counts.retired,
        pendingCto: snapshot.counts.pendingCto,
      },
      '内容面注册表已加载（20 项状态分布）',
    );

    const report = await initContentTypes();
    if (report.errors.length > 0) {
      log.warn({ errors: report.errors }, '内容项装配失败 — degraded（已隔离，不阻断启动）');
    }
    if (report.warnings.length > 0) {
      log.warn({ warnings: report.warnings }, '内容项装配带降级信号 — degraded');
    }
    log.info(
      { attempted: report.attempted, loaded: report.loaded },
      '内容面 loader 已初始化（content-registry 驱动）',
    );
  } catch (err: unknown) {
    // registry 自身损坏（编程错误）—— 显式降级，不让 boot 崩
    log.warn({ err }, 'content-registry 驱动失败 — degraded');
  }

  // D36: field-mappings 适配器自动发现 — 扫描 extensions/ontology/field-mappings/ + 注册到 AdapterRegistry
  try {
    const { scanFieldMappings } = await import('../agent/adapter-scanner');
    const { AdapterRegistry } = await import('../agent/adapter-registry');

    const scanResult = scanFieldMappings();
    const registry = AdapterRegistry.getInstance();
    const { registered, errors } = registry.registerFromScan(scanResult.adapters);
    if (errors.length > 0) log.warn({ errors }, '部分适配器注册失败 — degraded');
    if (registered === 0) log.warn('零适配器被注册 — 数据接入可能异常');
    log.info({ registered, total: scanResult.adapters.length }, 'field-mappings 适配器已自动发现并注册');
  } catch (err: unknown) {
    log.warn({ err }, 'field-mappings 适配器初始化失败 — degraded');
  }
}
