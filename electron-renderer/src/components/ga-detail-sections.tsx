/**
 * components/ga-detail-sections.tsx — D556 顾问协同纯展示组件（props 驱动，零 hook/零 store）
 *
 * 独立文件的原因（spec §3.3.1 的一处受控偏离，D333 决策）: spec 原方案将本组件置于
 * RightPanel.tsx 内——但 RightPanel 模块图含 react-markdown/zustand，二者不在 root
 * package-lock（扁平+嵌套均无实查）且 CI vitest job 仅 root npm ci → 从 root 测试 import
 * RightPanel.tsx 在 CI 必然解析失败。拆出零依赖纯展示文件后: RightPanel 容器真 import
 * 本组件（非代理桥接——容器持有全部 hooks/fetch/表单编排，本文件仅 props 渲染），
 * tests/ga-collab-ui.test.ts 可直接 renderToStaticMarkup 断言（CI 绿为 DS9 硬前提）。
 *
 * B3（#1480）：客户面只出现顾问语言（顾问／修正／经营异动／效果统计）；编号与原始枚举
 * （calibrationId／signalId／findingId／targetType 原文／角色原值）进「技术详情」折叠层。
 *
 * 契约（铁律 47 — spec §5 三块端点映射 + §8 断言矩阵）:
 *   @input  — GaDetailSectionsProps（全部数据/回调由容器注入；组件零副作用零 fetch）
 *   @output — 五场景可断言的静态结构:
 *             blocked → 「仅顾问可见」空态（零列表/零表单）；degraded → cap-degraded-banner +
 *             重试按钮 + 零假数据；其余 → 三块（data-ga-block + data-endpoint 结构标记）
 *   @degraded — 分块独立降级条（spec §5.3 不连坐）；note 原文透传（采纳率不可得显性化）
 *   @error  — 不抛（未知 phase 走 idle 分支兜底渲染）
 */
import React from 'react';
import type { GaCalibrationItem, GaCollabPhase, GaStatsData } from '../stores/ga-collab';
import { TechnicalDetails, type TechnicalDetailsItem } from './TechnicalDetails';
import { calibrationActionLabel, calibrationTargetLabel, roleLabel } from '../lib/words';

/** 三块结构标记（断言矩阵场景 2 的「三端点区块结构」物证 + spec §5.1 端点映射） */
const BLOCK_META = {
  calibration: { title: '🧬 诊断校准面板', endpoint: '/api/ga/calibration' },
  injection: { title: '📥 手动补充经营异动', endpoint: '/api/ga/calibration/signals' },
  stats: { title: '📊 反馈效果统计', endpoint: '/api/ga/calibration/stats' },
} as const;

/** 会话内注入历史条目（D551 无信号列表端点——历史 = 本会话提交回显，不伪造跨会话数据） */
export interface GaInjectedRecord {
  signalType: string;
  title: string;
  signalId: string;
  findingId: string;
  at: string;
}

export interface GaDetailSectionsProps {
  phase: GaCollabPhase;
  role: string;
  /** 块独立状态（spec §5.3 分块降级） */
  calibrationState: GaCollabPhase;
  statsState: GaCollabPhase;
  calibrations: GaCalibrationItem[];
  stats: GaStatsData | null;
  calibrationFormError: string | null;
  signalFormError: string | null;
  /** POST 回显（spec §5.1: 201 {calibrationId} / {signalId, findingId}） */
  lastCalibrationId: string | null;
  lastSignal: { signalId: string; findingId: string } | null;
  injectedHistory: GaInjectedRecord[];
  submitting: boolean;
  onRetry: () => void;
  onCalibrationSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onSignalSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
}

const Empty: React.FC<{ text: string }> = ({ text }) => (
  <div className="empty-state" style={{ padding: '16px 8px' }}>
    <div className="empty-state-text" style={{ fontSize: 11 }}>{text}</div>
  </div>
);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="sb-section"><div className="sb-section-title">{title}</div>{children}</section>
);

function formatTime(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ');
}

