/**
 * scripts/ingest-v0/lib/ts-resolve-loader.mjs — **本机运行期** TS 解析钩子（仅把 `.ts` 源码接上 Node 原生类型擦除）。
 *
 * 为什么需要：本票写集只允许 `.mjs`，但落库必须走产品 TS 原语（persistFacts 等）。
 * 正常开发机用 `npx tsx` 即可；本机沙箱里 tsx 的 esbuild 子进程被拒绝（EPERM），
 * 因此 CLI 自举到 Node 原生 `--experimental-transform-types` + 本钩子（零第三方依赖）。
 *
 * 边界：只影响本进程的模块解析；不修改任何源码、不做代码转换（类型擦除由 Node 负责）。
 * 解析规则（与 tsconfig paths / vitest alias 对齐）：
 *   · `@synova/*` → `packages/<name>/src/index.ts`；
 *   · 相对/绝对无扩展名 import → 依次尝试 `.ts` / `.tsx` / `/index.ts`；
 *   · 以 `.js` 结尾的相对 import → 试同路径 `.ts`（TS ESM 惯例）。
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));

const ALIASES = {
  '@synova/sog-core': 'packages/sog-core/src/index.ts',
  '@synova/engine-auth': 'packages/engine-auth/src/index.ts',
  '@synova/logger': 'packages/logger/src/index.ts',
  '@synova/error-types': 'packages/error-types/src/index.ts',
  '@synova/connector-registry': 'packages/connector-registry/src/index.ts',
  '@synova/extension-registry': 'packages/extension-registry/src/index.ts',
  '@synova/knowledge-ingest': 'packages/knowledge-ingest/src/index.ts',
  '@synova/evolution': 'packages/evolution/src/index.ts',
  '@synova/ontology': 'packages/ontology/src/index.ts',
};

/** @input candidate —— 绝对路径 @output 文件 URL 结果（不指定 format，交给扩展名判定） @degraded 无 @authority 本文件 @not_here 无 @error 无 */
function fileResult(candidate) {
  return { url: pathToFileURL(candidate).href, shortCircuit: true };
}

/**
 * ESM resolve 钩子。
 *
 * @input  specifier —— 模块说明符；context —— `{parentURL}`；nextResolve —— 默认解析
 * @output `{url, shortCircuit}` 或默认解析结果
 * @degraded 无：未命中就交回 Node 默认解析（不吞错）
 * @authority 别名表 = 本文件 `ALIASES`（与 tsconfig/vitest 同步维护）
 * @not_here 不读取/执行模块内容
 * @error 无（解析失败由 Node 抛 ERR_MODULE_NOT_FOUND）
 */
export async function resolve(specifier, context, nextResolve) {
  // Windows 下入口有时以 `file:D:\...` 形态到达（无 `//`）：归一成文件路径；合法 `file:///D:/...` 交回 Node。
  if (specifier.startsWith('file:')) {
    const raw = specifier.slice(5);
    if (/^[A-Za-z]:/.test(raw)) return fileResult(raw);
    try {
      return nextResolve(new URL(specifier).href, context);
    } catch {
      // 落回默认解析（让 Node 给出明确错误）
    }
  }
  const alias = ALIASES[specifier];
  if (alias !== undefined) return fileResult(path.join(root, alias));

  const parent = context.parentURL?.startsWith('file:') ? path.dirname(fileURLToPath(context.parentURL)) : root;
  if (specifier.startsWith('./') || specifier.startsWith('../') || path.isAbsolute(specifier)) {
    const base = path.resolve(parent, specifier);
    const candidates = [];
    if (path.extname(base) === '') {
      candidates.push(`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'));
    } else if (base.endsWith('.js')) {
      candidates.push(`${base.slice(0, -3)}.ts`);
    }
    for (const candidate of candidates) {
      if (existsSync(candidate)) return fileResult(candidate);
    }
  }
  return nextResolve(specifier, context);
}
