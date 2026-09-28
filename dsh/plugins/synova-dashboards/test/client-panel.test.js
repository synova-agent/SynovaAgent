// test/client-panel.test.js — 「项目总览」客户端面板渲染契约测试（node:test）
//
// 为什么能在 Node 里跑浏览器插件代码：lib/client.js 走 window.__ModuleLoader__.load 零构建工厂，
// 只依赖 react / react/jsx-runtime 两个静态种子模块。本测试注入迷你可控的 React 运行时
// （useState/useCallback/useEffect 真跑，两趟渲染：收集 effect → 驱动 fetch → 再渲染），
// 从而在无浏览器环境下真实验证：
//   · 槽位注册签名（sidebar.panellist {id,order,label} + main {key} 成对、id 相同）
//   · 正常账本 → 三数/26 线/阻塞/时间轴占位 全部渲染
//   · 路由级降级（ok:false）→ 显式降级文案，不白屏不抛错
//   · ledger 级部分降级（degraded:true）→ 警告条 + degraded_sources
//   · 零写入：全程只调用 GET，不触碰任何写接口
// 铁律 48：非空壳，每条路径都有真实断言。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ── 迷你 React 装载/渲染夹具（原 test/harness.js；单消费者，内联以免多占一个 PR 文件位）──
const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../lib/client.js"), "utf8");

/** 健康区默认夹具（多数用例只关心账本，给一份可用 health 让健康区正常渲染）。 */
const DASH_OK = {
  meta: { repoRoot: "/repo", generated_at: "2026-09-17T10:00:00+08:00" },
  product: { ok: true, product_progress_pct: 0, total_lines: 26, lines: [] },
  tasks: { ok: true, states: [], recent: [] },
  health: {
    ok: true,
    bypass: {
      present: true,
      total_events: 340,
      counts: { COMMITTED: 334, "detected-bypass": 0, BLOCKED: 0, DEGRADED: 0 },
      recent: [],
    },
    precommit_failures: { present: true, count: 0, recent: [] },
    m_patterns: [],
    cto_verdict: "🟢 绿",
  },
};

/**
 * 装载插件脚本。
 * @param {{storage?: Record<string,string>}} [opts] storage 为 localStorage 初始内容（键→值字符串）。
 * @returns {{registrations, fetchCalls, panelSelections, storageWrites, css, restore, render, renderDetailed}}
 */
