/**
 * 客户可见字符串提取器（#1485 / UI 重做 T1）
 *
 * 契约来源：`docs/synova/ui-redo/UI重做-DEV-DOC-20261124.md` §5.4。
 *   · 扫描根 = `process.env.UI_REDO_SCAN_ROOT ?? 'electron-renderer/src'`（该覆盖点是契约的一部分，T1-D 靠它）
 *   · 被扫 = `.ts` / `.tsx` 的字符串字面量、模板字符串字面段、JSX 文本节点
 *   · 不扫 = import/export/`require`/`import()` 的模块路径、`className` / `style` / `data-*` 的（含表达式内）值、
 *            `console.*` 的参数、注释与 JSDoc（AST 天然不含注释）
 *   · 提取规则三条（§5.4）：
 *       ① 模板串只取字面段——先剥 `${…}` 再判（否则 `res.status` / `item.type` 这类代码表达式被当成文案）
 *       ② 排除纯点路径（`a.b.c`）、路径字面量（`./x` / `../x` / `@scope/x`）、长度 < 6 的全小写标识符
 *       ③ 导入语句后面的字面量不算
 *
 * `normalizeText` 是**键的一半**（另一侧是 allowlist 的 `text`），两侧必须共用本实现（§5.4）。
 *
 * 返回值比契约多两个字段：`via`（来源形态）与 `ariaLabel`。`aria-label` **属于**客户可见（§5.4），
 * 但**不进 allowlist 的销账口径**，故单独标记，由调用方分开统计。`path` 是相对当前工作目录的 POSIX 路径。
 *
 * 另有 **R2-19 的判据面**：`extractJsxExpressionSites` 收 JSX 表达式容器 `{…}` 里的**表达式**
 * （`{userRole}` 这类），与上面的字符串候选面**互相独立**（不进候选总数基线）。理由：§5.4 的候选排除规则②
 * 把 `item.type`（纯点路径）与 `ga`（长度 <6 全小写标识符）挡在候选外，字符串面在结构上看不见"渲染位直出"。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

type TsModule = typeof import('typescript');

const nodeRequire = createRequire(import.meta.url);
// typescript 是仓库既有 devDependency（5.9.3）；此处不走 ESM 默认导出，避免 CJS interop 差异。
const ts: TsModule = nodeRequire('typescript') as TsModule;

export const DEFAULT_SCAN_ROOT = 'electron-renderer/src';
export const SCAN_EXTENSIONS = ['.ts', '.tsx'] as const;

/** 一条客户可见字符串候选。`text` 保留原文，归一化由调用方用 `normalizeText` 做。 */
export interface VisibleString {
  /** 相对当前工作目录的 POSIX 路径，例如 `electron-renderer/src/components/StatusBar.tsx` */
  path: string;
  /** 1-based 行号（展示用；不参与判定） */
  line: number;
  /** 原文（未归一化） */
  text: string;
  /** 来源形态 */
  via: 'string' | 'template' | 'jsx-text';
  /** 是否来自 `aria-label`（客户可见但**不进** allowlist 销账口径） */
  ariaLabel: boolean;
}

/**
 * §5.4 规定的归一化。**改这个函数＝改键**，须升 DEV DOC 版本。
 * NFKC 统一全角/半角与兼容字符；任意空白折叠为单空格；去首尾空白。
 */
export function normalizeText(raw: string): string {
  return raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

/** 扫描根：环境覆盖优先（空白视同未设置）。 */
export function resolveScanRoot(): string {
  const override = process.env.UI_REDO_SCAN_ROOT;
  return override !== undefined && override.trim() !== '' ? override : DEFAULT_SCAN_ROOT;
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

/** 递归列出扫描根下的 `.ts` / `.tsx`（排序固定，保证输出确定性）。扫描根不存在时返回 `[]`（交给断言暴露，不抛异常）。 */
export function listScanFiles(root: string = resolveScanRoot()): string[] {
  const absoluteRoot = path.resolve(process.cwd(), root);
  let stat;
  try {
    stat = statSync(absoluteRoot);
  } catch {
    return [];
  }
  if (!stat.isDirectory()) return [];

  const files: string[] = [];
  const walk = (dir: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        walk(child);
      } else if (entry.isFile() && SCAN_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
        files.push(toPosix(path.relative(process.cwd(), child)));
      }
    }
  };
  walk(absoluteRoot);
  return files.sort();
}

/* ── 不扫：上下文排除 ───────────────────────────────────────────── */

