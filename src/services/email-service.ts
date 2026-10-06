/**
 * services/email-service.ts — 邮件发送服务 (Phase 4.2)
 *
 * 使用 nodemailer 发送 SMTP 邮件。
 * 铁律 24+31: 所有错误路径有 log + degraded。
 * 铁律 38: 禁用不安全类型断言
 *
 * 配置（环境变量）:
 *   EMAIL_HOST       — SMTP 服务器地址
 *   EMAIL_PORT       — SMTP 端口 (默认 587)
 *   EMAIL_USER       — SMTP 用户名
 *   EMAIL_PASS       — SMTP 密码
 *   EMAIL_FROM       — 发件人地址 (默认: synova@localhost)
 *   EMAIL_FROM_NAME  — 发件人名称 (默认: Synova Agent)
 *
 * 配置缺失时降级（不自爆），log.warn 后返回 false。
 */
import { createLogger } from '@synova/logger';
import nodemailer from 'nodemailer';
// W1c/D1164（治理线，2026-10-06）: `Transporter` 必须走**具名类型导入**，不能用
//   `nodemailer.Transporter` —— 后者要求默认导入绑定在**类型位**上充当命名空间，而本树
//   `nodemailer@10` 自带的类型与 `@types/nodemailer@8` **都只提供具名导出**（均无 `export =`）
//   ⇒ TS2503「Cannot find namespace 'nodemailer'」。
//   该错误是 `TypeScript + Lint + Iron Laws`（**main 的必需 context**）唯一的阻断项：
//   实测 CI 白名单过滤后**全仓只剩这 1 条** error TS（见 D1164 note 的证据表）。
//   全仓 11/12 条近期 run 该 job 均红 ⇒ 修复前**任何非 docs-only PR 都合不了**。
import type { Transporter } from 'nodemailer';

const log = createLogger('services/email-service');

export interface EmailConfig {
  host: string; port: number; user: string; pass: string; from: string; fromName: string;
}

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  cc?: string | string[];
}

let _transporter: Transporter | null = null;

function loadConfig(): EmailConfig | null {
  const host = process.env.EMAIL_HOST;
  if (!host) return null;
  return {
    host,
    port: parseInt(process.env.EMAIL_PORT || '587', 10),
    user: process.env.EMAIL_USER || '',
    pass: process.env.EMAIL_PASS || '',
    from: process.env.EMAIL_FROM || 'synova@localhost',
    fromName: process.env.EMAIL_FROM_NAME || 'Synova Agent',
  };
}

export function initEmailService(): boolean {
  try {
    const config = loadConfig();
    if (!config) {
      log.warn('EMAIL_HOST 未设置 — 邮件服务降级');
      return false;
    }
    _transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: config.user ? { user: config.user, pass: config.pass } : undefined,
      tls: { rejectUnauthorized: false },
    });
    log.info({ host: config.host, port: config.port }, '邮件服务已初始化');
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg }, '邮件服务初始化失败 — degraded');
    _transporter = null;
    return false;
  }
}

export async function sendEmail(options: SendEmailOptions): Promise<boolean> {
  try {
    if (!_transporter) {
      const inited = initEmailService();
      if (!inited) {
        log.warn({ subject: options.subject }, '邮件服务不可用，跳过 — degraded');
        return false;
      }
    }
    const config = loadConfig()!;
    const toStr = Array.isArray(options.to) ? options.to.join(', ') : options.to;
    const ccStr = options.cc ? (Array.isArray(options.cc) ? options.cc.join(', ') : options.cc) : undefined;

    const info = await _transporter!.sendMail({
      from: `"${config.fromName}" <${config.from}>`,
      to: toStr, cc: ccStr,
      subject: options.subject,
      text: options.text,
      html: options.html || undefined,
    });
    log.info({ messageId: info.messageId, subject: options.subject }, '邮件发送成功');
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg, subject: options.subject }, '邮件发送失败 — degraded');
    return false;
  }
}

export function renderHtmlReport(report: {
  subject: string;
  signals: Array<{ severity: string; title: string; description: string; trend: string }>;
  actions: Array<{ title: string; status: string; detail: string }>;
  needsAttention: string[];
}): string {
  const signalRows = report.signals.map((s) =>
    `<tr><td>${s.severity === 'critical' ? '🔴' : s.severity === 'warning' ? '🟡' : '✅'}</td><td><strong>${s.title}</strong></td><td>${s.description}</td><td>${s.trend}</td></tr>`
  ).join('');
  const actionRows = report.actions.map((a) =>
    `<tr><td>${a.status === 'completed' ? '✅' : a.status === 'stalled' ? '🔴' : '🟡'}</td><td>${a.title}</td><td>${a.detail}</td><td>${a.status}</td></tr>`
  ).join('');
  const items = report.needsAttention.map((n) => `<li>${n}</li>`).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
body{font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1d1d1f}
h1{font-size:18px;color:#6c5ce7}
table{width:100%;border-collapse:collapse;margin:12px 0}
th,td{text-align:left;padding:8px;border-bottom:1px solid #e5e5e7;font-size:13px}
th{font-weight:600;color:#86868b;font-size:11px;text-transform:uppercase}
.footer{font-size:11px;color:#86868b;margin-top:24px;padding-top:12px;border-top:1px solid #e5e5e7}
</style></head><body>
<h1>${report.subject}</h1>
<h2>本周关键信号</h2>
<table><thead><tr><th></th><th>信号</th><th>描述</th><th>趋势</th></tr></thead><tbody>${signalRows || '<tr><td colspan="4">无关键信号</td></tr>'}</tbody></table>
<h2>方案进展</h2>
<table><thead><tr><th></th><th>方案</th><th>详情</th><th>状态</th></tr></thead><tbody>${actionRows || '<tr><td colspan="4">无进行中的方案</td></tr>'}</tbody></table>
<h2>需要关注</h2>
<ul>${items || '<li>本周无特别需要关注的事项</li>'}</ul>
<div class="footer">— Synova Agent 自动生成</div>
</body></html>`;
}