function loadPlugin(opts = {}) {
  const registrations = [];
  const fetchCalls = [];
  const panelSelections = [];
  const storageWrites = [];
  const consoleErrors = [];
  const injectedStyles = [];
  const storage = new Map(Object.entries(opts.storage ?? {}));
  let captured = null;

  // ── 迷你 React 运行时 ────────────────────────────────────────────────
  const g = { stores: [], compIdx: 0, cursor: null, effects: [], effectQueue: [] };

  function enterComponent() {
    const store = g.stores[g.compIdx] ?? (g.stores[g.compIdx] = []);
    g.compIdx++;
    g.cursor = { i: 0, store };
    return g.cursor;
  }
  const React = {
    createElement(type, props, ...children) {
      const p = Object.assign({}, props || {});
      if (children.length > 0) p.children = children.length === 1 ? children[0] : children;
      return { type, props: p };
    },
    useState(init) {
      const c = g.cursor;
      const i = c.i++;
      if (!(i in c.store)) c.store[i] = typeof init === "function" ? init() : init;
      return [c.store[i], (v) => {
        c.store[i] = typeof v === "function" ? v(c.store[i]) : v;
      }];
    },
    useCallback(fn) {
      g.cursor.i++;
      return fn;
    },
    useEffect(fn) {
      g.cursor.i++;
      g.effectQueue.push(fn);
      return undefined;
    },
    useMemo(fn) {
      g.cursor.i++;
      return fn();
    },
    // D1060：新面板外壳用 useRef 存拖动/缩放起点。迷你夹具按真实 React 语义实现：
    // 跨渲染保持同一个 { current } 对象（否则拖动会被每次渲染重置）。
    useRef(init) {
      const c = g.cursor;
      const i = c.i++;
      if (!(i in c.store)) c.store[i] = { current: init };
      return c.store[i];
    },
  };
  const Fragment = Symbol("Fragment");
  const jsxRuntime = {
    Fragment,
    jsx: (type, props) => ({ type, props: props || {} }),
    jsxs: (type, props) => ({ type, props: props || {} }),
  };

  const documentStub = {
    visibilityState: "visible",
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ dataset: {}, textContent: "" }),
    head: { appendChild: (tag) => injectedStyles.push(tag) },
    addEventListener() {},
    removeEventListener() {},
  };
  const windowStub = {
    innerWidth: 1400,
    innerHeight: 900,
    __ModuleLoader__: { load: (def) => { captured = def; } },
  };
  const localStorageStub = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => { storage.set(k, String(v)); storageWrites.push({ key: k, value: String(v) }); },
    removeItem: (k) => { storage.delete(k); },
  };

  const prev = {
    window: globalThis.window,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    fetch: globalThis.fetch,
  };
  globalThis.window = windowStub;
  globalThis.document = documentStub;
  globalThis.localStorage = localStorageStub;

  // 执行插件脚本（它会调用 window.__ModuleLoader__.load 注册工厂）
  // 用 indirect eval 让脚本在全局作用域求值，语义与浏览器加载一致。
  // eslint-disable-next-line no-eval
  (0, eval)(SRC);
  assert.ok(captured, "client.js 必须调用 window.__ModuleLoader__.load 注册工厂");

  const requireStub = (name) => {
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return jsxRuntime;
    throw new Error("unexpected require: " + name);
  };
  const mod = captured.factory(requireStub);

  const ctx = {
    layout: {
      selectPanel(panelId) {
        panelSelections.push(panelId);
      },
    },
    // 真实 ctx.effect 会立即执行回调并把返回值当 disposer；这里同语义
    effect(fn) {
      const dispose = fn();
      return typeof dispose === "function" ? dispose : () => {};
    },
    slots: {
      inject(slot, cb) {
        registrations.push({ inject: slot });
        const dispose = cb();
        return typeof dispose === "function" ? dispose : () => {};
      },
      register(options, component) {
        // D1060 注入缝：模拟「slot 不存在 / 版本不足」——指定 key 的 main 注册直接抛错
        if (opts.failMainKeys && options && options.name === "main" && opts.failMainKeys.includes(options.key)) {
          throw new Error("slot 'main' 不存在（版本不足）");
        }
        registrations.push({ options, component });
        return () => {};
      },
    },
  };
  // D1060：捕获注册期的 console.error（验证降级"留痕"而非静默吞）
  const prevConsoleError = console.error;
  console.error = (...a) => { consoleErrors.push(a.map((x) => String(x)).join(" ")); };
  try {
    mod.apply(ctx);
  } finally {
    console.error = prevConsoleError;
  }

  return {
    registrations,
    fetchCalls,
    panelSelections,
    storageWrites,
    consoleErrors,
    registrationDegraded: mod.__synovaRegistrationDegraded,
    /** 本插件注入的 CSS 全文（由 apply 写入 <style>）。 */
    css: () => injectedStyles.map((t) => t.textContent).join("\n"),
    restore() {
      globalThis.window = prev.window;
      globalThis.document = prev.document;
      globalThis.localStorage = prev.localStorage;
      globalThis.fetch = prev.fetch;
    },
    /** 两趟渲染：跑 effect 拉数据 → 再渲染。返回渲染出的文本片段。 */
    /** 详细渲染：除文本外还返回元素节点（className/props/handlers/父 className）与根内联样式。 */
    async renderDetailed(payload, opts = {}) {
      const r = await run(payload, opts);
      return r;
    },
    async render(payload, opts = {}) {
      const r = await run(payload, opts);
      return r.text;
    },
    /** 兼容旧签名：文本形式。 */
    async __renderText(payload, opts = {}) {
      const r = await run(payload, opts);
      return r.text;
    },
  };

  async function run(payload, opts = {}) {
      g.compIdx = 0;
      g.effectQueue = [];
      globalThis.fetch = async (url, o) => {
        fetchCalls.push({ url, options: o });
        const u = String(url);
        const isDash = u.includes("/synova/dashboards/data");
        if (opts.fetchThrows) throw new Error(opts.fetchThrows);
        if (opts.httpStatus) return { ok: false, status: opts.httpStatus, json: async () => ({}) };
        // D1060：两个新面板各一条路由，可分别注入成功/失败（验证各自独立降级）
        if (u.includes("/synova/workbench/data")) {
          if (opts.workbenchThrows) throw new Error(opts.workbenchThrows);
          return { ok: true, status: 200, json: async () => (opts.workbench === undefined ? WB_OK : opts.workbench) };
        }
        if (u.includes("/synova/governance/data")) {
          if (opts.governanceThrows) throw new Error(opts.governanceThrows);
          return { ok: true, status: 200, json: async () => (opts.governance === undefined ? GOV_OK : opts.governance) };
        }
        // 两条路由可分别注入失败，用于验证「各自独立降级」
        if (isDash && opts.dashThrows) throw new Error(opts.dashThrows);
        if (!isDash && opts.ledgerThrows) throw new Error(opts.ledgerThrows);
        if (isDash && opts.dashStatus) return { ok: false, status: opts.dashStatus, json: async () => ({}) };
        if (!isDash && opts.ledgerStatus) return { ok: false, status: opts.ledgerStatus, json: async () => ({}) };
        if (isDash) {
          return { ok: true, status: 200, json: async () => (opts.dash === undefined ? DASH_OK : opts.dash) };
        }
        return { ok: true, status: 200, json: async () => payload };
      };
      const panelReg = registrations.find((r) => r.options && r.options.name === "main" && (!opts.panelKey || r.options.key === opts.panelKey));
      assert.ok(panelReg, "必须注册 main keyed cell" + (opts.panelKey ? "（key=" + opts.panelKey + "）" : ""));
      const call = (fn, props) => { enterComponent(); return fn(props); };
      const collect = (node, out, parentClass) => {
        if (node === null || node === undefined || node === false || node === true) return;
        if (Array.isArray(node)) { for (const c of node) collect(c, out, parentClass); return; }
        if (typeof node === "string" || typeof node === "number") { out.text.push(String(node)); return; }
        if (typeof node !== "object") return;
        const t = node.type;
        if (typeof t === "function") {
          collect(call(t, node.props || {}), out, parentClass);
          return;
        }
        const p = node.props || {};
        const cls = typeof p.className === "string" ? p.className : "";
        if (typeof t === "string") {
          out.nodes.push({
            tag: t,
            className: cls,
            parentClass,
            props: p,
            handlers: Object.keys(p).filter((k) => k.startsWith("on")),
          });
        }
        collect(p.children, out, cls || parentClass);
      };
      const pass = () => {
        g.compIdx = 0;
        g.effectQueue = [];
        const out = { text: [], nodes: [] };
        const root = call(panelReg.component, {});
        collect(root, out, null);
        return { out, root };
      };
      pass(); // 第一趟：data=null
      const cleanups = [];
      for (const fn of g.effectQueue) {
        const c = fn();
        if (typeof c === "function") cleanups.push(c);
      }
      for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); // 驱动 fetch/await
      const second = pass(); // 第二趟：data 已就位
      for (const c of cleanups) c();
      // 根样式取「实际渲染出的最外层宿主元素」（组件工厂返回的是元素描述，不是 DOM 节点）
      const rootNode = second.out.nodes.find((n) => n.className.includes("spo-root")) || second.out.nodes[0] || { props: {}, className: "" };
      return {
        text: second.out.text.join(" \u241F "),
        nodes: second.out.nodes,
        rootStyle: rootNode.props.style || {},
        rootClassName: rootNode.className,
      };
  }
}

const LEDGER_OK = {
  schema: "project-ledger/1",
  ok: true,
  source: "worktree", // 路由成功时总会带上取数来源（lib/index.js 注入）
  generated_by: "gen-project-board.py",
  generated_at: "2026-09-17T10:00:00+08:00",
  git_head: "6a06e853abcdef",
  degraded: false,
  degraded_sources: [],
  totals: {
    v1_total: 125, v1_passed: 5, v1_verified: 2, delivery_pct: 4, verify_pct: 40,
    freshness: { green: 3, yellow: 1, red: 2 }, blocked_count: 1,
  },
  lines: [
    {
      id: 1, name: "桌面端", v1_total: 5, v1_passed: 3, v1_verified: 1,
      freshness: { green: 2, yellow: 0, red: 1 },
      blocked: [{ reason: "等 Win 真机", since: "2026-09-15", needs: "Win 机器", days: 2 }],
      assertions: [
        { id: "1-1", text: "能装", verify: "scenario", kind: "scenario", ok: true, evidence: [], age_days: 2, fail_when: "装不上" },
        { id: "1-2", text: "能开", verify: "test", kind: "test", ok: false, evidence: [], age_days: null, fail_when: "开不了" },
      ],
    },
    { id: 2, name: "账本派生", v1_total: 5, v1_passed: 2, v1_verified: 1, freshness: { green: 1, yellow: 1, red: 1 }, blocked: [], assertions: [] },
  ],
  blocked: [{ id: "D793", reason: "等 Win 真机", since: "2026-09-15", needs: "Win 机器", days: 2 }],
  timeline: [],
};

