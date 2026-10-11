/**
 * agent/boss-mailbox.ts — 老板信箱 (PRD v1.6 Slice 5, Phase 4.2)
 *
 * 每周一 9:00 触发 → 生成周报 → 飞书推送 + 邮件发送
 *
 * 铁律 24+31: 所有错误路径有 log + degraded。
 */
import { createLogger } from '@synova/logger';
import { sendEmail, renderHtmlReport } from '../services/email-service';

const log = createLogger('agent/boss-mailbox');

export interface WeeklySignal {
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  trend: 'improving' | 'stable' | 'worsening';
}

export interface ActionProgress {
  title: string;
  status: 'completed' | 'in_progress' | 'stalled';
  detail: string;
}

export interface WeeklyReport {
  subject: string;
  signals: WeeklySignal[];
  actions: ActionProgress[];
  needsAttention: string[];
  generatedAt: string;
  /** E5 / #389：④a 测量值趋势段（业务读者②——周报消费测量值时序；标定供数口径：不含轮次级） */
  measurements: MeasurementTrendView[];
  /** 测量值段降级原因（读失败不阻断周报；空数组=无降级） */
  measurementErrors?: string[];
  /** E7 / #406：④ 决策台账近期行（⑤ 交付读 ④——"本周谁裁了什么"） */
  decisions: DecisionInView[];
  /** 决策段降级原因（读回口未装配/失败不阻断周报） */
  decisionErrors?: string[];
}

/** 周报消费形态的决策行（由调用方从 ④ 台账读回并映射） */
export interface DecisionInView {
  nodeId: string;
  who: string;
  role: string | null;
  action: string;
  at: string;
  outputRef: string | null;
}

/** 周报消费形态的趋势行（由调用方从 ④a 读回并映射） */
export interface MeasurementTrendView {
  metricId: string;
  entityId: string;
  unit: string | null;
  latestValue: number | null;
  previousValue: number | null;
  changeRatio: number | null;
  latestAt: string;
}

export class BossMailbox {
  generateReport(
    orgName: string,
    week: string,
    signals: WeeklySignal[],
    actions: ActionProgress[],
    measurements: MeasurementTrendView[] = [],
    measurementErrors: string[] = [],
    decisions: DecisionInView[] = [],
    decisionErrors: string[] = [],
  ): WeeklyReport {
    const worseningSignals = signals.filter(s => s.trend === 'worsening');
    const needsAttention: string[] = [];

    for (const s of worseningSignals) {
      needsAttention.push(`${s.title}: ${s.description.slice(0, 80)}`);
    }
    for (const a of actions.filter(a => a.status === 'stalled')) {
      needsAttention.push(`搁置方案: ${a.title} — ${a.detail.slice(0, 60)}`);
    }

    return {
      subject: `Synova 周报 · ${orgName} · ${week}`,
      signals,
      actions,
      needsAttention,
      generatedAt: new Date().toISOString(),
      measurements,
      ...(measurementErrors.length > 0 ? { measurementErrors } : {}),
      decisions,
      ...(decisionErrors.length > 0 ? { decisionErrors } : {}),
    };
  }

  renderText(report: WeeklyReport): string {
    const criticalSignals = report.signals.filter(s => s.severity === 'critical');
    const warningSignals = report.signals.filter(s => s.severity === 'warning');

    let text = `${report.subject}\n\n`;

    text += '一、本周关键信号\n';
    for (const s of criticalSignals) {
      text += `  🔴 ${s.title} (${s.trend})\n    ${s.description}\n`;
    }
    for (const s of warningSignals) {
      text += `  🟡 ${s.title} (${s.trend})\n    ${s.description}\n`;
    }
    if (criticalSignals.length === 0 && warningSignals.length === 0) {
      text += '  ✅ 本周无关键信号\n';
    }

    text += '\n二、正在执行的方案进展\n';
    if (report.actions.length === 0) {
      text += '  （暂无进行中的方案）\n';
    }
    for (const a of report.actions) {
      const icon = a.status === 'completed' ? '✅' : a.status === 'stalled' ? '🔴' : '🟡';
      text += `  ${icon} ${a.title} — ${a.detail}\n`;
    }

    text += '\n二b、本周测量值趋势（指标级）\n';
    if (report.measurementErrors && report.measurementErrors.length > 0) {
      text += `  ⚠️ 测量值段降级：${report.measurementErrors.join('; ').slice(0, 120)}\n`;
    } else if ((report.measurements ?? []).length === 0) {
      text += '  （本周无指标级测量值落行）\n';
    }
    for (const m of report.measurements ?? []) {
      const change = m.changeRatio === null ? 'n/a'
        : `${m.changeRatio >= 0 ? '+' : ''}${(m.changeRatio * 100).toFixed(1)}%`;
      text += `  · ${m.metricId}[${m.entityId}] = ${m.latestValue ?? 'n/a'}${m.unit ?? ''}（环比 ${change}）\n`;
    }

    text += '\n二c、本周决策台账（谁裁了什么）\n';
    if (report.decisionErrors && report.decisionErrors.length > 0) {
      text += `  ⚠️ 决策段降级：${report.decisionErrors.join('; ').slice(0, 120)}\n`;
    } else if ((report.decisions ?? []).length === 0) {
      text += '  （本周无决策落账）\n';
    }
    for (const d of report.decisions ?? []) {
      text += `  · ${d.at.slice(0, 10)} ${d.who}${d.role ? `(${d.role})` : ''} ${d.action} ${d.nodeId}${d.outputRef ? ` → ${d.outputRef}` : ''}\n`;
    }

    text += '\n三、需要你关注的事\n';
    if (report.needsAttention.length === 0) {
      text += '  本周无特别需要关注的事项\n';
    }
    for (const n of report.needsAttention) {
      text += `  · ${n}\n`;
    }

    text += '\n— Synova Agent 自动生成';
    return text;
  }

  async pushToFeishu(report: WeeklyReport, webhookUrl: string): Promise<boolean> {
    try {
      const text = this.renderText(report);
      const payload = { msg_type: 'text', content: { text } };
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        log.warn({ status: response.status }, '飞书推送失败');
        return false;
      }
      log.info({ subject: report.subject }, '飞书推送成功');
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg }, '飞书推送异常');
      return false;
    }
  }

  /**
   * Phase 4.2: 通过 SMTP 发送周报邮件。
   * 配置 EMAIL_HOST 环境变量启用。缺失时降级。
   */
  async sendEmail(report: WeeklyReport, to: string): Promise<boolean> {
    try {
      const text = this.renderText(report);
      const html = renderHtmlReport(report);
      const result = await sendEmail({
        to,
        subject: report.subject,
        text,
        html,
      });
      if (result) {
        log.info({ to, subject: report.subject }, '周报邮件发送成功');
      } else {
        log.warn({ to, subject: report.subject }, '周报邮件发送降级');
      }
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg }, '周报邮件发送异常 — degraded');
      return false;
    }
  }
}
