import { create } from 'zustand';
// D538: 能力导航纯逻辑契约（状态机/权限/标签）—— store 只消费类型
import type { SelectedCap } from './capability';
// D556: GA 协同纯逻辑数据层（seed 身份读取——零 react/zustand，node 可测）
import { getSeedIdentity } from './ga-collab';

export type OnlineStatus = 'connected' | 'disconnected' | 'connecting';
export type ActiveView = 'chat' | 'dashboard' | 'settings' | 'scan';
export type ThemeMode = 'dark' | 'light';
export type UserRole = 'admin' | 'manager' | 'ga' | 'liaison' | 'staff';

export interface ClientInfo {
  orgId: string;
  name: string;
  industry: string;
  status: string;
  metrics: { flywheelSpeed: number; activeAlerts: number; pendingPlans: number };
}

export interface WorkspaceInfo {
  id: string; title: string; type: 'diagnostic' | 'manual'; updatedAt: string;
}

export interface ConversationInfo {
  id: string; title: string; preview: string; updatedAt: string;
}

/** D602: 本地通知（SSE error 帧 / main P0 push 的落点——通知中心"错误通知"段渲染源） */
export interface LocalNotification {
  id: string;
  title: string;
  body: string;
  severity: 'critical' | 'warning' | 'info';
  createdAt: string;
}

/** D602: 本地通知 FIFO 上限（第 21 条推入淘汰最旧，spec §7 用例 6） */
export const MAX_LOCAL_NOTIFICATIONS = 20;

/** D602: pushLocalNotification 入参（id/createdAt/severity 缺省时自动补全） */
export interface PushLocalNotificationInput {
  title: string;
  body: string;
  severity?: 'critical' | 'warning' | 'info';
  id?: string;
  createdAt?: string;
}

export interface AppState {
  // 面板
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  leftPanelWidth: number;
  rightPanelWidth: number;

  // 应用状态
  onlineStatus: OnlineStatus;
  alertCount: number;
  activeView: ActiveView;
  theme: ThemeMode;

  // 角色
  userRole: UserRole;
  activeWorkspaceId: string | null;
  searchQuery: string;

  // D538: 左栏能力导航选中态（null = 右栏显示默认三标签）
  selectedCap: SelectedCap;

  // GA 管理 (Phase 3.1)
  activeOrgId: string | null;
  gaClients: ClientInfo[];

  // 列表
  workspaces: WorkspaceInfo[];
  conversations: ConversationInfo[];

  // 诊断
  lastDiagnosisTime: string | null;
  currentReportId: string | null;  // Phase 3.4: 最近诊断的报告 ID
  dimensionCovered: number;
  dimensionTotal: number;

  // D575: LLM 未配置黄条（boot 判定 / 「暂不配置」置 true；保存配置置 false）
  llmUnconfigured: boolean;

  // D602: 本地通知（错误通知段；上限 MAX_LOCAL_NOTIFICATIONS FIFO）
  localNotifications: LocalNotification[];

  // Actions
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  setOnlineStatus: (s: OnlineStatus) => void;
  setAlertCount: (c: number) => void;
  setActiveView: (v: ActiveView) => void;
  toggleTheme: () => void;
  setUserRole: (r: UserRole) => void;
  setActiveWorkspaceId: (id: string | null) => void;
  setSearchQuery: (q: string) => void;
  setSelectedCap: (cap: SelectedCap) => void;
  setLeftPanelWidth: (w: number) => void;
  setRightPanelWidth: (w: number) => void;
  setDiagnosisInfo: (t: string, c: number, tot: number) => void;
  setCurrentReportId: (id: string) => void;
  setLlmUnconfigured: (v: boolean) => void;

  // D602: 本地通知
  pushLocalNotification: (n: PushLocalNotificationInput) => void;
  dismissLocalNotification: (id: string) => void;

  // GA Actions (Phase 3.1)
  setGaClients: (clients: ClientInfo[]) => void;
  setActiveOrgId: (orgId: string | null) => void;

  // D593: 会话列表真数据（GET /api/sessions → LeftPanel 挂载时写入，D591 遗留接线）
  setConversations: (list: ConversationInfo[]) => void;
}

/**
 * bootUserRole — D556 boot seed（spec §7.2）: localStorage 'synova.dev-identity' 存在且
 * role==='ga' 时初始化 userRole='ga'；无 seed / 非 ga → 'admin'（L98 原语义不变——
 * DS4: 无 seed 行为与现状完全一致）。seed 仅 dev 语义，D483-D486 落地后由真实 JWT 替代。
 *
 * D591（审计范围⑤）: 初始 workspaces/conversations 假数据删除，为空数组
 * （诚实空态优于假绿数据）；真会话列表接 GET /api/sessions 归 D593。
 */
function bootUserRole(): UserRole {
  return getSeedIdentity() ? 'ga' : 'admin';
}

// ═══ D593: 报告锚持久化（currentReportId + localStorage['synova:last-report-id']） ═══
// 对齐 D591 conversation-store 的 last-session-id 模式（提交回声/刷新恢复的单一锚点）。

/** D593: 本地报告锚 localStorage 键（spec §5.1 固定值） */
export const LAST_REPORT_ID_STORAGE_KEY = 'synova:last-report-id';