test("注册契约：三对 (sidebar.panellist 入口行 + main keyed cell) 成对、id/key 相同、main 先注册", () => {
  const p = loadPlugin();
  try {
    const entries = p.registrations.filter((r) => r.options && r.options.name === "sidebar.panellist");
    const cells = p.registrations.filter((r) => r.options && r.options.name === "main");
    assert.equal(entries.length, 3, "D1060：三个独立入口（项目总览 / 开发工作台 / 治理线）");
    assert.equal(cells.length, 3, "D1060：三个 main keyed cell");
    // 官方协议：同一个 id 寻址 main；未注册 main key 时点击会抛错 → 必须逐对同名
    assert.deepEqual(
      entries.map((r) => r.options.id).sort(),
      ["synova-dev-workbench", "synova-governance-line", "synova-project-overview"]
    );
    assert.deepEqual(
      cells.map((r) => r.options.key).sort(),
      entries.map((r) => r.options.id).sort(),
      "入口 id 集合必须与 main key 集合逐个对应"
    );
    for (const e of entries) {
      assert.equal(typeof e.options.order, "number", e.options.id + " 必须有数字 order");
      assert.equal(typeof e.options.label, "string", e.options.id + " 必须有 label");
      const cell = cells.find((c) => c.options.key === e.options.id);
      assert.ok(cell, "入口 " + e.options.id + " 必须有配对的 main cell");
      // 先注册 main 再注册入口行（避免点击瞬间 main 尚未就绪）
      assert.ok(
        p.registrations.indexOf(cell) < p.registrations.indexOf(e),
        e.options.id + "：main cell 必须先于入口行注册"
      );
    }
    // 治理线与开发工作台必须是两个**不同**入口（创始人 2026-09-28：物理分离）
    const wb = entries.find((r) => r.options.id === "synova-dev-workbench");
    const gov = entries.find((r) => r.options.id === "synova-governance-line");
    assert.notEqual(wb.options.id, gov.options.id, "治理线必须与开发工作台物理分离");
    assert.notEqual(wb.options.order, gov.options.order, "两个入口不得占用同一 order（避免并列叠压）");
    // 入口唯一（创始人要求）：右栏 shell.overlay 必须不再注册
    assert.equal(
      p.registrations.filter((r) => r.options && r.options.name === "shell.overlay").length,
      0,
      "右栏已并入中央面板，不得再注册 shell.overlay"
    );
    // 除这两个槽位外不得注册任何其它槽位
    const names = p.registrations.filter((r) => r.options).map((r) => r.options.name).sort();
    assert.deepEqual(names, ["main", "main", "main", "sidebar.panellist", "sidebar.panellist", "sidebar.panellist"], "只允许注册 main + sidebar.panellist 两个槽位");
  } finally {
    p.restore();
  }
});

test("正常路径：账本数据 → 三数 / 26 线 / 阻塞 / 时间轴占位 全部渲染", async () => {
  const p = loadPlugin();
  try {
    const text = await p.render(LEDGER_OK);
    assert.match(text, /项目总览/);
    assert.match(text, /交付度 · V1 断言 5\/125/);
    assert.match(text, /验证率 · K3 已复核 2\/5/);
    assert.match(text, /保鲜红灯 · 🟢3 🟡1/);
    assert.match(text, /阻塞数/);
    // 26 线总览
    assert.match(text, /26 线总览/);
    assert.match(text, /桌面端/);
    assert.match(text, /V1 3\/5/);
    assert.match(text, /阻塞 1/);
    // 阻塞清单
    assert.match(text, /等 Win 真机/);
    assert.match(text, /已卡 2 天/);
    assert.match(text, /需要 Win 机器/);
    // 取数来源标注（验收 b）
    assert.match(text, /源 worktree/);
    // 执行看板区（并入原右栏「任务」页签）—— 本夹具无 tasks，断言显式空态
    assert.match(text, /执行看板/);
    assert.match(text, /ledger 无 tasks 数据（待 D795）/);
    // 健康区（并入原右栏「健康」页签）
    assert.match(text, /健康/);
    assert.match(text, /真绕过（detected-bypass）/);
    assert.match(text, /门禁拒绝（BLOCKED）/);
    // 时间轴占位（ledger 无 timeline → 显式文案，不得空白）
    assert.match(text, /待数据（D795）/);
    // 无硬降级横幅（⚠ 降级：）
    assert.doesNotMatch(text, /⚠ 降级：/);
  } finally {
    p.restore();
  }
});

test("降级① 路由级：ok:false → 显式 degraded 文案，不白屏不抛错", async () => {
  const p = loadPlugin();
  try {
    const text = await p.render({ ok: false, degraded: true, error: "ledger 尚未产出：docs/synova/project/ledger.json 不存在（等 D795 派生器）" });
    assert.match(text, /⚠ 降级：/);
    assert.match(text, /ledger 尚未产出/);
    assert.match(text, /面板仍可用/);
    // 结构仍在：四区块不消失，只是无数值
    assert.match(text, /交付度/);
    assert.match(text, /26 线总览/);
    assert.match(text, /阻塞清单/);
    assert.match(text, /待数据（D795）/);
    assert.match(text, /ledger 无 lines 数据/);
  } finally {
    p.restore();
  }
});

test("降级② 网络/HTTP 失败 → error 横幅，不抛错", async () => {
  const p = loadPlugin();
  try {
    const text = await p.render({}, { fetchThrows: "Failed to fetch" });
    assert.match(text, /⚠ 降级：Failed to fetch/);
    assert.match(text, /项目总览/);
  } finally {
    p.restore();
  }
});

test("降级③ ledger 内部分降级：degraded:true + degraded_sources → 警告条列出源", async () => {
  const p = loadPlugin();
  try {
    const text = await p.render(Object.assign({}, LEDGER_OK, {
      degraded: true,
      degraded_sources: ["docs/synova/product-lines/product-lines.yaml", "scripts/golden-scenarios/evidence"],
    }));
    assert.match(text, /部分数据源降级/);
    assert.match(text, /product-lines\.yaml/);
    assert.match(text, /golden-scenarios\/evidence/);
    // 部分降级 ≠ 路由降级：不应出现硬降级横幅（⚠ 降级：）
    assert.doesNotMatch(text, /⚠ 降级：/);
  } finally {
    p.restore();
  }
});

test("边界：空 lines/blocked/timeline → 各区块给显式空态文案，不崩", async () => {
  const p = loadPlugin();
  try {
    const text = await p.render({ schema: "project-ledger/1", degraded: false, totals: { v1_total: 125, v1_passed: 0, v1_verified: 0, freshness: { green: 0, yellow: 0, red: 0 }, blocked_count: 0 }, lines: [], blocked: [], timeline: [] });
    assert.match(text, /ledger 无 lines 数据（待 D795）/);
    assert.match(text, /无阻塞（blocked 为空）/);
    assert.match(text, /待数据（D795）/);
  } finally {
    p.restore();
  }
});

