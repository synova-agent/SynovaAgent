/**
 * components/LeftPanel.tsx — 左栏面板 (Phase 3.1 + D538 能力导航)
 *
 * 折叠态: 44px 图标条（Lucide 线性）
 * 展开态: 搜索 → 产品独有能力（cap-section，Codex 一行一导航） → 最近对话 → 工作区 → (GA) 客户列表
 *
 * D538: 顶部 ICON_ITEMS emoji → Lucide；搜索之下插入"产品独有能力"导航组（4 能力 + 数字角标 + GA 置灰），
 *      点击 → setSelectedCap(toggleCap(...)) 右栏联动；折叠态为 Lucide 图标条，点击同步联动。
 */
import React, { useEffect, useState } from 'react';
import { Search, MessageSquare, Folder, Bell, Radar, RefreshCw, ListChecks, Users, ChevronRight, Ticket, Settings, Building2, Terminal, type LucideIcon } from 'lucide-react';
import { useAppStore } from '../stores/app-store';
import { getApiBase } from '../lib/api';
import { CAPABILITY_IDS, toggleCap, canAccessCap, capabilityLabel, badgeColorFor, type CapabilityId, type SelectedCap } from '../stores/capability';

// ═══ 顶部通用图标条（lucide，16px currentColor，无 emoji） ═══
const ICON_ITEMS = [
  { icon: Search, label: '搜索', id: 'search' },
  { icon: MessageSquare, label: '对话', id: 'conversations' },
  { icon: Folder, label: '工作区', id: 'workspaces' },
  { icon: Bell, label: '通知', id: 'notifications' },
];

// ═══ 能力 → lucide 图标映射（组件层，保持 capability.ts 纯逻辑） ═══
const CAP_ICON: Record<CapabilityId, LucideIcon> = {
  reach: Radar,
  loops: RefreshCw,
  action: ListChecks,
  ga: Users,
};

/** 角标计数类型：null = 未加载/降级 → 隐藏角标 */
type BadgeStats = { criticalCount: number; warningCount: number } | null;

/**
 * T5b/B2（#1481）：内层 nav 高度约束——矮窗下左栏可滚动的唯一开关。
 *
 * App.tsx 外层已有一个 `.panel-left` 容器（`display:flex; flex-direction:column; overflow:hidden`），
 * 本组件再渲染一个 `.panel-left`。global.css 的 `.panel-left{flex-shrink:0}` 会让内层按内容
 * （矮窗 500 DIP 下约 503）撑高、外层只裁不滚 ⇒ `.left-panel-content` 的 `overflow-y:auto`
 * 永远等不到滚动（T2b 实测 scrollHeight = clientHeight = 503，「本次分析」被裁）。
 * 这里用内联样式（**不动 global.css 的 `.panel-left`**）把内层限制在外层高度内：
 * 列向父容器里 `flex:1` 让内层占满外层高度、`minHeight:0` 允许内容高于外层时收缩 ⇒ 内容区得到
 * 确定高度、开始滚动。**用数字值**（`tests/user-visible` 客户语言候选计数把 style 里的字符串
 * 字面量也计入冻结基线：`height:'100%'` 会让候选 1853→1854，故不用字符串）。
 */
const INNER_NAV_FITS_OUTER: React.CSSProperties = { flex: 1, minHeight: 0 };