/** 块 1: 修正记录 + 四动作表单（spec §5.1 端点 1/2） */
const CalibrationBlock: React.FC<GaDetailSectionsProps> = (props) => (
  <div className="cap-detail-card" data-ga-block="calibration" data-endpoint={BLOCK_META.calibration.endpoint}>
    <div className="cap-detail-title">{BLOCK_META.calibration.title}</div>
    {props.calibrationState === 'loading' && <div className="ga-block-note">正在读取修正记录…</div>}
    {props.calibrationState === 'degraded' && (
      <div className="cap-degraded-banner">⚠ 修正记录暂时读不到，请稍后重试</div>
    )}
    {props.calibrationState === 'blocked' && (
      <div className="cap-degraded-banner">⚠ 当前账号无权查看这项内容（仅顾问可见）</div>
    )}
    {props.calibrationState === 'loaded' && props.calibrations.length === 0 && (
      <Empty text="暂无校准记录" />
    )}
    {props.calibrationState === 'loaded' && props.calibrations.map((item) => {
      const details: TechnicalDetailsItem[] = [
        { label: '修正编号', value: item.calibrationId },
        { label: '目标编号', value: item.targetId },
        { label: '动作原文', value: item.action },
        { label: '目标类型原文', value: item.targetType },
        { label: '被取代条目', value: item.supersedes ?? '' },
      ];
      return (
        <div key={item.calibrationId} className="ga-calibration-item">
          <div style={{ fontSize: 11 }}>
            {calibrationActionLabel(item.action)} · {calibrationTargetLabel(item.targetType)}
            {item.supersededBy ? ' · 已被取代' : ''}
          </div>
          <div style={{ fontSize: 10, color: 'var(--dim)' }}>
            {formatTime(item.calibratedAt)}
          </div>
          <TechnicalDetails items={details} />
        </div>
      );
    })}
    <form data-ga-form="calibration" onSubmit={props.onCalibrationSubmit}>
      <select name="action" aria-label="校准动作">
        <option value="mark_error">标记错误</option>
        <option value="add_context">补充背景</option>
        <option value="rewrite_logic">修正逻辑</option>
        <option value="demote_signal">调低该预警的优先级</option>
      </select>
      <select name="targetType" aria-label="目标类型">
        <option value="diagnosis_conclusion">诊断结论</option>
        <option value="diagnosis_logic">诊断逻辑</option>
        <option value="signal_relevance">预警信号</option>
      </select>
      <input name="targetId" placeholder="目标 ID（结论/逻辑/信号）" />
      <select name="errorType" aria-label="错误类型（标记错误用）">
        <option value="事实错误">事实错误</option>
        <option value="归因错误">归因错误</option>
        <option value="遗漏关键信息">遗漏关键信息</option>
        <option value="过于笼统">过于笼统</option>
      </select>
      <input name="correctedContent" placeholder="正确信息或补充说明（标记错误用）" />
      <input name="contextCard" placeholder="背景卡片（补充背景用）" />
      <input name="originalVersion" placeholder="原版本 ID（修正逻辑用）" />
      <input name="rewrittenVersion" placeholder="新版本 ID（修正逻辑用）" />
      <input name="sentinelId" placeholder="预警项（调低优先级用）" />
      <input name="supersedes" placeholder="被取代条目 ID（可选，版本链）" />
      {props.calibrationFormError && <div className="ga-form-error">⚠ {props.calibrationFormError}</div>}
      {props.lastCalibrationId && (
        <div className="ga-submit-ok" data-calibration-id={props.lastCalibrationId}>
          ✓ 修正已提交（编号见技术详情）
          <TechnicalDetails items={[{ label: '修正编号', value: props.lastCalibrationId }]} />
        </div>
      )}
      <button className="ga-submit-btn" type="submit" disabled={props.submitting}>提交修正</button>
    </form>
  </div>
);

/** 块 2: 五要素经营异动补充表单（spec §5.1 端点 3；蓝图 §3.3.1 五要素） */
const InjectionBlock: React.FC<GaDetailSectionsProps> = (props) => (
  <div className="cap-detail-card" data-ga-block="injection" data-endpoint={BLOCK_META.injection.endpoint}>
    <div className="cap-detail-title">{BLOCK_META.injection.title}</div>
    <form data-ga-form="signal" onSubmit={props.onSignalSubmit}>
      <select name="signalType" aria-label="信号类型">
        <option value="人员变动">人员变动</option>
        <option value="战略转向">战略转向</option>
        <option value="竞品动态">竞品动态</option>
        <option value="客户反馈">客户反馈</option>
        <option value="监管变化">监管变化</option>
        <option value="供应商变化">供应商变化</option>
        <option value="市场传闻">市场传闻</option>
        <option value="技术突破">技术突破</option>
        <option value="内部冲突">内部冲突</option>
        <option value="其他">其他</option>
      </select>
      <input name="title" placeholder="信号标题" />
      <input name="description" placeholder="信号描述" />
      <input name="severity" type="number" placeholder="严重度 1-10" />
      <input name="confidence" type="number" placeholder="置信度 0-100" />
      <input name="relatedEdges" placeholder="关联边（逗号分隔，可选）" />
      <input name="relatedNodes" placeholder="关联节点（逗号分隔，可选）" />
      {props.signalFormError && <div className="ga-form-error">⚠ {props.signalFormError}</div>}
      {props.lastSignal && (
        <div className="ga-submit-ok" data-finding-id={props.lastSignal.findingId}>
          ✓ 已补充经营异动（编号见技术详情）
          <TechnicalDetails items={[
            { label: '经营异动编号', value: props.lastSignal.signalId },
            { label: '发现编号', value: props.lastSignal.findingId },
          ]} />
        </div>
      )}
      <button className="ga-submit-btn" type="submit" disabled={props.submitting}>补充经营异动</button>
    </form>
    {props.injectedHistory.length > 0 && (
      <div className="ga-injected-history">
        <div style={{ fontSize: 10, color: 'var(--dim)' }}>已补充记录（本次分析）</div>
        {props.injectedHistory.map((rec, i) => (
          <div key={i} className="ga-injected-item" style={{ fontSize: 10 }}>
            · {rec.title}（{rec.signalType}） · {formatTime(rec.at)}
            <TechnicalDetails items={[
              { label: '经营异动编号', value: rec.signalId },
              { label: '发现编号', value: rec.findingId },
            ]} />
          </div>
        ))}
      </div>
    )}
  </div>
);