/** 规则③：`import … from 'x'` / `export … from 'x'` / `require('x')` / `import('x')` / `import('x').T` 的模块路径。 */
function isModuleSpecifier(node: import('typescript').StringLiteralLike): boolean {
  const parent = node.parent;
  if (parent === undefined) return false;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return true;
  if (ts.isExternalModuleReference(parent)) return true;
  if (ts.isLiteralTypeNode(parent) && ts.isImportTypeNode(parent.parent)) return true;
  if (ts.isCallExpression(parent) && parent.arguments[0] === node) {
    if (parent.expression.kind === ts.SyntaxKind.ImportKeyword) return true;
    if (ts.isIdentifier(parent.expression) && parent.expression.text === 'require') return true;
  }
  return false;
}

const NON_VISIBLE_JSX_ATTRIBUTES = new Set(['className', 'class', 'style']);

function jsxAttributeName(attribute: import('typescript').JsxAttribute): string {
  return ts.isIdentifier(attribute.name) ? attribute.name.text : attribute.name.getText();
}

function isNonVisibleJsxAttribute(attribute: import('typescript').JsxAttribute): boolean {
  const name = jsxAttributeName(attribute);
  return NON_VISIBLE_JSX_ATTRIBUTES.has(name) || name.startsWith('data-');
}

/** 向上找最近的 JSX 属性；遇到 JSX 元素/语句/函数边界即停。 */
function enclosingJsxAttribute(node: import('typescript').Node): import('typescript').JsxAttribute | null {
  let current: import('typescript').Node | undefined = node.parent;
  while (current !== undefined) {
    if (ts.isJsxAttribute(current)) return current;
    if (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current) || ts.isJsxFragment(current)) return null;
    if (ts.isSourceFile(current) || ts.isBlock(current)) return null;
    if (ts.isArrowFunction(current) || ts.isFunctionDeclaration(current) || ts.isFunctionExpression(current)) return null;
    current = current.parent;
  }
  return null;
}

/** `aria-label`：客户可见，但单独统计、不进 allowlist 销账口径（§5.4）。 */
function isAriaLabelAttribute(node: import('typescript').Node): boolean {
  const attribute = enclosingJsxAttribute(node);
  return attribute !== null && jsxAttributeName(attribute) === 'aria-label';
}

/** 不扫：`className` / `class` / `style` / `data-*` 的值（含其表达式内的字面量）。 */
function isInsideNonVisibleJsxAttribute(node: import('typescript').Node): boolean {
  const attribute = enclosingJsxAttribute(node);
  return attribute !== null && isNonVisibleJsxAttribute(attribute);
}

function isConsoleCallee(expression: import('typescript').Expression): boolean {
  return (
    ts.isPropertyAccessExpression(expression)
    && ts.isIdentifier(expression.expression)
    && expression.expression.text === 'console'
  );
}

/** 不扫：`console.*` 的参数（最近一层调用表达式判定；语句/属性/JSX 表达式为边界）。 */
function isConsoleArgument(node: import('typescript').Node): boolean {
  let current: import('typescript').Node = node;
  while (current.parent !== undefined) {
    const parent: import('typescript').Node = current.parent;
    if (ts.isCallExpression(parent)) {
      return parent.arguments.includes(current as import('typescript').Expression) && isConsoleCallee(parent.expression);
    }
    if (ts.isStatement(parent) || ts.isSourceFile(parent) || ts.isJsxExpression(parent)) return false;
    current = parent;
  }
  return false;
}

/* ── 规则②：候选排除 ──────────────────────────────────────────── */

const DOT_PATH = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+$/;
const PATH_LITERAL = /^(?:\.{1,2}\/|\/|@[^/\s]+\/)/;
const SHORT_LOWERCASE_IDENTIFIER = /^[a-z]{1,5}$/;

/** 候选是否应被规则②排除（输入应为 `normalizeText` 之后的值）。 */
export function isExcludedCandidate(normalized: string): boolean {
  if (normalized === '') return true;
  if (DOT_PATH.test(normalized)) return true;
  if (PATH_LITERAL.test(normalized)) return true;
  if (SHORT_LOWERCASE_IDENTIFIER.test(normalized)) return true;
  return false;
}

/* ── 提取 ─────────────────────────────────────────────────────── */

