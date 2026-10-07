// lib/client.js — @synova/dsh-dashboards Client 半（浏览器端「项目总览」中央面板）
// 以 __ModuleLoader__.load 工厂格式手写（无需构建）：factory 内 require 仅用
// 静态种子模块（react / react/jsx-runtime）。
//
// 挂载点（官方全局面板协议，两个槽位成对、id 相同）：
//   sidebar.panellist（root list） 入口行 —— { id, order, label }；组件是纯图标，收 { size, active }
//   main（root keyed）            中央面板 —— { key }；选中入口行时由 layout 派发到这里
//   零核心补丁、顺序无关；必须先注册 main 再注册入口行（未注册的 main key 会抛错）。
// 数据源（两条只读 GET，各自独立降级）：
//   /synova/pm/ledger        账本（三数 / 26 线 / 阻塞 / 执行看板 / 时间轴，含 source 标注）
//   /synova/dashboards/data  健康区（bypass 计数 / 提交失败 / M 模式）
// 实时性: 60s 轮询 + visibilitychange 回源 + 手动刷新。
// 入口唯一: D794 起右栏三仪表盘（shell.overlay）已并入本面板并删除，不再维护第二个入口。
window.__ModuleLoader__.load({
	id: "@synova/dsh-dashboards",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		const { useState, useEffect, useCallback } = react;
		const { jsx } = react_jsx_runtime;

		// ── 样式（主题变量随 DSH 主题走） ───────────────────────────────────────
		const CSS = [
			".spo-spin{width:12px;height:12px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-label-primary);border-radius:50%;animation:spo-spin .8s linear infinite}",
			"@keyframes spo-spin{to{transform:rotate(360deg)}}",
			// ── 「项目总览」中央面板（main keyed cell）——全部 spo- 前缀 ──
			// 高度策略：父容器有确定高度时 height:100% 生效；无确定高度时退回 min-height:60vh，
			// 两种情形都可用（不依赖 position:absolute，避免误覆盖整个 frame）。
			// 浮动面板：定位/尺寸由内联 style 驱动（拖动/缩放），见 PANEL_GEO_KEY
			".spo-root{position:fixed;z-index:40;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:var(--dsw-shadow-lv3,0 8px 32px rgba(0,0,0,.28))}",
			".spo-head{flex:none;display:flex;align-items:center;gap:8px;padding:12px 18px;border-bottom:1px solid var(--dsw-alias-border-l1)}",
			".spo-title{font-size:15px;font-weight:600;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
			".spo-body{flex:1;min-height:0;overflow-y:auto;padding:16px 18px;display:flex;flex-direction:column;gap:14px}",
			".spo-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}",
			".spo-stat{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:2px;min-width:0}",
			".spo-statNum{font-size:22px;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
			".spo-statLabel{font-size:11px;color:var(--dsw-alias-label-tertiary)}",
			".spo-sec{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;overflow:hidden}",
			".spo-secHead{display:flex;align-items:center;gap:8px;padding:8px 12px;font-size:12px;font-weight:600;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}",
			".spo-spacer{flex:1;min-width:0}",
			".spo-line{display:flex;align-items:center;gap:8px;padding:6px 12px;border-top:1px solid var(--dsw-alias-border-l1);cursor:pointer;font-size:12px}",
			".spo-line:hover{background:var(--dsw-alias-interactive-bg-hover)}",
			".spo-lineName{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}",
			".spo-dot{width:8px;height:8px;border-radius:50%;flex:none;display:inline-block}",
			".spo-dot-green{background:#16a34a}.spo-dot-yellow{background:#d97706}.spo-dot-red{background:#dc2626}.spo-dot-gray{background:#6b7280}",
			".spo-num{flex:none;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary)}",
			".spo-tag{flex:none;font-size:10px;font-weight:600;padding:1px 6px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-secondary)}",
			".spo-tag-red{background:#dc2626;color:#fff}",
			".spo-detail{padding:8px 12px 10px;border-top:1px solid var(--dsw-alias-border-l1);display:flex;flex-direction:column;gap:6px}",
			".spo-assert{display:flex;gap:8px;font-size:11px;line-height:16px;align-items:baseline}",
			".spo-assertMark{flex:none;font-weight:700}",
			".spo-ok{color:#16a34a}.spo-no{color:var(--dsw-alias-label-tertiary)}",
			".spo-assertText{flex:1;min-width:0;color:var(--dsw-alias-label-secondary)}",
			".spo-blocked{display:flex;flex-direction:column;gap:3px;padding:8px 12px;border-top:1px solid var(--dsw-alias-border-l1);font-size:12px}",
			".spo-blockedHead{display:flex;align-items:baseline;gap:8px;min-width:0}",
			".spo-blockedReason{flex:1;min-width:0;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".spo-muted{color:var(--dsw-alias-label-tertiary);font-size:11px}",
			".spo-empty{padding:14px 12px;color:var(--dsw-alias-label-tertiary);font-size:12px;text-align:center}",
			".spo-degraded{padding:9px 12px;border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}",
			".spo-warn{padding:8px 12px;border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#d97706) 14%,transparent);color:var(--dsw-alias-state-warn-primary,#d97706);font-size:11px;line-height:17px}",
			".spo-iconBtn{width:26px;height:26px;flex:none;border:none;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;display:grid;place-items:center;font-size:13px;line-height:1}",
			".spo-iconBtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
			// ── 修裁切/重叠根因：flex 子项默认 flex-shrink:1，长列表会把各区块压扁 → 显式 flex:none ──
			".spo-body>*{flex:none}",
			".spo-sec{flex:none}",
			// 列表类区块自身滚动（外层 .spo-body 仍保留滚动）
			".spo-list{max-height:40vh;overflow-y:auto}",
			// 拖动/缩放/折叠交互
			".spo-grip{cursor:grab;user-select:none;touch-action:none}",
			".spo-grip:active{cursor:grabbing}",
			".spo-resize{position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;touch-action:none;background:linear-gradient(135deg,transparent 0 55%,var(--dsw-alias-border-l3,#9ca3af) 55% 62%,transparent 62% 74%,var(--dsw-alias-border-l3,#9ca3af) 74% 81%,transparent 81%)}",
			".spo-fold{flex:none;width:18px;height:18px;padding:0;border:none;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:11px;line-height:1;display:grid;place-items:center}",
			".spo-fold:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
			".spo-stats3{grid-template-columns:repeat(3,1fr)}",
			".spo-tag-green{background:#16a34a;color:#fff}.spo-tag-amber{background:#d97706;color:#fff}.spo-tag-blue{background:#2563eb;color:#fff}.spo-tag-gray{background:#6b7280;color:#fff}",
			".spo-item{display:flex;align-items:center;gap:8px;padding:6px 12px;border-top:1px solid var(--dsw-alias-border-l1);font-size:12px;min-width:0}",
			".spo-itemTitle{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}",
			".spo-id{flex:none;font-size:10px;font-weight:700;padding:1px 6px;border-radius:6px;background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}",
			// ── D1060「开发工作台 / 治理线」——统一 swb- 前缀，与上述 spo- 互不干扰 ──
			// 四问格子矩阵：16 行 × 4 问；空格必须显式 ⚪未填（院方 X27：缺失≠通过）
			".swb-legend{display:flex;flex-wrap:wrap;gap:10px;padding:8px 12px;font-size:11px;color:var(--dsw-alias-label-secondary);border-top:1px solid var(--dsw-alias-border-l1)}",
			".swb-legendItem{display:flex;align-items:center;gap:5px}",
			".swb-chip{display:inline-block;width:10px;height:10px;border-radius:3px;flex:none}",
			".swb-gridWrap{overflow:auto;max-height:52vh}",
			".swb-grid{width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed}",
			".swb-grid th{position:sticky;top:0;z-index:1;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-weight:600;text-align:left;padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);white-space:nowrap}",
			".swb-grid td{padding:0;border-bottom:1px solid var(--dsw-alias-border-l1);vertical-align:top}",
			".swb-layer{color:var(--dsw-alias-label-tertiary);font-size:10px;white-space:nowrap;padding:6px 8px}",
			".swb-ext{padding:6px 8px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".swb-pri{width:44px;text-align:center;color:var(--dsw-alias-label-tertiary);padding:6px 4px}",
			".swb-cell{padding:5px 7px;line-height:15px;min-height:30px;border-left:4px solid transparent}",
			".swb-cellTop{display:block;font-weight:600;white-space:nowrap}",
			".swb-cellSub{display:block;color:var(--dsw-alias-label-tertiary);font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".swb-green{border-left-color:#0a7d32}.swb-yellow{border-left-color:#b8860b}.swb-red{border-left-color:#b3261e}.swb-empty{border-left-color:#6b7280;background:color-mix(in srgb,#6b7280 8%,transparent)}.swb-unknown{border-left-color:#7c3aed;background:color-mix(in srgb,#7c3aed 10%,transparent)}",
			".swb-kv{display:flex;gap:8px;padding:5px 12px;border-top:1px solid var(--dsw-alias-border-l1);font-size:11px;align-items:baseline}",
			".swb-kvKey{flex:none;width:56px;color:var(--dsw-alias-label-tertiary)}",
			".swb-kvVal{flex:1;min-width:0;color:var(--dsw-alias-label-secondary);word-break:break-word}",
			".swb-flow{display:grid;grid-template-columns:1fr 1fr;gap:0}",
			".swb-flowCol{min-width:0;border-left:1px solid var(--dsw-alias-border-l1)}",
			".swb-flowCol:first-child{border-left:none}",
			".swb-flowHead{padding:6px 12px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover)}",
			".swb-pill{display:inline-block;font-size:10px;font-weight:600;padding:1px 6px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-secondary)}",
			".swb-pill-red{background:#dc2626;color:#fff}.swb-pill-green{background:#16a34a;color:#fff}.swb-pill-amber{background:#d97706;color:#fff}",
			".swb-scroll{max-height:26vh;overflow-y:auto}",
			".swb-srcTag{font-size:10px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}",
			".swb-filter{display:flex;gap:6px;padding:6px 12px;font-size:11px;align-items:center;border-top:1px solid var(--dsw-alias-border-l1)}",
			".swb-filterBtn{border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:999px;padding:2px 9px;font-size:11px;cursor:pointer}",
			".swb-filterBtn[data-on=\"1\"]{background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-primary);font-weight:600}"
		].join("");

		// ── 小工具 ─────────────────────────────────────────────────────────────
		function esc(s) {
			return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
		}
		function badgeFor(status) {
			const s = String(status ?? "").toLowerCase();
			if (/verified|done|completed|impl_done|closed|audited|green/.test(s)) return "green";
			if (/fail|rejected|blocked|red|p0/.test(s)) return "red";
			if (/pending|stale|warn|amber|audit|p1|claimed/.test(s)) return "amber";
			if (/spec|running|impl|in_progress|dispatched|blue/.test(s)) return "blue";
			return "gray";
		}
		/** status → .spo-tag-* 类名（颜色与 badgeFor 同源，供标签样式复用）。 */
		function tagClass(status) {
			return "spo-tag spo-tag-" + badgeFor(status);
		}
		function statusText(status) {
			const map = {
				impl_done: "实现完成", done: "已完成", completed: "已完成", closed: "已关闭",
				spec: "规格中", in_progress: "进行中", running: "进行中",
				audit: "审计中", audited: "已审计", pending_k3: "待K3", failed: "失败", rejected: "被拒",
				uncommitted: "未提交", stale: "过期", verified: "已验证",
				claimed: "已认领", dispatched: "已派单",
				unknown: "未知"
			};
			return map[String(status ?? "").toLowerCase()] ?? String(status ?? "");
		}

		// ── 「项目总览」中央面板（只读；两条 GET，各自独立降级） ──────────────────
		// 契约（铁律 47）：
		//   @input A GET /synova/pm/ledger
		//             成功 → 账本对象 + 顶层 source 字段（"worktree" | "origin/main"）
		//             降级 → { ok:false, degraded:true, error }   （路由级：工作区与 origin/main 都取不到）
		//   @input B GET /synova/dashboards/data（健康区，复用既有收集器，不新增第二真相源）
		//   @output 五区块：① 顶部四数 ② 26 线总览（可展开断言明细）③ 阻塞清单
		//                   ④ 执行看板（ledger.tasks：D#/状态/owner/停滞天数）
		//                   ⑤ 健康（bypass 计数 / 提交失败 / M 模式）⑥ 时间轴
		//   @degraded 四态，均显式呈现、不白屏、不抛错（铁律 24/31）：
		//             ① 网络/HTTP 失败    → error 横幅
		//             ② 路由级 ok:false   → degraded 横幅（工作区与 origin/main 都无账本时的正常态）
		//             ③ 账本级 degraded   → 部分降级警告 + degraded_sources 列表
		//             ④ 健康路由失败/ok:false → 健康区独立降级文案（不影响其余区块）
		//   @write  零写入：只 GET，不写工作区/仓库/localStorage（D794 红线）
		const LEDGER_URL = "/synova/pm/ledger";
		const DASH_URL = "/synova/dashboards/data";

		function pct1(n, d) {
			if (!d || d <= 0) return null;
			return Math.round((Number(n) || 0) / d * 1000) / 10;
		}
		function freshColor(f) {
			if (!f) return "gray";
			if ((f.red ?? 0) > 0) return "red";
			if ((f.yellow ?? 0) > 0) return "yellow";
			if ((f.green ?? 0) > 0) return "green";
			return "gray";
		}
		function sumFresh(lines) {
			const acc = { green: 0, yellow: 0, red: 0 };
			for (const l of lines) {
				const f = l && l.freshness;
				if (!f) continue;
				acc.green += Number(f.green) || 0;
				acc.yellow += Number(f.yellow) || 0;
				acc.red += Number(f.red) || 0;
			}
			return acc;
		}
		function verifyText(v) {
			if (!v) return "";
			if (typeof v === "string") return v;
			return String(v.kind ?? v.type ?? JSON.stringify(v));
		}

		function StatCard({ num, label, tone }) {
			return jsx("div", { className: "spo-stat", children: [
				jsx("div", { className: "spo-statNum", style: tone ? { color: tone } : undefined, children: num }),
				jsx("div", { className: "spo-statLabel", children: label })
			] });
		}

		/**
		 * 区块外壳：统一「折叠开关(▸/▾) + 标题 + 右侧摘要 + 内容容器」。
		 * 内容容器默认 `.spo-list`（max-height:40vh + 自身滚动）——长列表不再把区块撑爆/裁切；
		 * 折叠后整块内容不渲染（省 DOM，也让「折叠」在测试里可断言）。
		 */
		function Section({ id, title, extra, collapsed, onToggle, children }) {
			return jsx("div", { className: "spo-sec", children: [
				jsx("div", { className: "spo-secHead", children: [
					jsx("button", {
						type: "button",
						className: "spo-fold",
						"data-section": id,
						"aria-expanded": collapsed ? "false" : "true",
						title: collapsed ? "展开" : "折叠",
						onClick: () => onToggle(id),
						children: collapsed ? "▸" : "▾"
					}),
					jsx("span", { children: title }),
					jsx("span", { className: "spo-spacer" }),
					extra ?? null
				] }),
				collapsed ? null : jsx("div", { className: "spo-list", children })
			] });
		}

		function LinesSection({ lines, collapsed, onToggle }) {
			const [openId, setOpenId] = useState(null);
			if (lines.length === 0) {
				return jsx(Section, { id: "lines", title: "26 线总览", collapsed, onToggle,
					children: jsx("div", { className: "spo-empty", children: "ledger 无 lines 数据（待 D795）" }) });
			}
			return jsx(Section, {
				id: "lines", title: "26 线总览", collapsed, onToggle,
				extra: jsx("span", { className: "spo-muted", children: lines.length + " 条线 · 点行看断言明细" }),
				children: lines.map((l) => {
					const id = String(l.id ?? l.name ?? "");
					const open = openId === id;
					const blocked = Array.isArray(l.blocked) ? l.blocked : [];
					const assertions = Array.isArray(l.assertions) ? l.assertions : [];
					const passed = Number(l.v1_passed) || 0;
					const total = Number(l.v1_total) || 0;
					const nodes = [jsx("div", {
						className: "spo-line",
						key: "r" + id,
						onClick: () => setOpenId(open ? null : id),
						title: esc(l.name),
						children: [
							jsx("span", { className: "spo-lineName", children: "线" + id + " · " + (l.name ?? "") }),
							blocked.length > 0 ? jsx("span", { className: "spo-tag spo-tag-red", children: "阻塞 " + blocked.length }) : null,
							jsx("span", { className: "spo-dot spo-dot-" + freshColor(l.freshness), title: "保鲜" }),
							jsx("span", { className: "spo-num", children: "V1 " + passed + "/" + total }),
							jsx("span", { className: "spo-num", style: { color: "var(--dsw-alias-label-tertiary)" }, children: open ? "▾" : "▸" })
						]
					})];
					if (open) {
						nodes.push(jsx("div", { className: "spo-detail", key: "d" + id, children: assertions.length === 0
							? [jsx("div", { className: "spo-muted", key: "e", children: "该线暂无断言明细（ledger.assertions 为空）" })]
							: assertions.map((a, i) => jsx("div", { className: "spo-assert", key: a.id ?? i, children: [
								jsx("span", { className: "spo-assertMark " + (a.ok ? "spo-ok" : "spo-no"), children: a.ok ? "✓" : "✗" }),
								jsx("span", { className: "spo-assertText", children: (a.id ? a.id + " " : "") + (a.text ?? "") }),
								jsx("span", { className: "spo-muted", children: verifyText(a.verify) + (a.age_days === null || a.age_days === undefined ? "" : " · " + a.age_days + "d") })
							]}))
						}));
					}
					return nodes;
				}).flat()
			});
		}

		function BlockedSection({ blocked, collapsed, onToggle }) {
			return jsx(Section, {
				id: "blocked", title: "阻塞清单", collapsed, onToggle,
				extra: jsx("span", { className: "spo-muted", children: blocked.length + " 项" }),
				children: blocked.length === 0
					? jsx("div", { className: "spo-empty", children: "无阻塞（blocked 为空）" })
					: blocked.map((b, i) => jsx("div", { className: "spo-blocked", key: b.id ?? i, children: [
						jsx("div", { className: "spo-blockedHead", children: [
							b.id ? jsx("span", { className: "spo-tag", children: b.id }) : null,
							jsx("span", { className: "spo-blockedReason", title: esc(b.reason), children: b.reason ?? "(无原因)" }),
							jsx("span", { className: "spo-num", style: { color: "#dc2626", fontWeight: 600 }, children: "已卡 " + (b.days ?? "?") + " 天" })
						] }),
						jsx("div", { className: "spo-muted", children: "起始 " + (b.since ?? "—") + " · 需要 " + (b.needs ?? "—") })
					]}))
			});
		}

		function TimelineSection({ timeline, collapsed, onToggle }) {
			return jsx(Section, {
				id: "timeline", title: "时间轴（里程碑泳道 / 计划×实际）", collapsed, onToggle,
				children: timeline.length === 0
					? jsx("div", { className: "spo-empty", children: "待数据（D795）" })
					: timeline.map((t, i) => jsx("div", { className: "spo-blocked", key: (t.line ?? "") + "-" + (t.milestone ?? i), children: [
						jsx("div", { className: "spo-blockedHead", children: [
							jsx("span", { className: "spo-tag", children: "线" + (t.line ?? "?") }),
							jsx("span", { className: "spo-blockedReason", children: t.milestone ?? "(未命名里程碑)" }),
							jsx("span", { className: "spo-num", children: t.planned_week ?? "未排期" })
						] }),
						jsx("div", { className: "spo-muted", children: t.actual
							? "实际：派单 " + (t.actual.dispatched ?? "—") + " · 首提交 " + (t.actual.first_commit ?? "—") + " · 合并 " + (t.actual.merged ?? "—") + " · 审计 " + (t.actual.audited ?? "—")
							: "实际：—" })
					]}))
			});
		}

		/**
		 * 执行看板：数据源 ledger.tasks（D795 由 task-state/*.json 派生，含 owner/stale_days）。
		 * 全区只读；任务多（200+）时按停滞天数降序取前 12 + 状态分布标签，避免长列表压垮面板。
		 */
		function TasksSection({ tasks, collapsed, onToggle }) {
			if (tasks.length === 0) {
				return jsx(Section, { id: "tasks", title: "执行看板", collapsed, onToggle,
					children: jsx("div", { className: "spo-empty", children: "ledger 无 tasks 数据（待 D795）" }) });
			}
			const byStatus = {};
			for (const t of tasks) {
				const k = String((t && t.status) ?? "unknown");
				byStatus[k] = (byStatus[k] ?? 0) + 1;
			}
			const top = tasks.slice()
				.sort((a, b) => (Number(b.stale_days) || 0) - (Number(a.stale_days) || 0))
				.slice(0, 12);
			return jsx(Section, {
				id: "tasks", title: "执行看板", collapsed, onToggle,
				extra: jsx("span", { className: "spo-muted", children: tasks.length + " 个任务 · 按停滞降序取前 " + top.length }),
				children: [
					jsx("div", { className: "spo-item", style: { borderTop: "none", flexWrap: "wrap", gap: "6px" }, children: Object.keys(byStatus).sort().map((k) =>
						jsx("span", { className: tagClass(k), key: k, children: statusText(k) + " " + byStatus[k] })
					) }),
					...top.map((t) => jsx("div", { className: "spo-item", key: t.id, children: [
						jsx("span", { className: "spo-id", children: t.id }),
						jsx("span", { className: "spo-itemTitle", title: esc(t.title), children: t.title ?? "" }),
						jsx("span", { className: tagClass(t.status), children: statusText(t.status) }),
						jsx("span", { className: "spo-num", style: { flex: "none" }, children: (t.owner ?? "—") + " · 停滞 " + (t.stale_days ?? "?") + " 天" })
					] }))
				]
			});
		}

		/**
		 * 健康区：复用既有 GET /synova/dashboards/data 的 health（不新增第二真相源）。
		 * 与其余区块独立降级——健康路由失败/ok:false 只影响本区，且必须显式可见（铁律 24/31）。
		 */
		function HealthSection({ dash, error, collapsed, onToggle }) {
			const h = dash && dash.health;
			if (error !== null || !h || h.ok === false) {
				return jsx(Section, { id: "health", title: "健康", collapsed, onToggle,
					children: jsx("div", { className: "spo-empty", children: "⚠ 健康区降级：" + (error ?? (h && h.error) ?? "路由无响应") }) });
			}
			const b = h.bypass ?? {};
			const counts = b.counts ?? {};
			const f = h.precommit_failures ?? {};
			const m = Array.isArray(h.m_patterns) ? h.m_patterns : [];
			const bypass = Number(counts["detected-bypass"] ?? 0);
			const blocked = Number(counts.BLOCKED ?? 0);
			return jsx(Section, {
				id: "health", title: "健康", collapsed, onToggle,
				extra: h.cto_verdict ? jsx("span", { className: "spo-muted", title: esc(h.cto_verdict), children: String(h.cto_verdict).slice(0, 40) }) : null,
				children: [
					jsx("div", { className: "spo-stats spo-stats3", style: { padding: "8px 12px" }, children: [
						jsx(StatCard, { num: String(bypass), label: "真绕过（detected-bypass）", tone: bypass > 0 ? "#dc2626" : undefined }),
						jsx(StatCard, { num: String(blocked), label: "门禁拒绝（BLOCKED）", tone: blocked > 0 ? "#d97706" : undefined }),
						jsx(StatCard, { num: String(f.count ?? 0), label: "提交失败（pre-commit）" })
					] }),
					m.length > 0 ? jsx("div", { className: "spo-item", style: { flexWrap: "wrap", gap: "6px" }, children: [
						jsx("span", { className: "spo-muted", style: { flex: "none" }, children: "M 模式复发 " + m.length + " 类：" }),
						...m.map((p) => jsx("span", {
							className: "spo-tag" + (p.again ? " spo-tag-red" : ""),
							key: p.id,
							title: esc(p.name),
							children: p.id + (p.again ? " 复发" : "")
						}))
					] }) : jsx("div", { className: "spo-empty", children: "无 M 模式记录" })
				]
			});
		}

		// ── 面板几何（拖动/缩放）与折叠偏好 ────────────────────────────────────
		// 存储键带版本号：将来看结构变更时可直接换键，不会读到脏数据。
		const PANEL_GEO_KEY = "synova.pm.panel.v1";
		const PANEL_COLLAPSE_KEY = "synova.pm.collapse.v1";
		const PANEL_MIN_W = 720;
		const PANEL_MIN_H = 480;
		const PANEL_MARGIN = 32;
		// 拖动/缩放过程中的起点。面板同时只存在一个实例（main keyed cell），故用模块级变量
		// 而非 useRef —— 也避免污染 hook 顺序。
		let dragOrigin = null;
		let resizeOrigin = null;
		let lastGeo = null;

		/** 统一 pointer capture：不支持时静默跳过（拖动/缩放仍可用）。 */
		function capturePointer(e) {
			const el = e && e.currentTarget;
			if (!el || typeof el.setPointerCapture !== "function" || e.pointerId === undefined) return;
			try {
				el.setPointerCapture(e.pointerId);
			} catch (err) {
				console.warn("[项目总览] setPointerCapture 失败（拖动/缩放仍可用）: " + (err && err.message ? err.message : err));
			}
		}

		function clampNum(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }
		function viewportW() { return (typeof window !== "undefined" && window.innerWidth) || 1280; }
		function viewportH() { return (typeof window !== "undefined" && window.innerHeight) || 800; }

		/** 默认几何：视口内居中，四周留 PANEL_MARGIN。 */
		function defaultGeo() {
			const vw = viewportW(), vh = viewportH();
			const width = clampNum(1100, PANEL_MIN_W, Math.max(PANEL_MIN_W, vw - PANEL_MARGIN));
			const height = clampNum(760, PANEL_MIN_H, Math.max(PANEL_MIN_H, vh - PANEL_MARGIN));
			return { left: Math.max(0, Math.round((vw - width) / 2)), top: Math.max(0, Math.round((vh - height) / 2)), width, height };
		}

		/** 读偏好。localStorage 不可用（隐私模式/配额）或内容非法 → 返回 null 走默认，不抛错、不白屏。 */
		function readJSONPref(storageKey) {
			try {
				const raw = localStorage.getItem(storageKey);
				if (!raw) return null;
				const v = JSON.parse(raw);
				return v !== null && typeof v === "object" ? v : null;
			} catch (err) {
				console.warn("[项目总览] 偏好读取失败，本区降级为默认值: " + storageKey + " — " + (err && err.message ? err.message : err));
				return null;
			}
		}
		/** 写偏好。失败只记 console（不静默），不影响面板可用性。 */
		function writeJSONPref(storageKey, value) {
			try {
				localStorage.setItem(storageKey, JSON.stringify(value));
			} catch (err) {
				console.warn("[项目总览] 偏好写入失败，本次不记忆: " + storageKey + " — " + (err && err.message ? err.message : err));
			}
		}

		/** 几何归一化：任何来源（默认/记忆/拖动/缩放）都必须落在 min/max 之间且不出视口。 */
		function normalizeGeo(g) {
			const vw = viewportW(), vh = viewportH();
			const width = clampNum(Number(g.width) || 0, PANEL_MIN_W, Math.max(PANEL_MIN_W, vw - PANEL_MARGIN));
			const height = clampNum(Number(g.height) || 0, PANEL_MIN_H, Math.max(PANEL_MIN_H, vh - PANEL_MARGIN));
			const left = clampNum(Number(g.left) || 0, 0, Math.max(0, vw - width));
			const top = clampNum(Number(g.top) || 0, 0, Math.max(0, vh - height));
			return { left: Math.round(left), top: Math.round(top), width: Math.round(width), height: Math.round(height) };
		}
		/** 启动几何：有合法记忆用记忆（并归一化），否则用默认。 */
		function readGeo() {
			const saved = readJSONPref(PANEL_GEO_KEY);
			const usable = saved && Number.isFinite(Number(saved.width)) && Number.isFinite(Number(saved.height));
			return normalizeGeo(usable ? saved : defaultGeo());
		}
		/** 折叠态：默认全部展开。 */
		function readCollapsed() {
			return Object.assign({ lines: false, blocked: false, tasks: false, health: false, timeline: false }, readJSONPref(PANEL_COLLAPSE_KEY) ?? {});
		}

		function ProjectOverviewPanel(props) {
			const onBack = props && props.onBack;
			const [data, setData] = useState(null);
			const [error, setError] = useState(null);
			const [dash, setDash] = useState(null);
			const [dashError, setDashError] = useState(null);
			const [busy, setBusy] = useState(false);
			const [at, setAt] = useState(null);
			// 位置/尺寸（localStorage 记忆）与四+区块折叠态（localStorage 记忆）
			const [geo, setGeo] = useState(readGeo);
			const [collapsed, setCollapsed] = useState(readCollapsed);

			const load = useCallback(async () => {
				setBusy(true);
				// 两条只读 GET 各自独立降级：账本失败不影响健康区，反之亦然（铁律 31）。
				const [ledgerRes, dashRes] = await Promise.allSettled([
					fetch(LEDGER_URL, { cache: "no-store" }).then((r) => {
						if (!r.ok) throw new Error("HTTP " + r.status);
						return r.json();
					}),
					fetch(DASH_URL, { cache: "no-store" }).then((r) => {
						if (!r.ok) throw new Error("HTTP " + r.status);
						return r.json();
					})
				]);
				if (ledgerRes.status === "fulfilled") {
					setData(ledgerRes.value);
					setError(null);
				} else {
					setData(null);
					const e = ledgerRes.reason;
					setError(String(e && e.message ? e.message : e));
				}
				if (dashRes.status === "fulfilled") {
					setDash(dashRes.value);
					setDashError(null);
				} else {
					setDash(null);
					const e = dashRes.reason;
					setDashError(String(e && e.message ? e.message : e));
				}
				setAt(new Date().toLocaleTimeString("zh-CN", { hour12: false }));
				setBusy(false);
			}, []);

			useEffect(() => {
				load();
				const timer = setInterval(load, 60000);
				const onVis = () => {
					if (document.visibilityState === "visible") load();
				};
				document.addEventListener("visibilitychange", onVis);
				return () => {
					clearInterval(timer);
					document.removeEventListener("visibilitychange", onVis);
				};
			}, [load]);

			// 折叠切换：写回 localStorage（折叠态记忆）
			const toggleSection = useCallback((id) => {
				const next = Object.assign({}, collapsed, { [id]: !collapsed[id] });
				setCollapsed(next);
				writeJSONPref(PANEL_COLLAPSE_KEY, next);
			}, [collapsed]);

			// 拖动：标题栏 pointerdown → move → up。移动期间只改 state，松手才落盘。
			const onDragStart = useCallback((e) => {
				dragOrigin = { x: e.clientX, y: e.clientY, left: geo.left, top: geo.top };
				lastGeo = geo;
				capturePointer(e);
			}, [geo]);
			const onDragMove = useCallback((e) => {
				if (dragOrigin === null) return;
				const next = normalizeGeo({
					width: geo.width,
					height: geo.height,
					left: dragOrigin.left + (e.clientX - dragOrigin.x),
					top: dragOrigin.top + (e.clientY - dragOrigin.y)
				});
				lastGeo = next;
				setGeo(next);
			}, [geo.width, geo.height]);
			const onDragEnd = useCallback(() => {
				if (dragOrigin === null) return;
				dragOrigin = null;
				writeJSONPref(PANEL_GEO_KEY, lastGeo ?? geo);
			}, [geo]);

			// 缩放：右下角手柄，同样松手落盘；min 720×480，max 视口-32px（由 normalizeGeo 保证）
			const onResizeStart = useCallback((e) => {
				resizeOrigin = { x: e.clientX, y: e.clientY, width: geo.width, height: geo.height };
				lastGeo = geo;
				capturePointer(e);
			}, [geo]);
			const onResizeMove = useCallback((e) => {
				if (resizeOrigin === null) return;
				const next = normalizeGeo({
					left: geo.left,
					top: geo.top,
					width: resizeOrigin.width + (e.clientX - resizeOrigin.x),
					height: resizeOrigin.height + (e.clientY - resizeOrigin.y)
				});
				lastGeo = next;
				setGeo(next);
			}, [geo.left, geo.top]);
			const onResizeEnd = useCallback(() => {
				if (resizeOrigin === null) return;
				resizeOrigin = null;
				writeJSONPref(PANEL_GEO_KEY, lastGeo ?? geo);
			}, [geo]);

			const routeDegraded = data !== null && data.ok === false;
			const degradeMsg = error ?? (routeDegraded ? (data.error ?? "ledger 不可用") : null);
			const usable = data !== null && data.ok !== false;
			const lines = usable && Array.isArray(data.lines) ? data.lines : [];
			const blockedTop = usable && Array.isArray(data.blocked) ? data.blocked : [];
			const timeline = usable && Array.isArray(data.timeline) ? data.timeline : [];
			const tasks = usable && Array.isArray(data.tasks) ? data.tasks : [];
			const totals = usable && data.totals ? data.totals : null;
			// 取数来源标注（验收 b）：worktree（工作区文件）| origin/main（git 权威回退）
			const source = usable && typeof data.source === "string" ? data.source : null;

			const v1Total = totals?.v1_total ?? lines.reduce((s, l) => s + (Number(l.v1_total) || 0), 0);
			const v1Passed = totals?.v1_passed ?? lines.reduce((s, l) => s + (Number(l.v1_passed) || 0), 0);
			const v1Verified = totals?.v1_verified ?? lines.reduce((s, l) => s + (Number(l.v1_verified) || 0), 0);
			const fresh = totals?.freshness ?? sumFresh(lines);
			const blockedCount = totals?.blocked_count ?? blockedTop.length;
			const deliveryPct = totals?.delivery_pct ?? pct1(v1Passed, v1Total);
			const verifyPct = totals?.verify_pct ?? pct1(v1Verified, v1Passed);

			const body = [];
			if (degradeMsg) {
				body.push(jsx("div", { className: "spo-degraded", key: "deg", children: "⚠ 降级：" + degradeMsg + "（面板仍可用，数据源未就绪）" }));
			}
			if (usable && data.degraded === true) {
				const srcs = Array.isArray(data.degraded_sources) ? data.degraded_sources : [];
				body.push(jsx("div", { className: "spo-warn", key: "warn", children: "部分数据源降级" + (srcs.length > 0 ? "：" + srcs.join("、") : "") }));
			}
			body.push(jsx("div", { className: "spo-stats", key: "stats", children: [
				jsx(StatCard, { num: deliveryPct === null ? "—" : deliveryPct + "%", label: "交付度 · V1 断言 " + v1Passed + "/" + v1Total }),
				jsx(StatCard, { num: verifyPct === null ? "—" : verifyPct + "%", label: "验证率 · K3 已复核 " + v1Verified + "/" + v1Passed }),
				jsx(StatCard, { num: String(fresh.red ?? 0), label: "保鲜红灯 · 🟢" + (fresh.green ?? 0) + " 🟡" + (fresh.yellow ?? 0), tone: (fresh.red ?? 0) > 0 ? "#dc2626" : undefined }),
				jsx(StatCard, { num: String(blockedCount), label: "阻塞数", tone: blockedCount > 0 ? "#dc2626" : undefined })
			] }));
			body.push(jsx(LinesSection, { key: "lines", lines, collapsed: collapsed.lines, onToggle: toggleSection }));
			body.push(jsx(BlockedSection, { key: "blocked", blocked: blockedTop, collapsed: collapsed.blocked, onToggle: toggleSection }));
			body.push(jsx(TasksSection, { key: "tasks", tasks, collapsed: collapsed.tasks, onToggle: toggleSection }));
			body.push(jsx(HealthSection, { key: "health", dash, error: dashError, collapsed: collapsed.health, onToggle: toggleSection }));
			body.push(jsx(TimelineSection, { key: "timeline", timeline, collapsed: collapsed.timeline, onToggle: toggleSection }));

			return jsx("div", {
				className: "spo-root",
				style: { left: geo.left + "px", top: geo.top + "px", width: geo.width + "px", height: geo.height + "px" },
				children: [
				jsx("div", {
					className: "spo-head spo-grip",
					title: "拖动标题栏移动面板",
					onPointerDown: onDragStart,
					onPointerMove: onDragMove,
					onPointerUp: onDragEnd,
					onPointerCancel: onDragEnd,
					children: [
					jsx("div", { className: "spo-title", children: "项目总览" }),
					source ? jsx("span", { className: "spo-tag" + (source === "worktree" ? "" : " spo-tag-blue"), title: "账本取数来源：worktree = 工作区文件；origin/main = git 权威回退", children: "源 " + source }) : null,
					usable && data.generated_at ? jsx("span", { className: "spo-muted", children: "账本 " + data.generated_at + (data.git_head ? " · " + String(data.git_head).slice(0, 8) : "") }) : null,
					busy ? jsx("div", { className: "spo-spin" }) : null,
					jsx("button", { type: "button", className: "spo-iconBtn", title: "刷新", onClick: load, children: "↻" }),
					onBack ? jsx("button", { type: "button", className: "spo-iconBtn", title: "返回会话", onClick: onBack, children: "»" }) : null
				] }),
				jsx("div", { className: "spo-body", children: body }),
				jsx("div", { className: "spo-head spo-foot", style: { borderTop: "1px solid var(--dsw-alias-border-l1)", borderBottom: "none", padding: "6px 18px" }, children: [
					jsx("span", { className: "spo-muted", children: "只读视图 · 真相在 git（ledger.json 为派生物）· 更新 " + (at ?? "—") }),
					jsx("span", { className: "spo-spacer" }),
					jsx("span", { className: "spo-muted", children: degradeMsg ? "降级" : "60s 自动刷新" })
				] }),
				jsx("div", {
					className: "spo-resize",
					title: "拖动缩放面板",
					onPointerDown: onResizeStart,
					onPointerMove: onResizeMove,
					onPointerUp: onResizeEnd,
					onPointerCancel: onResizeEnd
				})
			] });
		}

		// ══ D1060：面板 A「Synova 开发工作台」/ 面板 B「治理线」════════════════════════
		// 两条硬约束（创始人 2026-09-28）：
		//   ① 治理线与格子矩阵**物理分离** —— 两个独立左栏入口 + 两个独立 Host 路由，
		//      不是同一面板里的两个区块（所以这里是两套 main key，不是一套）。
		//   ② 空格必须显式 ⚪未填/待办，**绝不伪装成绿**（院方 X27：缺失≠通过）。
		// 两面板共用同一外壳：几何/轮询/降级/拖动缩放行为**逐字一致**（铁律 31），
		// 复制两遍必然漂移。既有「项目总览」面板不动（31 条测试覆盖，改造风险 > 收益）。
		const WB_GEO_KEY = "synova.wb.panel.v1";
		const WB_COLLAPSE_KEY = "synova.wb.collapse.v1";
		const GOV_GEO_KEY = "synova.gov.panel.v1";
		const GOV_COLLAPSE_KEY = "synova.gov.collapse.v1";
		const WB_URL = "/synova/workbench/data";
		const GOV_URL = "/synova/governance/data";
		const WB_PANEL_ID = "synova-dev-workbench";
		const GOV_PANEL_ID = "synova-governance-line";

		/** 四色（与 lib/workbench.js GRID_COLORS 同口径；未知态单列，不改写成绿）。 */
		const GRID_LABEL = { green: "🟢 生效了", yellow: "🟡 接了没生效", red: "🔴 缺失", empty: "⚪ 未填", unknown: "❔ 未知态" };
		const GRID_HEX = { green: "#0a7d32", yellow: "#b8860b", red: "#b3261e", empty: "#6b7280", unknown: "#7c3aed" };

		function readGeoFor(storageKey) {
			const saved = readJSONPref(storageKey);
			const usable = saved && Number.isFinite(Number(saved.width)) && Number.isFinite(Number(saved.height));
			return normalizeGeo(usable ? saved : defaultGeo());
		}
		function readCollapsedFor(storageKey, defaults) {
			return Object.assign({}, defaults, readJSONPref(storageKey) ?? {});
		}

		/**
		 * 两个新面板的通用外壳。
		 * @input  props.title/url/geoKey/collapseKey/collapseDefaults/renderBody/onBack
		 * @output 与「项目总览」同构的浮动只读卡片（拖动/缩放/折叠/60s 轮询/手动刷新）
		 * @degraded 路由级 ok:false → 整面板降级横幅；payload.degraded → 部分降级警告 + 逐源原因
		 */
		function SynovaPanel(props) {
			const url = props.url;
			const renderBody = props.renderBody;
			const onBack = props.onBack;
			const [data, setData] = useState(null);
			const [error, setError] = useState(null);
			const [at, setAt] = useState(null);
			const [busy, setBusy] = useState(false);
			const [geo, setGeo] = useState(() => readGeoFor(props.geoKey));
			const [collapsed, setCollapsed] = useState(() => readCollapsedFor(props.collapseKey, props.collapseDefaults));
			const drag = react.useRef(null);
			const lastGeoRef = react.useRef(null);
			const capture = (e) => capturePointer(e);

			const load = useCallback(() => {
				setBusy(true);
				fetch(url, { headers: { accept: "application/json" } })
					.then((r) => r.json())
					.then((j) => { setData(j); setError(null); })
					.catch((e) => { setData(null); setError(String(e && e.message ? e.message : e)); })
					.then(() => {
						setAt(new Date().toLocaleTimeString("zh-CN", { hour12: false }));
						setBusy(false);
					});
			}, [url]);

			useEffect(() => {
				load();
				const timer = setInterval(load, 60000);
				const onVis = () => { if (document.visibilityState === "visible") load(); };
				document.addEventListener("visibilitychange", onVis);
				return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVis); };
			}, [load]);

			const toggleSection = useCallback((id) => {
				setCollapsed((prev) => {
					const next = Object.assign({}, prev, { [id]: !prev[id] });
					writeJSONPref(props.collapseKey, next);
					return next;
				});
			}, [props.collapseKey]);

			const onDragStart = useCallback((e) => {
				drag.current = { x: e.clientX, y: e.clientY, left: geo.left, top: geo.top };
				lastGeoRef.current = geo;
				capture(e);
			}, [geo]);
			const onDragMove = useCallback((e) => {
				if (drag.current === null) return;
				const next = normalizeGeo({
					width: geo.width, height: geo.height,
					left: drag.current.left + (e.clientX - drag.current.x),
					top: drag.current.top + (e.clientY - drag.current.y)
				});
				lastGeoRef.current = next;
				setGeo(next);
			}, [geo.width, geo.height]);
			const onDragEnd = useCallback(() => {
				if (drag.current === null) return;
				drag.current = null;
				writeJSONPref(props.geoKey, lastGeoRef.current ?? geo);
			}, [geo, props.geoKey]);
			const onResizeStart = useCallback((e) => {
				drag.current = { x: e.clientX, y: e.clientY, width: geo.width, height: geo.height, resize: true };
				lastGeoRef.current = geo;
				capture(e);
			}, [geo]);
			const onResizeMove = useCallback((e) => {
				if (drag.current === null || drag.current.resize !== true) return;
				const next = normalizeGeo({
					left: geo.left, top: geo.top,
					width: drag.current.width + (e.clientX - drag.current.x),
					height: drag.current.height + (e.clientY - drag.current.y)
				});
				lastGeoRef.current = next;
				setGeo(next);
			}, [geo.left, geo.top]);
			const onResizeEnd = useCallback(() => {
				if (drag.current === null) return;
				drag.current = null;
				writeJSONPref(props.geoKey, lastGeoRef.current ?? geo);
			}, [geo, props.geoKey]);

			const routeDegraded = data !== null && data.ok === false;
			const degradeMsg = error ?? (routeDegraded ? (data.error ?? "数据不可用") : null);
			const usable = data !== null && data.ok !== false;
			const body = [];
			if (degradeMsg) {
				body.push(jsx("div", { className: "spo-degraded", key: "deg", children: "⚠ 降级：" + degradeMsg + "（面板仍可用，数据源未就绪）" }));
			} else if (usable && data.degraded === true) {
				const srcs = Array.isArray(data.degraded_sources) ? data.degraded_sources : [];
				body.push(jsx("div", { className: "spo-warn", key: "warn", children: "部分数据源降级" + (srcs.length > 0 ? "：" + srcs.join("、") : "") }));
			}
			if (usable) {
				for (const node of renderBody(data, collapsed, toggleSection)) body.push(node);
			}

			return jsx("div", {
				className: "spo-root",
				style: { left: geo.left + "px", top: geo.top + "px", width: geo.width + "px", height: geo.height + "px" },
				children: [
					jsx("div", {
						className: "spo-head spo-grip",
						title: "拖动标题栏移动面板",
						onPointerDown: onDragStart, onPointerMove: onDragMove,
						onPointerUp: onDragEnd, onPointerCancel: onDragEnd,
						children: [
							jsx("div", { className: "spo-title", children: props.title }),
							props.badge ? jsx("span", { className: "spo-tag", children: props.badge }) : null,
							usable && data.generated_at ? jsx("span", { className: "spo-muted", children: "取数 " + String(data.generated_at).slice(11, 19) }) : null,
							busy ? jsx("div", { className: "spo-spin" }) : null,
							jsx("button", { type: "button", className: "spo-iconBtn", title: "刷新", onClick: load, children: "↻" }),
							onBack ? jsx("button", { type: "button", className: "spo-iconBtn", title: "返回会话", onClick: onBack, children: "»" }) : null
						]
					}),
					jsx("div", { className: "spo-body", children: body }),
					jsx("div", {
						className: "spo-head spo-foot",
						style: { borderTop: "1px solid var(--dsw-alias-border-l1)", borderBottom: "none", padding: "6px 18px" },
						children: [
							jsx("span", { className: "spo-muted", children: "只读视图 · 数字全部来自仓库机读件（禁手写）· 更新 " + (at ?? "—") }),
							jsx("span", { className: "spo-spacer" }),
							jsx("span", { className: "spo-muted", children: degradeMsg ? "降级" : "60s 自动刷新" })
						]
					}),
					jsx("div", {
						className: "spo-resize", title: "拖动缩放面板",
						onPointerDown: onResizeStart, onPointerMove: onResizeMove,
						onPointerUp: onResizeEnd, onPointerCancel: onResizeEnd
					})
				]
			});
		}

		/** 四问格子矩阵：16 行 × 4 问，按 layer 分组合并首列（rowSpan）。 */
		function gridSection(grid, collapsed, onToggle) {
			if (!grid || grid.ok !== true) {
				return jsx(Section, {
					id: "grid", title: "① 四问格子矩阵", collapsed, onToggle,
					children: jsx("div", { className: "spo-empty", children: "降级：宪章格子不可读 —— " + ((grid && grid.error) || "未知原因") })
				});
			}
			const qs = Array.isArray(grid.questions) ? grid.questions : [];
			const rows = Array.isArray(grid.rows) ? grid.rows : [];
			const groups = [];
			for (const r of rows) {
				const last = groups[groups.length - 1];
				if (last && last.layer === r.layer) last.rows.push(r);
				else groups.push({ layer: r.layer, rows: [r] });
			}
			const headCells = [
				jsx("th", { key: "layer", style: { width: "66px" }, children: "层" }),
				jsx("th", { key: "ext", style: { width: "150px" }, children: "扩展点" }),
				jsx("th", { key: "pri", style: { width: "40px" }, children: "级" })
			];
			for (const q of qs) headCells.push(jsx("th", { key: q.code, title: q.desc || q.text, children: q.text || q.code }));

			const bodyRows = [];
			for (const g of groups) {
				g.rows.forEach((r, ri) => {
					const tds = [];
					if (ri === 0) {
						tds.push(jsx("td", { key: "layer", className: "swb-layer", rowSpan: g.rows.length, children: g.layer }));
					}
					tds.push(jsx("td", { key: "ext", className: "swb-ext", title: r.ext_point, children: r.ext_point }));
					tds.push(jsx("td", { key: "pri", className: "swb-pri", children: r.priority ?? "—" }));
					for (const q of qs) {
						const cell = r.cells ? r.cells[q.code] : null;
						if (!cell) {
							tds.push(jsx("td", { key: q.code, className: "swb-cell swb-empty", title: "该格在数据源中不存在 —— 显式报缺，不默认绿", children: [
								jsx("span", { className: "swb-cellTop", children: "⚪ 未填" }),
								jsx("span", { className: "swb-cellSub", children: "数据源缺此格" })
							] }));
							continue;
						}
						const st = GRID_LABEL[cell.status] ? cell.status : "unknown";
						const tip = [
							cell.id,
							cell.judgement ? "判据：" + cell.judgement : "判据：未填（待办）",
							cell.command ? "命令：" + cell.command : "",
							cell.owner ? "owner " + cell.owner : "",
							cell.updated_at || ""
						].filter(Boolean).join(" · ");
						tds.push(jsx("td", {
							key: q.code,
							className: "swb-cell swb-" + st,
							title: tip,
							children: [
								jsx("span", { className: "swb-cellTop", style: { color: GRID_HEX[st] }, children: GRID_LABEL[st] }),
								jsx("span", { className: "swb-cellSub", title: cell.judgement || "", children: cell.judgement ? cell.judgement : (st === "empty" ? "待办 · 未填判据" : (cell.id || "")) })
							]
						}));
					}
					bodyRows.push(jsx("tr", { key: (g.layer || "") + "-" + (r.ext_point || "") + "-" + ri, children: tds }));
				});
			}

			const d = grid.derived ?? {};
			const bs = d.by_status ?? {};
			const legend = jsx("div", { className: "swb-legend", children: [
				jsx("span", { className: "swb-legendItem", children: [jsx("span", { className: "swb-chip", style: { background: GRID_HEX.green } }), "🟢 生效了 " + (bs.green ?? 0)] }),
				jsx("span", { className: "swb-legendItem", children: [jsx("span", { className: "swb-chip", style: { background: GRID_HEX.yellow } }), "🟡 接了没生效 " + (bs.yellow ?? 0)] }),
				jsx("span", { className: "swb-legendItem", children: [jsx("span", { className: "swb-chip", style: { background: GRID_HEX.red } }), "🔴 缺失 " + (bs.red ?? 0)] }),
				jsx("span", { className: "swb-legendItem", children: [jsx("span", { className: "swb-chip", style: { background: GRID_HEX.empty } }), "⚪ 未填 " + (bs.empty ?? 0)] }),
				(bs.unknown ?? 0) > 0 ? jsx("span", { className: "swb-legendItem", children: [jsx("span", { className: "swb-chip", style: { background: GRID_HEX.unknown } }), "❔ 未知态 " + bs.unknown] }) : null,
				jsx("span", { className: "spo-spacer" }),
				jsx("span", { className: "swb-srcTag", title: "源：" + grid.path + "（" + grid.source + "）", children: "源 " + grid.source + " · " + (d.rows ?? 0) + " 行 × " + (d.questions ?? 0) + " 问 · 已填 " + (d.filled ?? 0) + "/" + (d.cells ?? 0) })
			] });

			return jsx(Section, {
				id: "grid",
				// 标题里的行/问数**取自数据**（早前硬编码「16 行 × 4 问」，
				// repoRoot 指向未升四问的仓库时会显示 3 问却写 4 问 —— 独立复核 finding g）
				title: "① 四问格子矩阵（" + (d.rows ?? 0) + " 行 × " + (d.questions ?? 0) + " 问）",
				collapsed, onToggle,
				extra: jsx("span", { className: "spo-muted", children: "已填 " + (d.filled ?? 0) + "/" + (d.cells ?? 0) + " · ⚪未填 " + (bs.empty ?? 0) + ((d.malformed ?? 0) > 0 ? " · ❗畸形 " + d.malformed : "") }),
				children: [
					(Array.isArray(grid.issues) && grid.issues.length > 0)
						? jsx("div", { className: "spo-warn", key: "issues", children: "格子结构提示：" + grid.issues.join("；") })
						: null,
					jsx("div", { key: "wrap", className: "swb-gridWrap", children: jsx("table", { className: "swb-grid", children: [
						jsx("thead", { key: "h", children: jsx("tr", { children: headCells }) }),
						jsx("tbody", { key: "b", children: bodyRows })
					] }) }),
					jsx("div", { key: "lg", className: "swb-legend", children: [
						jsx("span", { className: "spo-muted", children: grid.rules?.empty_is_not_green ?? "空格显式报待办，不默认绿（X27）" }),
						jsx("span", { className: "spo-spacer" }),
						jsx("span", { className: "swb-srcTag", title: grid.schema ?? "", children: (grid.counts?.questions ?? "?") + " 问 · 口径声明 filled=" + (grid.counts?.filled ?? "—") })
					] }),
					legend
				].filter(Boolean)
			});
		}

		/** ② 今日/本周流水：git 两侧 + PR（API，或显式标注的快照回退）。 */
		function flowSection(flow, collapsed, onToggle) {
			if (!flow || flow.ok !== true) {
				return jsx(Section, {
					id: "flow", title: "② 今日/本周流水", collapsed, onToggle,
					children: jsx("div", { className: "spo-empty", children: "降级：流水不可读" })
				});
			}
			const git = flow.git ?? {};
			const pr = flow.pr ?? {};
			const commitRow = (c, i) => jsx("div", { className: "spo-item", key: "c" + i, children: [
				jsx("span", { className: "spo-id", children: c.hash }),
				jsx("span", { className: "spo-itemTitle", title: c.subject + " · " + c.author, children: c.subject }),
				jsx("span", { className: "swb-srcTag", children: String(c.date || "").slice(5, 16).replace("T", " ") })
			] });
			const prRow = (p, i) => jsx("div", { className: "spo-item", key: "p" + (p.number ?? i), children: [
				jsx("span", { className: "spo-id", children: "#" + p.number }),
				jsx("span", { className: "spo-itemTitle", title: p.title, children: p.title }),
				p.draft ? jsx("span", { className: "swb-pill", children: "draft" }) : null
			] });

			const gitToday = git.today?.commits ?? [];
			const gitWeek = git.week?.commits ?? [];
			const colToday = jsx("div", { className: "swb-flowCol", key: "today", children: [
				jsx("div", { className: "swb-flowHead", children: "今日提交 " + gitToday.length + (git.today?.capped ? "（截断）" : "") }),
				git.ok !== true
					? jsx("div", { className: "spo-empty", children: "降级：" + (git.error ?? "git 不可读") })
					: (gitToday.length === 0
						? jsx("div", { className: "spo-empty", children: "今日无提交" })
						: jsx("div", { className: "swb-scroll", children: gitToday.slice(0, 12).map(commitRow) }))
			] });
			const colWeek = jsx("div", { className: "swb-flowCol", key: "week", children: [
				jsx("div", { className: "swb-flowHead", children: "本周提交 " + gitWeek.length + (git.week?.capped ? "（截断）" : "") + " · 自 " + String(git.week?.since ?? "").slice(0, 10) }),
				git.ok !== true
					? jsx("div", { className: "spo-empty", children: "降级：" + (git.error ?? "git 不可读") })
					: jsx("div", { className: "swb-scroll", children: gitWeek.slice(0, 20).map(commitRow) })
			] });

			const prCells = [];
			if (pr.ok !== true) {
				prCells.push(jsx("div", { className: "spo-empty", key: "prdeg", children: "降级：PR 取数失败 —— " + (pr.error ?? "") }));
			} else {
				const c = pr.counts ?? {};
				prCells.push(jsx("div", { className: "swb-kv", key: "prk", children: [
					jsx("span", { className: "swb-kvKey", children: "PR 源" }),
					jsx("span", { className: "swb-kvVal", children: pr.source === "api"
						? "GitHub API 实时（" + (pr.slug ?? "") + (pr.partial ? " · 部分失败：" + (pr.attempts ?? []).join("；") : "") + "）"
						: "快照 " + (pr.generated_at ?? "") + (pr.note ? " —— " + pr.note : "") })
				] }));
				prCells.push(jsx("div", { className: "swb-kv", key: "prq", children: [
					jsx("span", { className: "swb-kvKey", children: "未合队列" }),
					jsx("span", { className: "swb-kvVal", children: [
						jsx("span", { className: (c.open > 12 ? "swb-pill swb-pill-red" : "swb-pill"), children: String(c.open ?? 0) + " 条" }),
						"　今日新开 " + (c.open_today ?? 0) + " · 本周新开 " + (c.open_week ?? 0) + " · 本周已合 " + (c.merged_week ?? 0) + " · 今日已合 " + (c.merged_today ?? 0)
					] })
				] }));
				const mergedList = pr.merged_week ?? [];
				prCells.push(jsx("div", { className: "swb-flowHead", key: "prh", children: "本周已合并 " + (c.merged_week ?? mergedList.length) + (pr.merged_capped ? "（截断）" : "") }));
				prCells.push(mergedList.length === 0
					? jsx("div", { className: "spo-empty", key: "prempty", children: pr.source === "api" ? "本周无已合并 PR" : "快照不含合并时间——今日/本周已合计数需 API（当前不可用），故显式留空而非拿旧数据充数" })
					: jsx("div", { className: "swb-scroll", key: "prlist", children: mergedList.slice(0, 20).map(prRow) }));
				const openList = pr.open ?? [];
				prCells.push(jsx("div", { className: "swb-flowHead", key: "openh", children: "未合 PR（按最近更新，取 " + openList.length + " 条）" }));
				prCells.push(openList.length === 0
					? jsx("div", { className: "spo-empty", key: "openempty", children: "无未合 PR" })
					: jsx("div", { className: "swb-scroll", key: "openlist", children: openList.slice(0, 15).map(prRow) }));
			}

			return jsx(Section, {
				id: "flow", title: "② 今日/本周流水", collapsed, onToggle,
				extra: jsx("span", { className: "spo-muted", children: "今日 " + gitToday.length + " 提交 · 本周 " + gitWeek.length + " 提交 · 未合 PR " + ((pr.counts ?? {}).open ?? "—") }),
				children: [
					jsx("div", { key: "git", className: "swb-flow", children: [colToday, colWeek] }),
					jsx("div", { key: "pr", children: prCells })
				]
			});
		}

		/** ③ 待你裁：一句话 + 我的倾向 + 等待天数（权威源）；卡面扫描单列，不混入。 */
		function decisionsSection(dec, collapsed, onToggle) {
			if (!dec || dec.ok !== true) {
				return jsx(Section, {
					id: "decisions", title: "③ 待你裁", collapsed, onToggle,
					children: jsx("div", { className: "spo-empty", children: "降级：待裁源不可读 —— " + ((dec && dec.error) || "未知原因") })
				});
			}
			const pending = dec.pending ?? [];
			const items = pending.length === 0
				? jsx("div", { className: "spo-empty", children: "当前无待你裁事项（源：" + dec.source + "，待裁 0 / 已裁 " + dec.resolved_count + "）" })
				: pending.map((d, i) => jsx("div", { className: "swb-kv", key: d.id ?? i, style: { flexDirection: "column", alignItems: "stretch", gap: "3px" }, children: [
					jsx("div", { style: { display: "flex", gap: "8px", alignItems: "baseline" }, children: [
						d.id ? jsx("span", { className: "spo-id", children: d.id }) : null,
						jsx("span", { style: { flex: 1, minWidth: 0, fontWeight: 600 }, children: d.title }),
						jsx("span", { className: "swb-pill swb-pill-amber", children: d.waiting_days === null ? "等待 —" : "等待 " + d.waiting_days + " 天" })
					] }),
					d.context ? jsx("div", { className: "spo-muted", children: d.context }) : null,
					jsx("div", { className: "spo-muted", children: "我的倾向：" + (d.suggestion?.label ?? "—（未给）") + (d.suggestion?.reason ? " —— " + d.suggestion.reason : "") })
				] }));

			const scan = dec.card_scan ?? [];
			return jsx(Section, {
				id: "decisions", title: "③ 待你裁", collapsed, onToggle,
				extra: jsx("span", { className: "spo-muted", children: "待裁 " + dec.pending_count + " · 卡面扫描 " + dec.card_scan_count + " · 已裁 " + dec.resolved_count }),
				children: [
					jsx("div", { key: "src", className: "swb-kv", children: [
						jsx("span", { className: "swb-kvKey", children: "源" }),
						jsx("span", { className: "swb-kvVal", children: dec.source + "（上游单源 " + dec.upstream_source + "，生成于 " + (dec.generated_at ?? "—") + "）" })
					] }),
					jsx("div", { key: "items", children: items }),
					jsx("div", { key: "scanHead", className: "swb-flowHead", children: "卡面文本扫描「需创始人」 " + scan.length + " 条（非结构化 —— 无选项/无倾向，故单列不混入上表）" }),
					scan.length === 0
						? jsx("div", { className: "spo-empty", key: "scanEmpty", children: "无" })
						: jsx("div", { className: "swb-scroll", key: "scan", children: scan.map((s, i) => jsx("div", { className: "spo-item", key: s.id ?? i, children: [
							jsx("span", { className: "spo-id", children: s.id }),
							jsx("span", { className: "spo-itemTitle", title: s.excerpt, children: s.title }),
							jsx("span", { className: "swb-pill", children: s.waiting_days === null ? "等待 —" : "等待 " + s.waiting_days + " 天" })
						] })) })
				]
			});
		}

		/** ④ 阻塞：卡在哪 + 卡了几天（三要素口径）；未申报的单列，不静默补。 */
		function blockedSection(blk, collapsed, onToggle) {
			if (!blk || blk.ok !== true) {
				return jsx(Section, {
					id: "blocked", title: "④ 阻塞", collapsed, onToggle,
					children: jsx("div", { className: "spo-empty", children: "降级：阻塞源不可读 —— " + ((blk && blk.error) || "未知原因") })
				});
			}
			const items = blk.items ?? [];
			const list = items.length === 0
				? jsx("div", { className: "spo-empty", children: "阻塞 0 条 —— 口径：" + blk.rule })
				: items.map((b, i) => jsx("div", { className: "spo-blocked", key: (b.id ?? "x") + i, children: [
					jsx("div", { className: "spo-blockedHead", children: [
						b.id ? jsx("span", { className: "spo-tag", children: b.id }) : null,
						b.line ? jsx("span", { className: "swb-pill", children: "线 " + b.line }) : null,
						jsx("span", { className: "spo-blockedReason", title: b.reason, children: b.reason }),
						jsx("span", { className: "spo-num", style: { color: "#dc2626", fontWeight: 600 }, children: b.days === null ? "已卡 ?" : "已卡 " + b.days + " 天" })
					] }),
					jsx("div", { className: "spo-muted", children: "起始 " + (b.since ?? "—") + " · 需要 " + (b.needs ?? "—") + " · 源 " + b.source })
				] }));

			const nc = blk.nonconforming ?? [];
			return jsx(Section, {
				id: "blocked", title: "④ 阻塞", collapsed, onToggle,
				extra: jsx("span", { className: "spo-muted", children: "计入 " + blk.count + " · 未申报 " + blk.nonconforming_count }),
				children: [
					// 部分降级（如 ledger 不可读但 product-progress 可用）必须在本区也显式可见 ——
					// 否则面板展示的是**残缺阻塞列表**却零信号（独立复核 finding a）
					(blk.degraded === true)
						? jsx("div", { className: "spo-warn", key: "blkWarn", children: "部分阻塞源降级：" + (blk.error ?? "") + ((blk.card_fallback_count ?? 0) > 0 ? "；已从卡面直取 " + blk.card_fallback_count + " 条三要素齐全的阻塞补位" : "") })
						: null,
					jsx("div", { key: "list", children: list }),
					jsx("div", { key: "ncHead", className: "swb-flowHead", children: "未按三要素申报（reason+since+needs 缺一即不计入阻塞数，不静默补）共 " + nc.length + " 条" }),
					nc.length === 0
						? jsx("div", { className: "spo-empty", key: "ncEmpty", children: "无" })
						: jsx("div", { className: "swb-scroll", key: "nc", children: nc.map((n, i) => jsx("div", { className: "spo-item", key: (n.id ?? "n") + i, children: [
							jsx("span", { className: "spo-id", children: n.id }),
							jsx("span", { className: "spo-itemTitle", title: n.note, children: n.note || "（无备注）" }),
							jsx("span", { className: "swb-pill", children: n.kind })
						] })) })
				]
			});
		}

		function WorkbenchPanel(props) {
			return jsx(SynovaPanel, {
				title: "Synova 开发工作台",
				badge: "面板 A",
				url: WB_URL,
				geoKey: WB_GEO_KEY,
				collapseKey: WB_COLLAPSE_KEY,
				collapseDefaults: { grid: false, flow: false, decisions: false, blocked: false },
				onBack: props && props.onBack,
				renderBody: (data, collapsed, toggle) => [
					gridSection(data.grid, collapsed.grid, toggle),
					flowSection(data.flow, collapsed.flow, toggle),
					decisionsSection(data.decisions, collapsed.decisions, toggle),
					blockedSection(data.blocked, collapsed.blocked, toggle)
				]
			});
		}

		/** 面板 B「治理线」——与格子矩阵物理分离（独立入口 + 独立路由）。 */
		function GovernancePanel(props) {
			const [onlyActive, setOnlyActive] = useState(true);
			// 筛选态是会话内 UI 状态，不落 localStorage（只读视图原则，与既有面板一致）
			return jsx(SynovaPanel, {
				title: "治理线",
				badge: "面板 B",
				url: GOV_URL,
				geoKey: GOV_GEO_KEY,
				collapseKey: GOV_COLLAPSE_KEY,
				collapseDefaults: { cards: false, debt: false },
				onBack: props && props.onBack,
				renderBody: (data, collapsed, toggle) => {
					const cards = data.cards ?? {};
					const all = onlyActive ? (cards.active ?? []) : [].concat(cards.active ?? [], cards.resting ?? []);
					const rows = all.map((c, i) => jsx("div", { className: "spo-item", key: (c.id ?? "x") + i, children: [
						jsx("span", { className: "spo-id", children: c.id }),
						jsx("span", { className: "swb-pill", style: { flex: "none" }, children: c.domain_label }),
						jsx("span", { className: "spo-itemTitle", title: c.title + "（入选信号：" + (c.signals ?? []).join("、") + "）", children: c.title }),
						jsx("span", { className: "swb-srcTag", title: "serves 依据：" + c.serves_source, children: c.serves ? "服务 " + c.serves : "—（卡面未声明）" }),
						jsx("span", { className: "swb-pill", children: c.status ?? "?" }),
						jsx("span", { className: "spo-num", style: { color: (c.waiting_days ?? 0) >= 7 ? "#dc2626" : undefined, fontWeight: 600 }, children: c.waiting_days === null ? "等待 —" : "等待 " + c.waiting_days + " 天" })
					] }));
					const debt = data.debt ?? {};
					return [
						jsx(Section, {
							id: "cards", key: "cards",
							title: "治理卡（域 / 卡号 / 状态 / 服务哪条主线 / 等待天数）",
							collapsed: collapsed.cards, onToggle: toggle,
							extra: jsx("span", { className: "spo-muted", children: "活卡 " + (cards.active_count ?? 0) + " · 终态 " + (cards.resting_count ?? 0) + " · 共 " + (cards.count ?? 0) }),
							children: [
								jsx("div", { className: "swb-kv", key: "rule", children: [
									jsx("span", { className: "swb-kvKey", children: "口径" }),
									jsx("span", { className: "swb-kvVal", children: (data.scope?.rule ?? "") + "　命中信号计数：" + JSON.stringify(data.scope?.signals ?? {}) })
								] }),
								jsx("div", { className: "swb-kv", key: "filterNote", children: [
									jsx("span", { className: "swb-kvKey", children: "注意" }),
									jsx("span", { className: "swb-kvVal", children: cards.filter_note ?? "" })
								] }),
								jsx("div", { className: "swb-filter", key: "filter", children: [
									jsx("button", { type: "button", className: "swb-filterBtn", "data-on": onlyActive ? "1" : "0", onClick: () => setOnlyActive(true), children: "活卡 " + (cards.active_count ?? 0) }),
									jsx("button", { type: "button", className: "swb-filterBtn", "data-on": onlyActive ? "0" : "1", onClick: () => setOnlyActive(false), children: "全部 " + (cards.count ?? 0) }),
									jsx("span", { className: "swb-srcTag", children: cards.ok === false ? "降级：" + (cards.error ?? "") : "源 task-state/D*.json（读卡 " + (cards.count ?? 0) + "，坏卡 " + (cards.read_error_count ?? 0) + "）" })
								] }),
								rows.length === 0
									? jsx("div", { className: "spo-empty", key: "empty", children: "无符合条件的治理卡" })
									: jsx("div", { className: "swb-scroll", key: "rows", children: rows })
							]
						}),
						jsx(Section, {
							id: "debt", key: "debt",
							title: "欠账 / 待规划（board-backlog.json）",
							collapsed: collapsed.debt, onToggle: toggle,
							extra: jsx("span", { className: "spo-muted", children: debt.ok ? debt.count + " 项" : "降级" }),
							children: debt.ok
								? [
									jsx("div", { className: "swb-kv", key: "src", children: [
										jsx("span", { className: "swb-kvKey", children: "源" }),
										jsx("span", { className: "swb-kvVal", children: debt.source + (debt.source_detail ? "（" + debt.source_detail + "）" : "") + "　｜　" + debt.todos_yaml_note })
									] }),
									(debt.items ?? []).length === 0
										? jsx("div", { className: "spo-empty", key: "e", children: "欠账表为空" })
										: jsx("div", { className: "swb-scroll", key: "l", children: (debt.items ?? []).map((x, i) => jsx("div", { className: "spo-item", key: x.id ?? i, children: [
											jsx("span", { className: "spo-id", children: x.id }),
											jsx("span", { className: "spo-itemTitle", title: x.note, children: x.title })
										] })) })
								]
								: jsx("div", { className: "spo-empty", children: "降级：欠账表不可读 —— " + (debt.error ?? "未知原因") })
						})
					];
				}
			});
		}

		// 注：react/jsx-runtime 的签名是 jsx(type, props, key) —— 第 3 个参数是 **key 不是 children**。
		// 早前写成 jsx("span", {...}, "📊") 时字形被当成 key 丢掉，**图标恒为空 span**
		// （2026-09-29 真机取证：<span title="项目总览"></span> 无文本）。故 children 一律写进 props。
		/** 侧栏入口图标：sidebar.panellist owner props = { size, active }（官方全局面板行）。 */
		function ProjectOverviewIcon(props) {
			const size = (props && props.size) || 16;
			return jsx("span", {
				style: { fontSize: Math.round(size * 0.9), lineHeight: 1 },
				title: "项目总览",
				children: "📊"
			});
		}

		/** 面板 A 图标。 */
		function WorkbenchIcon(props) {
			const size = (props && props.size) || 16;
			return jsx("span", {
				style: { fontSize: Math.round(size * 0.9), lineHeight: 1 },
				title: "Synova 开发工作台",
				children: "🧰"
			});
		}

		/** 面板 B 图标（治理线 —— 与面板 A 物理分离的第二个入口）。 */
		function GovernanceIcon(props) {
			const size = (props && props.size) || 16;
			return jsx("span", {
				style: { fontSize: Math.round(size * 0.9), lineHeight: 1 },
				title: "治理线",
				children: "⚖️"
			});
		}

		// ── 注册降级（Done ⑤：slot 不存在 / 版本不足 → 显式 degraded，不静默）──────
		// 背景：官方协议下「选择未注册的 main key 会抛错并保留当前选中态」——
		//   若 main cell 注册失败而入口行照常注册，用户点进去会**什么都不发生**（静默降级）。
		// 做法：① 逐个注册包 try/catch，失败 console.error 留痕（铁律 24 禁空吞）；
		//       ② main cell 未注册成功时，该入口图标改显 ⚠ + title 说明（前端可见，不静默）；
		//       ③ 失败清单挂到 exports.__synovaRegistrationDegraded 供诊断/测试读取。
		const MAIN_REGISTERED = new Map();
		const REGISTRATION_FAILURES = [];

		function guardRegister(label, fn) {
			try {
				fn();
				return true;
			} catch (err) {
				const msg = label + "：" + (err && err.message ? err.message : String(err));
				REGISTRATION_FAILURES.push(msg);
				console.error("[@synova/dsh-dashboards] 槽位注册失败（降级可见）：" + msg);
				return false;
			}
		}

		/** 入口图标包装：main cell 注册失败 → 显示 ⚠（显式降级，不静默消失）。 */
		function iconWithHealthFallback(Icon, log, key) {
			const Wrapped = (props) => {
				if (MAIN_REGISTERED.get(key) === false) {
					const size = (props && props.size) || 16;
					return jsx("span", {
						style: { fontSize: Math.round(size * 0.9), lineHeight: 1, color: "#dc2626" },
						title: log + " —— 降级：main 面板未注册（点击不会切面板）；详见控制台 [@synova/dsh-dashboards]",
						children: "⚠"
					});
				}
				return jsx(Icon, props);
			};
			return Wrapped;
		}

		// ── 插件体 ────────────────────────────────────────────────────────────
		const inject = ["slots", "layout"];

		// 官方全局面板协议（见 @deepseek-ai/dsh-client-ui-sidebar README §全局面板入口）：
		//   sidebar.panellist（root 作用域 list）注册 { id, order?, label? }，组件是**图标**，
		//   收 owner props { size, active }；**同一个 id** 寻址 root 作用域 main（keyed）的组件。
		//   官方明确：选择未注册的 main key 会抛错并保留旧选中态 ⇒ 必须先注册 main，再注册入口行。
		const PANEL_ID = "synova-project-overview";
		// D1060：三个面板 = 三对 (main keyed cell + sidebar.panellist 入口)，id 各自独立。
		// 治理线（GOV_PANEL_ID）与开发工作台（WB_PANEL_ID）是**两个独立入口**，
		// 不是同一面板的两个区块 —— 即创始人要求的"物理分离"。
		const PANEL_ENTRIES = [
			{ id: PANEL_ID, order: 50, label: "项目总览", key: PANEL_ID, Icon: ProjectOverviewIcon, Panel: ProjectOverviewPanel, log: "项目总览" },
			{ id: WB_PANEL_ID, order: 51, label: "开发工作台", key: WB_PANEL_ID, Icon: WorkbenchIcon, Panel: WorkbenchPanel, log: "开发工作台" },
			{ id: GOV_PANEL_ID, order: 52, label: "治理线", key: GOV_PANEL_ID, Icon: GovernanceIcon, Panel: GovernancePanel, log: "治理线" }
		];

		function apply(ctx) {
			const slots = ctx.slots;
			// 样式注入：先移除本插件此前注入的所有 <style>，再插当前一份。
			// 这样每次 apply 的样式表都恰好等于当前 CSS —— HMR 热更后不会残留旧规则
			// （旧版按固定 key 判重会拒绝重注入，导致改过 CSS 仍跑旧样式）。
			if (typeof document !== "undefined") {
				for (const stale of document.querySelectorAll('style[data-plugin="@synova/dsh-dashboards"]')) stale.remove();
				const tag = document.createElement("style");
				tag.dataset.plugin = "@synova/dsh-dashboards";
				tag.textContent = CSS;
				document.head.appendChild(tag);
			}
			// 逐个面板成对注册：① main keyed cell（选中入口行时由 layout 派发到此）
			// ② 左栏入口行（sidebar.panellist）。顺序不可反 —— 未注册的 main key 会抛错。
			// 两步都过 guardRegister：任一失败 → 留痕 + 入口显 ⚠（Done ⑤ 降级显式）。
			for (const entry of PANEL_ENTRIES) {
				const okMain = guardRegister("main/" + entry.key, () => ctx.effect(() => slots.inject("main", () => slots.register(
					{ name: "main", key: entry.key },
					() => jsx(entry.Panel, { onBack: () => ctx.layout.selectPanel(null) })
				)), "synova-dashboards: " + entry.log + " main cell"));
				MAIN_REGISTERED.set(entry.key, okMain);
				guardRegister("sidebar.panellist/" + entry.id, () => ctx.effect(() => slots.inject("sidebar.panellist", () => slots.register(
					{ name: "sidebar.panellist", id: entry.id, order: entry.order, label: entry.label },
					iconWithHealthFallback(entry.Icon, entry.log, entry.key)
				)), "synova-dashboards: " + entry.log + " sidebar entry"));
			}
		}

		exports.apply = apply;
		exports.inject = inject;
		/** 诊断面（只读）：注册失败清单 —— 空数组 = 三对槽位全部注册成功。 */
		exports.__synovaRegistrationDegraded = REGISTRATION_FAILURES;
		return module.exports;
	}
});