/** localStorage 安全访问（无 window/node 测试/隐私模式 → null，不抛） */
function safeLocalStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch (err) {
    // 铁律 24: 不静默——localStorage 不可达属环境降级，warn 留痕后按无存储处理
    console.warn('[app-store] localStorage 不可用，报告锚降级为内存态:',
      err instanceof Error ? err.message : String(err));
  }
  return null;
}

/**
 * readLastReportId — D593 读取本地报告锚（刷新恢复时序第 ① 步；列表端点为兜底）
 * @input  无（读 localStorage[LAST_REPORT_ID_STORAGE_KEY]）
 * @output 报告 id 字符串 | null（无键/空值/无 window → null，非异常）
 * @degraded localStorage 访问异常 → console.warn + null（不抛）
 */
export function readLastReportId(): string | null {
  const storage = safeLocalStorage();
  if (!storage) return null;
  try {
    const id = storage.getItem(LAST_REPORT_ID_STORAGE_KEY);
    return typeof id === 'string' && id.length > 0 ? id : null;
  } catch (err) {
    console.warn('[app-store] 报告锚读取失败:',
      err instanceof Error ? err.message : String(err));
    return null;
  }
}

export const useAppStore = create<AppState>((set) => ({
  leftPanelOpen: true, rightPanelOpen: true,
  leftPanelWidth: 240, rightPanelWidth: 320,
  onlineStatus: 'connecting', alertCount: 0, activeView: 'chat', theme: 'dark',

  userRole: bootUserRole(), activeWorkspaceId: null, searchQuery: '',
  selectedCap: null,
  activeOrgId: null,
  gaClients: [],

  workspaces: [], conversations: [],
  lastDiagnosisTime: null, currentReportId: readLastReportId(), dimensionCovered: 0, dimensionTotal: 8,
  llmUnconfigured: false,
  localNotifications: [],

  toggleLeftPanel: () => set((s) => ({ leftPanelOpen: !s.leftPanelOpen })),
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
  setOnlineStatus: (onlineStatus) => set({ onlineStatus }),
  setAlertCount: (alertCount) => set({ alertCount }),
  setActiveView: (activeView) => set({ activeView }),
  toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
  setUserRole: (userRole) => set({ userRole }),
  setActiveWorkspaceId: (activeWorkspaceId) => set({ activeWorkspaceId }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setSelectedCap: (selectedCap) => set({ selectedCap }),
  setLeftPanelWidth: (leftPanelWidth) => set({ leftPanelWidth }),
  setRightPanelWidth: (rightPanelWidth) => set({ rightPanelWidth }),
  setDiagnosisInfo: (time, covered, total) => set({
    lastDiagnosisTime: time, dimensionCovered: covered, dimensionTotal: total,
  }),
  // D593: 报告锚落定（同步写 localStorage；写失败不静默——内存锚仍在，仅持久化降级，铁律 24）
  setCurrentReportId: (reportId) => {
    set({ currentReportId: reportId });
    const storage = safeLocalStorage();
    if (!storage) return;
    try {
      storage.setItem(LAST_REPORT_ID_STORAGE_KEY, reportId);
    } catch (err) {
      console.warn('[app-store] 报告锚写入失败:',
        err instanceof Error ? err.message : String(err));
    }
  },
  setLlmUnconfigured: (llmUnconfigured) => set({ llmUnconfigured }),

  /**
   * pushLocalNotification — D602 本地通知入栈（铁律 47 契约）
   * @input  { title, body, severity?, id?, createdAt? }——缺省补全（id=`local-<ts>-<rand>`、
   *         createdAt=now、severity='info'）
   * @output 无（store 更新: newest-first，上限 MAX_LOCAL_NOTIFICATIONS=20 FIFO 淘汰最旧）
   * @side-effect window.electronAPI.showNotification 在场时旁路系统通知（title/body/id 透传）
   * @degraded 系统通知缺失（非 Electron）→ 跳过不抛；系统通知抛异常 → console.warn + 本地通知
   *           仍入栈（通知中心可见，铁律 24/31 不静默）
   */
  pushLocalNotification: (n) => {
    const item: LocalNotification = {
      id: n.id ?? `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: n.title,
      body: n.body,
      severity: n.severity ?? 'info',
      createdAt: n.createdAt ?? new Date().toISOString(),
    };
    set((s) => ({
      localNotifications: [item, ...s.localNotifications].slice(0, MAX_LOCAL_NOTIFICATIONS),
    }));
    try {
      const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
      if (api?.showNotification) api.showNotification(item.title, item.body, item.id);
    } catch (err) {
      console.warn('[app-store] 系统通知旁路失败（本地通知仍可见）:',
        err instanceof Error ? err.message : String(err));
    }
  },

  /** dismissLocalNotification — 按 id 移除本地通知（NotificationCenter ✕ 关闭交互消费） */
  dismissLocalNotification: (id) =>
    set((s) => ({ localNotifications: s.localNotifications.filter((n) => n.id !== id) })),

  setGaClients: (gaClients) => set({ gaClients }),
  // D593: 会话列表真数据写入（LeftPanel 挂载时 GET /api/sessions 映射后调用；D591 §5.4 决策 5 遗留闭环）
  setConversations: (conversations) => set({ conversations }),
  setActiveOrgId: (orgId) => set((s) => ({
    activeOrgId: orgId,
    activeWorkspaceId: null,    // 切换客户时重置工作区
    conversations: s.userRole === 'ga' ? s.conversations : s.conversations,
  })),
}));