function scriptKindFor(file: string): import('typescript').ScriptKind {
  return file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

/** 规则①：模板串只取字面段——`${…}` 整体剥掉，剩余字面段按出现顺序拼回一条候选。 */
function templateLiteralText(node: import('typescript').TemplateExpression): string {
  let text = node.head.text;
  for (const span of node.templateSpans) text += span.literal.text;
  return text;
}

export function extractVisibleStrings(root: string = resolveScanRoot()): VisibleString[] {
  const results: VisibleString[] = [];

  for (const relativePath of listScanFiles(root)) {
    const absolute = path.resolve(process.cwd(), relativePath);
    const source = readFileSync(absolute, 'utf8');
    const sourceFile = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, scriptKindFor(relativePath));

    const lineOf = (node: import('typescript').Node): number =>
      sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

    const push = (
      node: import('typescript').Node,
      raw: string,
      via: VisibleString['via'],
    ): void => {
      const normalized = normalizeText(raw);
      if (isExcludedCandidate(normalized)) return;
      results.push({
        path: relativePath,
        line: lineOf(node),
        text: raw,
        via,
        ariaLabel: isAriaLabelAttribute(node),
      });
    };

    const visit = (node: import('typescript').Node): void => {
      if (ts.isJsxText(node)) {
        // JSX 文本节点：`{…}` 是独立节点，本节点只含字面文本。
        if (normalizeText(node.text) !== '') push(node, node.text, 'jsx-text');
      } else if (ts.isStringLiteralLike(node)) {
        const skip =
          isModuleSpecifier(node) || isInsideNonVisibleJsxAttribute(node) || isConsoleArgument(node);
        if (!skip) push(node, node.text, 'string');
      } else if (ts.isTemplateExpression(node)) {
        const skip = isInsideNonVisibleJsxAttribute(node) || isConsoleArgument(node);
        if (!skip) push(node, templateLiteralText(node), 'template');
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  return results;
}

/* ── R2-19 判据面：JSX 表达式容器 `{…}` ───────────────────────── */

/**
 * 一条 JSX 表达式容器 `{…}` 内的表达式（R2-19「枚举值域插值直出」的判据面）。
 *
 * 与 `VisibleString` 的区别：这里收的是**表达式**（`{userRole}`），不是字符串字面量——
 * §5.4 的提取规则②把 `item.type`（纯点路径）与 `ga`（短小写标识符）排除在候选之外，
 * 所以 R2-18 在结构上看不见渲染位直出；R2-19 直接打在渲染位上（T4 把 `{userRole}` 改成中文后本条自然消失）。
 *
 * 本结构**不做规则判定**：登记表与判定在测试件（判据面与判据分离）。
 */
export interface JsxExpressionSite {
  /** 相对当前工作目录的 POSIX 路径（自检用例里即传入的 `fileName`） */
  path: string;
  /** 1-based 行号（`{` 所在行；展示用，不参与判据） */
  line: number;
  /** 表达式源码**去掉全部空白**后的文本（R2-19 的「全等」比对面） */
  text: string;
  /** 表达式源码原文（诊断用） */
  raw: string;
  /** 是否位于 JSX 子节点位置（真正的渲染位）；`false` ＝ 属性值位置（如 `role={userRole}`） */
  renderSite: boolean;
  /** 属性名（仅 `renderSite === false` 且父节点是 JSX 属性时有值） */
  attribute?: string;
}

/**
 * 从一段源码里解析 JSX 表达式容器（纯函数：自检用例喂合成 TSX，不碰文件系统）。
 * 只收**有表达式**的容器（`{/* 注释 *\/}` 之类 `expression === undefined` 的不收）。
 */
export function parseJsxExpressionSites(source: string, fileName: string): JsxExpressionSite[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKindFor(fileName));
  const sites: JsxExpressionSite[] = [];
  const visit = (node: import('typescript').Node): void => {
    if (ts.isJsxExpression(node) && node.expression !== undefined) {
      const raw = node.expression.getText(sourceFile);
      const parent = node.parent;
      const inChildrenPosition = ts.isJsxElement(parent) || ts.isJsxFragment(parent);
      const site: JsxExpressionSite = {
        path: fileName,
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
        text: raw.replace(/\s+/g, ''),
        raw,
        renderSite: inChildrenPosition,
      };
      if (!inChildrenPosition && ts.isJsxAttribute(parent)) site.attribute = jsxAttributeName(parent);
      sites.push(site);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return sites;
}

/** 扫描根下全部 `.ts`/`.tsx` 的 JSX 表达式容器（文件序与 `listScanFiles` 一致，输出确定）。 */
export function extractJsxExpressionSites(root: string = resolveScanRoot()): JsxExpressionSite[] {
  const sites: JsxExpressionSite[] = [];
  for (const relativePath of listScanFiles(root)) {
    const absolute = path.resolve(process.cwd(), relativePath);
    sites.push(...parseJsxExpressionSites(readFileSync(absolute, 'utf8'), relativePath));
  }
  return sites;
}