/** 块 3: 效果统计（spec §5.1 端点 4；note 原文透传 = 诚实降级显性化，禁采纳率伪造） */
const StatsBlock: React.FC<GaDetailSectionsProps> = (props) => (
  <div className="cap-detail-card" data-ga-block="stats" data-endpoint={BLOCK_META.stats.endpoint}>
    <div className="cap-detail-title">{BLOCK_META.stats.title}</div>
    {props.statsState === 'loading' && <div className="ga-block-note">正在读取效果统计…</div>}
    {props.statsState === 'degraded' && (
      <div className="cap-degraded-banner">⚠ 效果统计暂时读不到，请稍后重试</div>
    )}
    {props.statsState === 'blocked' && (
      <div className="cap-degraded-banner">⚠ 当前账号无权查看这项内容（仅顾问可见）</div>
    )}
    {props.statsState === 'loaded' && props.stats && (
      <div className="ga-stats-body">
        <div style={{ fontSize: 11 }}>校准累计 <span className="ga-stat-num">{props.stats.calibration.total}</span></div>
        <div style={{ fontSize: 11 }}>累计补充条数 <span className="ga-stat-num">{props.stats.injection.total}</span></div>
        <div style={{ fontSize: 11 }}>已被采纳的反馈数 <span className="ga-stat-num">{props.stats.reflux.feedbackCount}</span></div>
        {props.stats.note && (
          <div className="ga-stats-note" data-honesty="note" style={{ fontSize: 10, color: 'var(--dim)' }}>
            {props.stats.note}
          </div>
        )}
      </div>
    )}
    {props.statsState === 'loaded' && !props.stats && <Empty text="暂无效果统计" />}
    <button className="ga-refresh-btn" onClick={props.onRetry} disabled={props.submitting}>刷新统计</button>
  </div>
);

/**
 * GaDetailSections — 顾问协同三块纯展示（容器: RightPanel.tsx GaDetail）。
 * @input  — props（见 GaDetailSectionsProps）
 * @output — phase 分派: blocked → 仅顾问可见空态（零列表/零表单——spec §5.2 fail-closed）；
 *           degraded → 整面板降级条 + 重试 + 零假数据（spec §5.3）；其余 → 三块结构
 *           （各块按独立状态渲染数据/加载/降级条）
 * @degraded — 降级文案 + 重试，零假数据（铁律 8）
 * @error  — 不抛
 */
export const GaDetailSections: React.FC<GaDetailSectionsProps> = (props) => {
  const role = roleLabel(props.role);
  if (props.phase === 'blocked') {
    return (
      <Section title="顾问协同（仅顾问可见）">
        <div className="empty-state" data-ga-block="blocked-empty" style={{ padding: '12px 8px' }}>
          <div className="empty-state-text" style={{ fontSize: 11 }}>
            仅顾问可见 — 当前角色{role === null ? '' : `（${role}）`}无权访问顾问协同面板
          </div>
          <TechnicalDetails items={[{ label: '角色原文', value: props.role }]} />
        </div>
      </Section>
    );
  }
  if (props.phase === 'degraded') {
    return (
      <Section title="顾问协同">
        <div className="cap-degraded-banner">⚠ 顾问协同暂时读不到，请稍后重试</div>
        <Empty text="顾问协同数据暂时读不到（修正记录与效果统计均未能获取）" />
        <button className="ga-retry-btn" onClick={props.onRetry}>重试</button>
      </Section>
    );
  }
  return (
    <Section title="顾问协同">
      {props.phase === 'loading' && <div className="ga-block-note">正在读取顾问协同数据…</div>}
      {props.phase === 'idle' && <Empty text="顾问协同面板尚未加载" />}
      <CalibrationBlock {...props} />
      <InjectionBlock {...props} />
      <StatsBlock {...props} />
    </Section>
  );
};