test("零写入：面板只发 GET /synova/pm/ledger，无任何写方法", async () => {
  const p = loadPlugin();
  try {
    await p.render(LEDGER_OK);
    assert.ok(p.fetchCalls.length > 0, "必须真的请求数据");
    const urls = p.fetchCalls.map((c) => c.url).sort();
    assert.deepEqual(urls, ["/synova/dashboards/data", "/synova/pm/ledger"], "只允许这两条只读路由");
    for (const c of p.fetchCalls) {
      const method = (c.options && c.options.method) || "GET";
      assert.equal(method, "GET");
      assert.equal(c.options && c.options.cache, "no-store");
    }
  } finally {
    p.restore();
  }
});

test("返回会话：面板头部 onBack 走 layout.selectPanel(null)（恢复会话，不改当前 Session）", () => {
  const p = loadPlugin();
  try {
    const cell = p.registrations.find((r) => r.options && r.options.name === "main");
    assert.equal(typeof cell.component, "function", "main cell 必须注册为组件工厂");
    const el = cell.component({});
    assert.ok(el && el.props, "main cell 必须返回可渲染元素");
    assert.equal(typeof el.props.onBack, "function", "面板必须拿到 onBack 回调");
    // 未点击前不应改变布局选中态
    assert.deepEqual(p.panelSelections, []);
    el.props.onBack();
    // 官方契约：null = 显示 Conversation（不改变当前 Session）
    assert.deepEqual(p.panelSelections, [null]);
  } finally {
    p.restore();
  }
});

test("取数来源：source=origin/main（git 权威回退）→ 面板显式标出，不伪装成工作区", async () => {
  const p = loadPlugin();
  try {
    const text = await p.render(Object.assign({}, LEDGER_OK, {
      source: "origin/main",
      source_detail: "工作区无 docs/synova/project/ledger.json；已回退 git 权威 origin/main",
    }));
    assert.match(text, /源 origin\/main/);
    assert.doesNotMatch(text, /源 worktree/);
    // 回退仍须出数：三数照常渲染
    assert.match(text, /交付度 · V1 断言 5\/125/);
  } finally {
    p.restore();
  }
});

test("健康区降级可见：健康路由失败 → 该区显式降级文案，账本区不受影响", async () => {
  const p = loadPlugin();
  try {
    const text = await p.render(LEDGER_OK, { dashThrows: "Failed to fetch health" });
    assert.match(text, /健康区降级：/);
    assert.match(text, /Failed to fetch health/);
    // 账本区照常可用（各自独立降级，铁律 31）
    assert.match(text, /交付度 · V1 断言 5\/125/);
    assert.match(text, /26 线总览/);
    assert.doesNotMatch(text, /⚠ 降级：/, "账本未降级，不应出现硬降级横幅");
  } finally {
    p.restore();
  }
});

test("健康区降级可见：health.ok=false → 显示其 error，不白屏", async () => {
  const p = loadPlugin();
  try {
    const text = await p.render(LEDGER_OK, {
      dash: { meta: {}, health: { ok: false, degraded: true, error: "AUDIT-FINDINGS-LEDGER.md 缺失" } },
    });
    assert.match(text, /健康区降级：/);
    assert.match(text, /AUDIT-FINDINGS-LEDGER\.md 缺失/);
  } finally {
    p.restore();
  }
});

test("执行看板：ledger.tasks → D#/状态/owner/停滞天数 全渲染，按停滞降序", async () => {
  const p = loadPlugin();
  try {
    const text = await p.render(Object.assign({}, LEDGER_OK, {
      tasks: [
        { id: "D1", title: "久拖未决", status: "claimed", owner: "mac-coding", stale_days: 30, updated_at: "2026-08-18" },
        { id: "D2", title: "刚开工", status: "impl_done", owner: "create-mode", stale_days: 1, updated_at: "2026-09-16" },
      ],
    }));
    assert.match(text, /执行看板/);
    assert.match(text, /2 个任务/);
    assert.match(text, /D1/);
    assert.match(text, /mac-coding · 停滞 30 天/);
    assert.match(text, /D2/);
    assert.match(text, /create-mode · 停滞 1 天/);
    // 状态分布标签（原右栏 statusText 复用）
    assert.match(text, /已认领 1/);
    assert.match(text, /实现完成 1/);
    // 停滞降序：D1 先于 D2
    assert.ok(text.indexOf("D1") < text.indexOf("D2"), "必须按停滞天数降序");
  } finally {
    p.restore();
  }
});

test("执行看板空态：ledger 无 tasks → 显式文案，不空白", async () => {
  const p = loadPlugin();
  try {
    const text = await p.render(LEDGER_OK);
    assert.match(text, /ledger 无 tasks 数据（待 D795）/);
  } finally {
    p.restore();
  }
});

test("尺寸/位置记忆：localStorage 几何生效；拖动/缩放写回且被夹在 min~视口-32 内", async () => {
  const p = loadPlugin({ storage: { "synova.pm.panel.v1": JSON.stringify({ left: 123, top: 45, width: 900, height: 640 }) } });
  try {
    const r = await p.renderDetailed(LEDGER_OK);
    assert.equal(r.rootClassName, "spo-root");
    // 记忆的几何必须原样生效（刷新后保持的前提）
    assert.equal(r.rootStyle.left, "123px");
    assert.equal(r.rootStyle.top, "45px");
    assert.equal(r.rootStyle.width, "900px");
    assert.equal(r.rootStyle.height, "640px");

    const grip = r.nodes.find((n) => n.className.includes("spo-grip"));
    assert.ok(grip, "标题栏必须作为拖拽区存在");
    for (const h of ["onPointerDown", "onPointerMove", "onPointerUp"]) {
      assert.ok(grip.handlers.includes(h), "标题栏必须挂 " + h);
    }
    const cap = { setPointerCapture() {} };
    grip.props.onPointerDown({ clientX: 200, clientY: 100, pointerId: 1, currentTarget: cap });
    grip.props.onPointerMove({ clientX: 260, clientY: 130 }); // +60 / +30
    grip.props.onPointerUp({});
    let saved = JSON.parse(p.storageWrites[p.storageWrites.length - 1].value);
    assert.equal(saved.left, 183, "拖动位移必须落到 localStorage");
    assert.equal(saved.top, 75);
    assert.equal(saved.width, 900, "拖动不得改变尺寸");

    // 越界拖动 → 夹回视口内（视口 1400×900）
    grip.props.onPointerDown({ clientX: 0, clientY: 0, pointerId: 1, currentTarget: cap });
    grip.props.onPointerMove({ clientX: 99999, clientY: 99999 });
    grip.props.onPointerUp({});
    saved = JSON.parse(p.storageWrites[p.storageWrites.length - 1].value);
    assert.equal(saved.left, 1400 - 900);
    assert.equal(saved.top, 900 - 640);

    // 缩放：min 720×480
    const handle = r.nodes.find((n) => n.className.includes("spo-resize"));
    assert.ok(handle, "右下角必须有 resize 手柄");
    for (const h of ["onPointerDown", "onPointerMove", "onPointerUp"]) {
      assert.ok(handle.handlers.includes(h), "手柄必须挂 " + h);
    }
    handle.props.onPointerDown({ clientX: 0, clientY: 0, pointerId: 2, currentTarget: cap });
    handle.props.onPointerMove({ clientX: -9999, clientY: -9999 });
    handle.props.onPointerUp({});
    saved = JSON.parse(p.storageWrites[p.storageWrites.length - 1].value);
    assert.equal(saved.width, 720, "min 宽 720");
    assert.equal(saved.height, 480, "min 高 480");

    // 缩放：max 视口-32
    handle.props.onPointerDown({ clientX: 0, clientY: 0, pointerId: 3, currentTarget: cap });
    handle.props.onPointerMove({ clientX: 99999, clientY: 99999 });
    handle.props.onPointerUp({});
    saved = JSON.parse(p.storageWrites[p.storageWrites.length - 1].value);
    assert.equal(saved.width, 1400 - 32);
    assert.equal(saved.height, 900 - 32);
  } finally {
    p.restore();
  }
});