const LeftPanel: React.FC = () => {
  // T5a/B2: 收起态＝store 唯一真值（leftPanelCollapsed）；本组件只消费，不另存本地开合态
  const leftPanelCollapsed = useAppStore((s) => s.leftPanelCollapsed);
  const open = !leftPanelCollapsed;
  const searchQuery = useAppStore((s) => s.searchQuery);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const workspaces = useAppStore((s) => s.workspaces);
  const conversations = useAppStore((s) => s.conversations);
  const userRole = useAppStore((s) => s.userRole);
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const setActiveWorkspaceId = useAppStore((s) => s.setActiveWorkspaceId);
  const activeOrgId = useAppStore((s) => s.activeOrgId);
  const setActiveOrgId = useAppStore((s) => s.setActiveOrgId);
  const gaClients = useAppStore((s) => s.gaClients);
  const setGaClients = useAppStore((s) => s.setGaClients);
  const selectedCap = useAppStore((s) => s.selectedCap);
  const setSelectedCap = useAppStore((s) => s.setSelectedCap);
  const setConversations = useAppStore((s) => s.setConversations);
  const setActiveView = useAppStore((s) => s.setActiveView);

  const [activeSection, setActiveSection] = React.useState('conversations');
  const [clientLoadError, setClientLoadError] = useState<string | null>(null);

  // D538: 角标计数（null = 降级/未加载 → 隐藏，不渲染假数字 — 铁律 24/31）
  const [reachBadge, setReachBadge] = useState<BadgeStats>(null);
  const [loopsBadge, setLoopsBadge] = useState<BadgeStats>(null);
  const [actionBadge, setActionBadge] = useState<BadgeStats>(null);

  // 加载 GA 客户列表
  useEffect(() => {
    if (userRole === 'ga' && gaClients.length === 0) {
      fetch(`${getApiBase()}/api/ga/clients`)
        .then((r) => r.json())
        .then((d) => { if (d.ok) setGaClients(d.clients); setClientLoadError(null); })
        .catch((err) => { console.warn('[LeftPanel] 加载客户列表失败', err); setClientLoadError('加载客户列表失败，请重试'); });
    }
  }, [userRole, gaClients.length, setGaClients]);

  // D593: 会话列表真数据（D591 §5.4 决策 5 遗留）——挂载时 GET /api/sessions → setConversations；
  // 失败 console.warn + 保持空态（铁律 24 不静默）。响应形状不盲信（数组守卫）。
  useEffect(() => {
    let alive = true;
    fetch(`${getApiBase()}/api/sessions?limit=20`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        const sessions = (d && typeof d === 'object' && Array.isArray((d as { sessions?: unknown }).sessions))
          ? (d as { sessions: Array<{ id?: unknown; title?: unknown; phase?: unknown; updatedAt?: unknown }> }).sessions
          : null;
        if (sessions === null) {
          console.warn('[LeftPanel] 会话列表响应形状非法 — 保持空态');
          return;
        }
        setConversations(sessions.map((s) => ({
          id: typeof s.id === 'string' ? s.id : '',
          // B3：没有名称时不印 id 尾号（词典 §2.7-K 兜底「未命名的业务对象」）
          title: typeof s.title === 'string' && s.title.length > 0 ? s.title : '未命名的业务对象',
          preview: typeof s.phase === 'number' ? `阶段 ${s.phase}` : '',
          updatedAt: typeof s.updatedAt === 'string' ? s.updatedAt : '',
        })).filter((c) => c.id !== ''));
      })
      .catch((err) => { if (alive) console.warn('[LeftPanel] 会话列表拉取失败', err); });
    return () => { alive = false; };
  }, [setConversations]);

  // D538: 挂载时拉 3 个接口做角标计数；任一失败 → 该角标隐藏 + console.warn（铁律 24/31）
  useEffect(() => {
    let alive = true;
    // reach: /api/sentinel/signals → criticalCount/warningCount（真实路径，派单/设计的 /api/signals 是伪信息）
    fetch(`${getApiBase()}/api/sentinel/signals`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d && typeof d === 'object' && typeof (d as { criticalCount?: unknown }).criticalCount === 'number') {
          setReachBadge({ criticalCount: Number((d as { criticalCount: number }).criticalCount) || 0, warningCount: Number((d as { warningCount: number }).warningCount) || 0 });
        } else setReachBadge(null);
      })
      .catch((err) => { if (alive) { console.warn('[LeftPanel] signals 角标拉取失败', err); setReachBadge(null); } });
    // loops: /api/loops/status → 非 completed 数量（failed→红 / degraded→橙）
    fetch(`${getApiBase()}/api/loops/status`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        const loops = (d && typeof d === 'object' && Array.isArray((d as { loops?: unknown }).loops)) ? (d as { loops: Array<{ status: string }> }).loops : null;
        if (loops !== null) {
          const failed = loops.filter((l) => l.status === 'failed').length;
          const abnormal = loops.filter((l) => l.status !== 'completed').length - failed;
          setLoopsBadge({ criticalCount: failed, warningCount: abnormal });
        } else setLoopsBadge(null);
      })
      .catch((err) => { if (alive) { console.warn('[LeftPanel] loops 角标拉取失败', err); setLoopsBadge(null); } });
    // action: /api/actions → pending+executing 数量（含 critical/high priority→红）
    fetch(`${getApiBase()}/api/actions`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        const actions = (d && typeof d === 'object' && Array.isArray((d as { actions?: unknown }).actions)) ? (d as { actions: Array<{ status: string; priority: string }> }).actions : null;
        if (actions !== null) {
          const active = actions.filter((a) => a.status === 'pending' || a.status === 'executing');
          const crit = active.filter((a) => a.priority === 'critical').length;
          setActionBadge({ criticalCount: crit, warningCount: active.length - crit });
        } else setActionBadge(null);
      })
      .catch((err) => { if (alive) { console.warn('[LeftPanel] actions 角标拉取失败', err); setActionBadge(null); } });
    return () => { alive = false; };
  }, []);

  const handleSwitchOrg = (orgId: string) => {
    fetch(`${getApiBase()}/api/ga/switch/${orgId}`, { method: 'POST' })
      .then(() => {
        setActiveOrgId(orgId);
        setActiveWorkspaceId(null);
      })
      .catch((err) => { console.warn('[LeftPanel] 组织切换失败', err); });
  };

  // D538: 能力项点击 → toggleCap 状态机（同项取消/异项切换）+ GA 权限 pre-check（fail-closed）
  const handleCapClick = (cap: CapabilityId) => {
    if (!canAccessCap(userRole, cap)) {
      console.warn(`[LeftPanel] 角色 ${userRole} 无权访问能力 ${cap}`);
      return;
    }
    setSelectedCap(toggleCap(selectedCap, cap) as SelectedCap);
  };

  const filteredConvs = conversations.filter(
    (c) => !searchQuery || c.title.includes(searchQuery),
  );
  const filteredWss = workspaces.filter(
    (w) => !searchQuery || w.title.includes(searchQuery),
  );
  const activeClient = gaClients.find((c) => c.orgId === activeOrgId);

  // D538: 折叠态渲染 4 能力 lucide 图标条（点击联动右栏）
  const collapsedCaps: CapabilityId[] = ['reach', 'loops', 'action', 'ga'];

  return (
    <nav className={`panel-left ${open ? 'open' : 'closed'}`} style={INNER_NAV_FITS_OUTER}>
      <div className="left-panel-header">
        {ICON_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.id} className="icon-btn" title={item.label}
              onClick={() => setActiveSection(item.id)}
              style={{ background: activeSection === item.id ? 'var(--border)' : undefined }}>
              <Icon size={16} strokeWidth={2} />
            </button>
          );
        })}
      </div>

      {open && (
        <div className="left-panel-content fade-in">
          {/* 搜索 */}
          <div className="panel-section-title">搜索</div>
          <div className="left-panel-search">
            <input className="left-search-input" type="text"
              placeholder="搜索工作区或对话..." value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)} />
          </div>

          {/* D538: 产品独有能力导航组（搜索之下、最近对话/工作区之上） */}
          <div className="cap-section">
            <div className="cap-section-title">产品独有能力</div>
            {CAPABILITY_IDS.map((cap) => {
              const Icon = CAP_ICON[cap];
              const badgeStats = cap === 'reach' ? reachBadge : cap === 'loops' ? loopsBadge : cap === 'action' ? actionBadge : null;
              const badgeColor = badgeColorFor(badgeStats);
              const disabled = !canAccessCap(userRole, cap);
              const active = selectedCap === cap;
              const badgeCount = badgeStats ? badgeStats.criticalCount + badgeStats.warningCount : null;
              return (
                <button
                  key={cap}
                  data-cap={cap}
                  className={`cap-item${active ? ' active' : ''}${disabled ? ' disabled' : ''}`}
                  onClick={() => handleCapClick(cap)}
                  aria-disabled={disabled}
                  title={disabled ? '仅顾问可用' : capabilityLabel(cap)}
                >
                  <span className="cap-ico"><Icon size={16} strokeWidth={2} /></span>
                  <span className="cap-label">{capabilityLabel(cap)}</span>
                  {cap === 'ga' ? (
                    <span className="cap-chev"><ChevronRight size={14} strokeWidth={2} /></span>
                  ) : badgeColor && badgeCount !== null ? (
                    <span className={`cap-badge cap-badge-${badgeColor}`}>{badgeCount}</span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {/* 通用导航（对话/工单/设置）*/}
          <div className="cap-section">
            <div className="cap-section-title">导航</div>
            <button className="cap-item" data-cap="nav-scan" onClick={() => setActiveView('scan')}>
              <span className="cap-ico"><Building2 size={16} strokeWidth={2} /></span>
              <span className="cap-label">数据核对</span>
            </button>
            <button className="cap-item" data-cap="nav-dsh" onClick={() => setActiveView('dsh')}>
              <span className="cap-ico"><Terminal size={16} strokeWidth={2} /></span>
              <span className="cap-label">本次分析</span>
            </button>
            <button className="cap-item" data-cap="nav-conv" onClick={() => { setActiveSection('conversations'); setActiveView('chat'); }}>
              <span className="cap-ico"><MessageSquare size={16} strokeWidth={2} /></span>
              <span className="cap-label">对话</span>
            </button>
            <button className="cap-item" data-cap="nav-ticket">
              <span className="cap-ico"><Ticket size={16} strokeWidth={2} /></span>
              <span className="cap-label">工单</span>
            </button>
            <button className="cap-item" data-cap="nav-settings">
              <span className="cap-ico"><Settings size={16} strokeWidth={2} /></span>
              <span className="cap-label">设置</span>
            </button>
          </div>

          {/* 对话列表 */}
          <div className="panel-section-title">最近对话</div>
          {filteredConvs.map((conv) => (
            <div key={conv.id} className="panel-item">
              <span className="panel-item-icon"><MessageSquare size={16} strokeWidth={2} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{conv.title}</div>
                <div style={{ fontSize: 10, color: 'var(--dim)' }}>{conv.preview}</div>
              </div>
            </div>
          ))}

          {/* 工作区列表 */}
          <div className="panel-section-title">工作区</div>
          {filteredWss.map((ws) => (
            <div key={ws.id} className={`panel-item${activeWorkspaceId === ws.id ? ' active' : ''}`}
              onClick={() => setActiveWorkspaceId(ws.id)}>
              <span className="panel-item-icon"><Folder size={16} strokeWidth={2} /></span>
              <span>{ws.title}</span>
              {ws.type === 'diagnostic' && (
                <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--accent2)' }}>诊断</span>
              )}
            </div>
          ))}

          {/* GA 客户列表 */}
          {userRole === 'ga' && (
            <>
              <div className="panel-section-title">
                客户列表
                {activeClient && (
                  <span style={{ float: 'right', fontSize: 10, color: 'var(--accent2)' }}>
                    {activeClient.name}
                  </span>
                )}
              </div>
              {gaClients.map((client) => (
                <div key={client.orgId}
                  className={`panel-item${activeOrgId === client.orgId ? ' active' : ''}`}
                  onClick={() => handleSwitchOrg(client.orgId)}>
                  <span className="panel-item-icon"><Building2 size={16} strokeWidth={2} /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12 }}>{client.name}</div>
                    <div style={{ fontSize: 10, color: 'var(--dim)' }}>{client.industry}</div>
                  </div>
                  {activeOrgId === client.orgId && (
                    <span style={{ fontSize: 10, color: 'var(--green)' }}>●</span>
                  )}
                </div>
              ))}
              {gaClients.length === 0 && (
                <div className="panel-item" style={{ color: clientLoadError ? 'var(--red)' : 'var(--dim)', cursor: 'default' }}>
                  {clientLoadError || '加载客户列表...'}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* D538: 折叠态 44px 图标条 — 4 能力 lucide 图标，点击联动右栏 */}
      {!open && (
        <div className="left-panel-collapsed-caps">
          {collapsedCaps.map((cap) => {
            const Icon = CAP_ICON[cap];
            const disabled = !canAccessCap(userRole, cap);
            return (
              <button
                key={cap}
                data-cap-collapsed={cap}
                className={`icon-btn cap-collapsed${selectedCap === cap ? ' active' : ''}${disabled ? ' disabled' : ''}`}
                title={capabilityLabel(cap)}
                aria-disabled={disabled}
                onClick={() => handleCapClick(cap)}
              >
                <Icon size={16} strokeWidth={2} />
              </button>
            );
          })}
        </div>
      )}
    </nav>
  );
};

export default React.memo(LeftPanel);