test("折叠记忆：折叠态来自 localStorage、开关写回、区块之间互不影响", async () => {
  const p = loadPlugin({ storage: { "synova.pm.collapse.v1": JSON.stringify({ lines: true, health: true }) } });
  try {
    const r = await p.renderDetailed(LEDGER_OK);
    // 标题始终在（折叠只隐藏内容）
    assert.match(r.text, /26 线总览/);
    assert.match(r.text, /健康/);
    // 折叠的区块内容不渲染
    assert.doesNotMatch(r.text, /V1 3\/5/, "折叠后不得渲染 26 线明细");
    assert.doesNotMatch(r.text, /真绕过（detected-bypass）/, "折叠后不得渲染健康区数值");
    // 未折叠的区块照常渲染
    assert.match(r.text, /执行看板/);
    assert.match(r.text, /时间轴/);

    const folds = r.nodes.filter((n) => n.className.includes("spo-fold"));
    assert.equal(folds.length, 5, "五个区块各有一个折叠开关");
    const byId = {};
    for (const f of folds) byId[f.props["data-section"]] = f;
    assert.deepEqual(Object.keys(byId).sort(), ["blocked", "health", "lines", "tasks", "timeline"]);
    assert.equal(byId.lines.props["aria-expanded"], "false", "记忆里折叠的区块必须收起");
    assert.equal(byId.health.props["aria-expanded"], "false");
    assert.equal(byId.tasks.props["aria-expanded"], "true", "未记忆的区块必须展开");
    assert.equal(byId.timeline.props["aria-expanded"], "true");
    assert.equal(byId.lines.props.children, "▸", "收起态图标 ▸");
    assert.equal(byId.tasks.props.children, "▾", "展开态图标 ▾");

    // 点击「时间轴」开关 → 写回，且保留其它区块既有折叠态
    byId.timeline.props.onClick();
    const saved = JSON.parse(p.storageWrites[p.storageWrites.length - 1].value);
    assert.equal(saved.timeline, true, "本次点击必须写回");
    assert.equal(saved.lines, true, "其它区块折叠态必须保留");
    assert.equal(saved.health, true);
  } finally {
    p.restore();
  }
});

test("修裁切/重叠：子项 flex:none、列表自带滚动、区块是 .spo-body 直接子项、断言默认收起", async () => {
  const p = loadPlugin();
  try {
    const css = p.css();
    assert.match(css, /\.spo-body>\*\{flex:none\}/, "根因修复：子项不得被 flex 压缩");
    assert.match(css, /\.spo-sec\{flex:none\}/);
    assert.match(css, /\.spo-list\{max-height:40vh;overflow-y:auto\}/, "列表类区块必须自带滚动");
    assert.match(css, /\.spo-root\{position:fixed/, "浮动定位是拖动/缩放的前提");

    const r = await p.renderDetailed(LEDGER_OK);
    const secs = r.nodes.filter((n) => n.className === "spo-sec");
    assert.ok(secs.length >= 5, "五个区块都在场，实际 " + secs.length);
    assert.ok(
      secs.every((s) => s.parentClass === "spo-body"),
      "区块必须是 .spo-body 的直接子项，flex:none 规则才命中"
    );
    const lists = r.nodes.filter((n) => (n.className || "").includes("spo-list"));
    assert.ok(lists.length >= 4, "列表类区块必须有 .spo-list 容器，实际 " + lists.length);
    assert.equal(
      r.nodes.filter((n) => (n.className || "").includes("spo-detail")).length,
      0,
      "断言明细默认必须收起"
    );
    const row = r.nodes.find((n) => n.className === "spo-line");
    assert.ok(row, "26 线必须渲染出行");
    assert.ok(row.handlers.includes("onClick"), "行必须可点击展开断言明细");
  } finally {
    p.restore();
  }
});

// ══ D1060：面板 A「Synova 开发工作台」/ 面板 B「治理线」══════════════════════════
// 契约：① 四问格子矩阵四色显式，空格必须 ⚪未填（绝不伪装成绿，X27）
//       ② 降级分两级（路由级 ok:false / payload 级 degraded）——都必须显式可见
//       ③ 治理线是**独立面板**（独立 key + 独立路由），不吃格子数据
/** 工作台夹具：2 行 × 2 问，四色齐全 + 一个空格（覆盖全部渲染分支）。 */
const WB_OK = {
  ok: true, degraded: false, degraded_sources: [],
  generated_at: "2026-09-29T01:20:00+08:00",
  grid: {
    ok: true, source: "worktree", path: "docs/synova/coordination/宪章三问-48格.json",
    schema: "charter-three-questions/1.0",
    rules: { empty_is_not_green: "空格必须显式报红/待办，不得默认绿" },
    counts: { cells: 8, ext_points: 2, questions: 2, filled: 3 },
    derived: { cells: 8, rows: 2, questions: 2, filled: 3, by_status: { green: 1, yellow: 1, red: 1, empty: 5, unknown: 0 }, unknown_statuses: [] },
    questions: [
      { code: "q1", text: "加了吗", desc: "存在性" },
      { code: "q2", text: "接上了吗", desc: "接线" }
    ],
    rows: [
      { layer: "对象层", ext_point: "节点（要素）", priority: "P1", cells: {
        q1: { id: "C01", status: "green", label: "🟢 生效了", judgement: "穿入口用例通过", command: "node t.js", owner: "mac", updated_at: "2026-09-28" },
        q2: { id: "C02", status: "empty", label: "⚪ 未填", judgement: "", command: "", owner: "", updated_at: "" }
      } },
      { layer: "判据层", ext_point: "阈值", priority: "P1", cells: {
        q1: { id: "C03", status: "yellow", label: "🟡 接了但没生效", judgement: "注册了没被消费", command: "", owner: "", updated_at: "" },
        q2: { id: "C04", status: "red", label: "🔴 缺失", judgement: "无生产调用点", command: "", owner: "", updated_at: "" }
      } }
    ]
  },
  flow: {
    ok: true, degraded: false, generated_at: "2026-09-29T01:20:00+08:00",
    git: {
      ok: true, degraded: false,
      today: { ok: true, since: "2026-09-29T00:00:00+08:00", commits: [
        { hash: "abc12345", date: "2026-09-29T01:01:49+08:00", author: "tangbaobao520", subject: "merge(D1060): 并入前置" }
      ], capped: false },
      week: { ok: true, since: "2026-09-28T00:00:00+08:00", commits: [
        { hash: "abc12345", date: "2026-09-29T01:01:49+08:00", author: "tangbaobao520", subject: "merge(D1060): 并入前置" },
        { hash: "def67890", date: "2026-09-28T09:25:13+08:00", author: "tangbaobao520", subject: "docs: B2 出库" }
      ], capped: false }
    },
    pr: {
      ok: true, source: "api", slug: "tangbaobao520/SynovaAgent", partial: false, attempts: [],
      open: [{ number: 880, title: "feat(D1059): 宪章格子升四问", user: "x", draft: false, created_at: "2026-09-28T16:48:00Z" }],
      merged_week: [{ number: 876, title: "docs: B2 出库", user: "x", draft: false, merged_at: "2026-09-28T09:25:13Z" }],
      counts: { open: 30, open_today: 2, open_week: 10, merged_today: 0, merged_week: 3 }
    }
  },
  decisions: {
    ok: true, source: "docs/synova/product-lines/product-progress.json#decisions",
    upstream_source: "docs/synova/product-lines/cockpit-override.yaml#pending_decisions",
    generated_at: "2026-09-28 15:51:09",
    pending: [{ id: "D-9", title: "告警去重窗口用多久？", context: "太长漏变化，太短打扰", suggestion: { label: "5 分钟", reason: "监测最细是周级" }, status: "pending", raised_date: "2026-09-20", waiting_days: 9, waiting_unknown: false }],
    pending_count: 1, resolved_count: 2, resolved: [],
    card_scan: [{ id: "D811", title: "队列收口", status: "impl_done", updated_at: "2026-09-20", waiting_days: 9, excerpt: "本卡不关闭任何 PR（需创始人签字或 token）" }],
    card_scan_count: 1
  },
  blocked: {
    ok: true, degraded: false, sources: ["docs/synova/project/ledger.json"], count: 1,
    rule: "三要素 {reason, since, needs} 齐全才计入阻塞",
    items: [{ id: "D812", reason: "前置 #574 未合入", since: "2026-09-18", needs: "D778 合入", days: 11, line: 4, source: "docs/synova/project/ledger.json" }],
    nonconforming: [{ id: "D935", status: "claimed", kind: "字符串备注", note: "已解除。开工前 M2 扫描发现写集重叠", updated_at: "2026-09-27", days: 2 }],
    nonconforming_count: 1
  }
};
/** 治理线夹具（与格子无关的独立载荷）。 */
const GOV_OK = {
  ok: true, degraded: false, degraded_sources: [],
  generated_at: "2026-09-29T01:20:00+08:00",
  scope: { rule: "治理线 = ① domain=doc-governance ② 标题以 CT- 开头 ③ 标题/里程碑含 治理|门禁|控制塔", signals: { "标题以 CT- 开头": 6 } },
  cards: {
    ok: true, filter_note: "「服务哪条主线」只认卡面显式字段或文本里的『线 N』；没有就显示『—（卡面未声明）』",
    active: [
      { id: "D1014", title: "N12 根治 ci.yml concurrency", status: "impl_done", domain: "mac", domain_label: "mac", signals: ["标题/里程碑含 治理|门禁|控制塔"], serves: "线 3、线 8", serves_source: "卡面文本抽取", milestone: null, updated_at: "2026-09-26", waiting_days: 3 },
      { id: "D513", title: "控制塔四项返修", status: "impl_done", domain: null, domain_label: "—（卡面未声明）", signals: ["标题/里程碑含 治理|门禁|控制塔"], serves: null, serves_source: "卡面未声明", milestone: null, updated_at: "2026-08-29", waiting_days: 31 }
    ],
    resting: [{ id: "D387", title: "CT-34 纯文档提交豁免门禁", status: "audited", domain: "mac", domain_label: "mac", signals: ["标题以 CT- 开头"], serves: "线 1", serves_source: "卡面文本抽取", updated_at: "2026-08-20", waiting_days: 40 }],
    count: 3, active_count: 2, resting_count: 1, by_domain: { mac: 2, "—（卡面未声明）": 1 }, read_errors: [], read_error_count: 0
  },
  debt: {
    ok: true, degraded: false, source: "docs/synova/coordination/board-backlog.json",
    schema_version: 1, items: [{ id: "PLAN-vitest-typecheck", title: "流程盲区强化：vitest 类型检查", note: "等编码 session 完成 D500" }],
    count: 1, todos_yaml_note: "docs/synova/product-lines/todos.yaml（T-* 待办）未消费：插件零依赖，不引 YAML 解析器；该源由 task-board-adapter 的 Python 派生器消费"
  }
};

test("D1060 面板 A：四问格子矩阵渲染 16 行 × N 问，四色显式，空格显式 ⚪未填", async () => {
  const p = loadPlugin();
  try {
    const r = await p.renderDetailed(null, { panelKey: "synova-dev-workbench" });
    assert.match(r.text, /Synova 开发工作台/, "面板标题必须在场");
    assert.match(r.text, /① 四问格子矩阵（16 行 × 4 问）/, "格子区块标题");
    // 表头两问（夹具 2 问）
    assert.match(r.text, /加了吗/);
    assert.match(r.text, /接上了吗/);
    // 四色逐一在场
    assert.match(r.text, /🟢 生效了/);
    assert.match(r.text, /🟡 接了没生效/);
    assert.match(r.text, /🔴 缺失/);
    assert.match(r.text, /⚪ 未填/);
    // 空格必须显式待办
    assert.match(r.text, /待办 · 未填判据/);
    // 16 行 × 4 问是数据源口径，夹具是 2×2 —— 图例必须报实数（禁手写数字）
    assert.match(r.text, /已填 3\/8/);
    assert.match(r.text, /⚪ 未填 5/);
    // 表格结构：thead 一行 + tbody 两行
    const trs = r.nodes.filter((n) => n.tag === "tr");
    assert.equal(trs.length, 3, "1 表头行 + 2 数据行");
    const tds = r.nodes.filter((n) => n.tag === "td");
    assert.ok(tds.length >= 10, "每行 3 列固定 + 2 问格 → 至少 10 个 td，实际 " + tds.length);
    // 格子状态用 swb-<status> 类表达（四色 border-left）
    for (const st of ["swb-green", "swb-yellow", "swb-red", "swb-empty"]) {
      assert.ok(r.nodes.some((n) => (n.className || "").includes(st)), "缺状态类 " + st);
    }
  } finally {
    p.restore();
  }
});

test("D1060 面板 A：空格不得伪装成绿（把 empty 格改成 green 才允许出现绿）——X27", async () => {
  const p = loadPlugin();
  try {
    const onlyEmpty = JSON.parse(JSON.stringify(WB_OK));
    onlyEmpty.grid.rows = [onlyEmpty.grid.rows[0]];
    onlyEmpty.grid.rows[0].cells.q1 = { id: "C01", status: "empty", label: "⚪ 未填", judgement: "", command: "", owner: "", updated_at: "" };
    onlyEmpty.grid.derived.by_status = { green: 0, yellow: 0, red: 0, empty: 2, unknown: 0 };
    onlyEmpty.grid.derived.filled = 0;
    const r = await p.renderDetailed(null, { panelKey: "synova-dev-workbench", workbench: onlyEmpty });
    assert.match(r.text, /⚪ 未填/, "空格必须显示 ⚪未填");
    // 图例恒列四色（含计数），故不能整串否定绿；要否定的是**格子本身**带 green 态
    assert.equal(
      r.nodes.filter((n) => (n.className || "").includes("swb-cell") && (n.className || "").includes("swb-green")).length,
      0,
      "不得渲染任何 green 态格子（缺失≠通过）"
    );
    assert.match(r.text, /🟢 生效了 0/, "图例必须如实报 0 绿（禁手写数字）");
    assert.match(r.text, /已填 0\//, "已填计数必须为 0");
  } finally {
    p.restore();
  }
});

test("D1060 面板 A：payload 级 degraded → 显式警告条 + 逐源原因（不静默）", async () => {
  const p = loadPlugin();
  try {
    const degraded = JSON.parse(JSON.stringify(WB_OK));
    degraded.degraded = true;
    degraded.degraded_sources = ["宪章格子：工作区无 docs/synova/coordination/宪章三问-48格.json"];
    const r = await p.renderDetailed(null, { panelKey: "synova-dev-workbench", workbench: degraded });
    assert.match(r.text, /部分数据源降级/);
    assert.match(r.text, /宪章格子：工作区无/);
  } finally {
    p.restore();
  }
});

test("D1060 面板 A：路由级 ok:false → 整面板降级横幅，不白屏不抛错", async () => {
  const p = loadPlugin();
  try {
    const r = await p.renderDetailed(null, { panelKey: "synova-dev-workbench", workbenchThrows: "network down" });
    assert.match(r.text, /⚠ 降级：network down/);
    assert.match(r.text, /Synova 开发工作台/, "降级时标题栏仍在（不白屏）");
  } finally {
    p.restore();
  }
});

test("D1060 面板 A：区块级降级独立——格子不可读不影响流水/待裁/阻塞渲染", async () => {
  const p = loadPlugin();
  try {
    const partial = JSON.parse(JSON.stringify(WB_OK));
    partial.grid = { ok: false, degraded: true, error: "工作区无宪章 JSON；origin/main 取数失败", rows: [], questions: [], counts: null };
    partial.degraded = true;
    partial.degraded_sources = ["宪章格子：工作区无宪章 JSON"];
    const r = await p.renderDetailed(null, { panelKey: "synova-dev-workbench", workbench: partial });
    assert.match(r.text, /降级：宪章格子不可读/);
    assert.match(r.text, /今日提交 1/, "流水仍渲染");
    assert.match(r.text, /告警去重窗口用多久/, "待裁仍渲染");
    assert.match(r.text, /前置 #574 未合入/, "阻塞仍渲染");
  } finally {
    p.restore();
  }
});

test("D1060 面板 A：待你裁渲染 一句话 + 我的倾向 + 等待天数；卡面扫描单列", async () => {
  const p = loadPlugin();
  try {
    const r = await p.renderDetailed(null, { panelKey: "synova-dev-workbench" });
    assert.match(r.text, /③ 待你裁/);
    assert.match(r.text, /告警去重窗口用多久？/);
    assert.match(r.text, /我的倾向：5 分钟/);
    assert.match(r.text, /等待 9 天/);
    assert.match(r.text, /卡面文本扫描「需创始人」 1 条/);
    assert.match(r.text, /D811/);
  } finally {
    p.restore();
  }
});

test("D1060 面板 A：阻塞渲染 卡在哪 + 卡了几天；未申报单列且不计入", async () => {
  const p = loadPlugin();
  try {
    const r = await p.renderDetailed(null, { panelKey: "synova-dev-workbench" });
    assert.match(r.text, /④ 阻塞/);
    assert.match(r.text, /前置 #574 未合入/);
    assert.match(r.text, /已卡 11 天/);
    assert.match(r.text, /需要 D778 合入/);
    assert.match(r.text, /计入 1 · 未申报 1/);
    assert.match(r.text, /卡面 blocked 备注未按三要素申报 1 条/);
  } finally {
    p.restore();
  }
});

test("D1060 面板 B：治理线是独立面板——只吃治理路由，不吃格子数据", async () => {
  const p = loadPlugin();
  try {
    const r = await p.renderDetailed(null, { panelKey: "synova-governance-line" });
    assert.match(r.text, /治理线/, "面板标题");
    assert.match(r.text, /面板 B/, "面板标识");
    // 治理卡五要素
    assert.match(r.text, /D1014/);
    assert.match(r.text, /mac/, "域");
    assert.match(r.text, /impl_done/, "状态");
    assert.match(r.text, /服务 线 3、线 8/, "服务哪条主线");
    assert.match(r.text, /等待 3 天/);
    // 未声明 → 显式留白，不猜
    assert.match(r.text, /—（卡面未声明）/);
    assert.match(r.text, /只认卡面显式字段或文本里的『线 N』/);
    // 口径随数据一起展示
    assert.match(r.text, /治理线 = ① domain=doc-governance/);
    // 物理分离：治理面板**不得**出现格子矩阵区块
    assert.doesNotMatch(r.text, /四问格子矩阵/, "治理面板必须与格子物理分离");
    // 只请求治理路由
    assert.ok(
      p.fetchCalls.every((c) => String(c.url).includes("/synova/governance/data")),
      "治理面板只应请求治理路由，实际：" + p.fetchCalls.map((c) => c.url).join(",")
    );
  } finally {
    p.restore();
  }
});

test("D1060 面板 B：活卡/全部筛选按钮切换（活卡 2 / 全部 3）", async () => {
  const p = loadPlugin();
  try {
    const r = await p.renderDetailed(null, { panelKey: "synova-governance-line" });
    const btns = r.nodes.filter((n) => (n.className || "").includes("swb-filterBtn"));
    assert.equal(btns.length, 2, "两个筛选按钮");
    assert.match(r.text, /活卡 2/);
    assert.match(r.text, /全部 3/);
    // 默认只列活卡：终态卡 D387 不在场
    assert.doesNotMatch(r.text, /CT-34 纯文档提交豁免门禁/, "默认只看活卡");
  } finally {
    p.restore();
  }
});

test("D1060 面板 B：欠账表渲染 + todos.yaml 未消费原因显式声明（不静默漏源）", async () => {
  const p = loadPlugin();
  try {
    const r = await p.renderDetailed(null, { panelKey: "synova-governance-line" });
    assert.match(r.text, /欠账 \/ 待规划（board-backlog.json）/);
    assert.match(r.text, /PLAN-vitest-typecheck/);
    assert.match(r.text, /todos\.yaml（T-\* 待办）未消费：插件零依赖/);
  } finally {
    p.restore();
  }
});

test("D1060 面板 B：治理路由失败 → 显式降级横幅（不静默无面板）", async () => {
  const p = loadPlugin();
  try {
    const r = await p.renderDetailed(null, { panelKey: "synova-governance-line", governanceThrows: "boom" });
    assert.match(r.text, /⚠ 降级：boom/);
    assert.match(r.text, /治理线/);
  } finally {
    p.restore();
  }
});

test("D1060 三面板互不干扰：渲染工作台不请求治理路由，反之亦然", async () => {
  const p = loadPlugin();
  try {
    await p.render(null, { panelKey: "synova-dev-workbench" });
    assert.ok(p.fetchCalls.every((c) => String(c.url).includes("/synova/workbench/data")), "工作台只请求工作台路由");
    p.fetchCalls.length = 0;
    await p.render(null, { panelKey: "synova-governance-line" });
    assert.ok(p.fetchCalls.every((c) => String(c.url).includes("/synova/governance/data")), "治理线只请求治理路由");
  } finally {
    p.restore();
  }
});

test("D1060 零写入：三面板全程只发 GET，不触碰任何写接口", async () => {
  const p = loadPlugin();
  try {
    await p.render(null, { panelKey: "synova-dev-workbench" });
    await p.render(null, { panelKey: "synova-governance-line" });
    for (const c of p.fetchCalls) {
      const method = String(c.options && c.options.method ? c.options.method : "GET").toUpperCase();
      assert.equal(method, "GET", "只允许 GET：" + c.url);
      assert.match(String(c.url), /^\/synova\/(workbench|governance)\/data$/, "只允许两条只读路由");
    }
    // localStorage 只写几何/折叠偏好（无业务数据落盘）
    assert.ok(
      p.storageWrites.every((k) => String(k).startsWith("synova.wb.") || String(k).startsWith("synova.gov.")),
      "localStorage 只允许几何/折叠键，实际：" + p.storageWrites.join(",")
    );
  } finally {
    p.restore();
  }
});

test("D1060 降级显式①：main 槽注册失败（slot 不存在/版本不足）→ 入口图标 ⚠ + console.error 留痕，不静默", () => {
  const p = loadPlugin({ failMainKeys: ["synova-dev-workbench"] });
  try {
    // main cell 未注册
    assert.equal(
      p.registrations.filter((r) => r.options && r.options.name === "main" && r.options.key === "synova-dev-workbench").length,
      0,
      "被注入失败的 main cell 不得出现在注册表"
    );
    // 但入口行仍在（否则用户完全看不到 = 静默消失）
    const entry = p.registrations.find((r) => r.options && r.options.name === "sidebar.panellist" && r.options.id === "synova-dev-workbench");
    assert.ok(entry, "入口行必须仍然注册，才能把降级显示出来");
    const node = entry.component({ size: 16 });
    assert.equal(node.props.children, "⚠", "main 未注册时入口必须显示 ⚠");
    assert.match(node.props.title, /降级：main 面板未注册/);
    assert.match(node.props.title, /控制台/);
    // 留痕（铁律 24：禁空吞）
    assert.ok(p.consoleErrors.some((e) => e.includes("槽位注册失败") && e.includes("synova-dev-workbench")), "必须 console.error：" + JSON.stringify(p.consoleErrors));
    assert.deepEqual(p.registrationDegraded, ["main/synova-dev-workbench：" + "slot 'main' 不存在（版本不足）"]);
    // 其余两对不受影响（降级按面板隔离）
    const govEntry = p.registrations.find((r) => r.options && r.options.name === "sidebar.panellist" && r.options.id === "synova-governance-line");
    const govIcon = govEntry.component({ size: 16 });
    assert.notEqual(govIcon.props ? govIcon.props.children : undefined, "⚠", "治理线图标不得被连带降级");
  } finally {
    p.restore();
  }
});

test("D1060 降级显式②：三对槽位全部注册成功时，诊断面为空数组（无假降级）", () => {
  const p = loadPlugin();
  try {
    assert.deepEqual(p.registrationDegraded, [], "正常路径不得报告任何注册降级");
    assert.deepEqual(p.consoleErrors, []);
    for (const id of ["synova-project-overview", "synova-dev-workbench", "synova-governance-line"]) {
      const entry = p.registrations.find((r) => r.options && r.options.name === "sidebar.panellist" && r.options.id === id);
      assert.ok(entry, id + " 入口必须注册");
      const node = entry.component({ size: 16 });
      assert.notEqual(node.props.children, "⚠", id + " 正常路径不得显示 ⚠");
      // 健康路径返回的是图标组件（type 为函数），文本是各面板字形
      const rendered = typeof node.type === "function" ? node.type(node.props) : node;
      assert.match(String(rendered.props.children), /📊|🧰|⚖️/);
    }
  } finally {
    p.restore();
  }
});

test("D1060 回归：入口图标字形必须在 props.children（jsx 第 3 参是 key 不是 children —— 真机曾取证到空 span）", () => {
  const p = loadPlugin();
  try {
    for (const [id, glyph] of [["synova-project-overview", "📊"], ["synova-dev-workbench", "🧰"], ["synova-governance-line", "⚖️"]]) {
      const entry = p.registrations.find((r) => r.options && r.options.name === "sidebar.panellist" && r.options.id === id);
      assert.ok(entry, id + " 入口必须注册");
      const node = entry.component({ size: 16 });
      const rendered = typeof node.type === "function" ? node.type(node.props) : node;
      assert.equal(rendered.props.children, glyph, id + " 字形必须落在 props.children（否则真机图标为空 span）");
    }
  } finally {
    p.restore();
  }
});
