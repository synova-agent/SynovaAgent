/**
 * components/LlmSetupCard.tsx — D575 首启 LLM 配置卡片（props 驱动纯展示组件）
 *
 * renderToStaticMarkup 可测（test-support/render.ts 物理约束: 纯函数组件树零 hook）——
 * 全部状态经 props 注入，表单状态由 WelcomeScreen（hook 容器）持有，本组件零 useState。
 *
 * 五态（spec §3.3.1）: idle / testing / test-ok（绿勾 maskedKey+latency）/
 * test-fail（code → 人话，零堆栈零 key 原文）/ saving；+ save-error（契约 C @degraded 落点）。
 * 错误文案来源: 服务端 message（权威人话）→ 前端 mapLlmTestError 镜像兜底。
 */
import React from 'react';
import {
  PROVIDER_OPTIONS,
  type WizardProvider,
  type LlmTestOutcome,
} from '../stores/llm-config';

export type LlmSetupPhase = 'idle' | 'testing' | 'test-ok' | 'test-fail' | 'saving' | 'save-error';

export interface LlmSetupCardProps {
  provider: WizardProvider;
  model: string;
  baseUrl: string;
  apiKey: string;
  phase: LlmSetupPhase;
  testResult: LlmTestOutcome | null;
  saveErrorMessage: string | null;
  onProviderChange: (provider: WizardProvider) => void;
  onModelChange: (model: string) => void;
  onBaseUrlChange: (baseUrl: string) => void;
  onApiKeyChange: (apiKey: string) => void;
  onTest: () => void;
  onSave: () => void;
  onSkip: () => void;
}

const LlmSetupCard: React.FC<LlmSetupCardProps> = ({
  provider,
  model,
  baseUrl,
  apiKey,
  phase,
  testResult,
  saveErrorMessage,
  onProviderChange,
  onModelChange,
  onBaseUrlChange,
  onApiKeyChange,
  onTest,
  onSave,
  onSkip,
}) => {
  const busy = phase === 'testing' || phase === 'saving';

  const handleProvider = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = PROVIDER_OPTIONS.find((p) => p.value === e.target.value)?.value;
    if (value !== undefined) onProviderChange(value);
  };

  return (
    <div className="welcome-screen fade-in">
      <div className="llm-setup-card">
        <div className="welcome-icon">🔑</div>
        <h1 className="welcome-title">配置你的分析模型</h1>
        <p className="welcome-desc">
          打开 Synova 的第一步：填入模型密钥，测试连接后即可进入。密钥只保存在本机（仅本人可读写），不会写进配置文件。
        </p>

        <div className="llm-setup-form">
          <label className="llm-setup-field">
            <span>服务商</span>
            <select name="provider" value={provider} onChange={handleProvider} disabled={busy}>
              {PROVIDER_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </label>

          <label className="llm-setup-field">
            <span>模型</span>
            <input
              name="model"
              type="text"
              value={model}
              placeholder="deepseek-chat"
              onChange={(e) => onModelChange(e.target.value)}
              disabled={busy}
            />
          </label>

          {provider === 'openai' && (
            <label className="llm-setup-field">
              <span>服务地址</span>
              <input
                name="baseUrl"
                type="text"
                value={baseUrl}
                placeholder="https://api.example.com/v1"
                onChange={(e) => onBaseUrlChange(e.target.value)}
                disabled={busy}
              />
            </label>
          )}

          <label className="llm-setup-field">
            <span>模型密钥</span>
            <input
              name="apiKey"
              type="password"
              value={apiKey}
              placeholder="sk-..."
              onChange={(e) => onApiKeyChange(e.target.value)}
              disabled={busy}
            />
          </label>
        </div>

        {phase === 'testing' && <div className="llm-setup-hint">正在测试连接…</div>}
        {phase === 'test-ok' && testResult?.ok === true && (
          <div className="llm-setup-ok">✓ 连接成功（{testResult.maskedKey} · {testResult.latencyMs}ms）</div>
        )}
        {phase === 'test-fail' && testResult?.ok === false && (
          <div className="llm-setup-error">✗ {testResult.message}</div>
        )}
        {phase === 'saving' && <div className="llm-setup-hint">正在保存…</div>}
        {phase === 'save-error' && (
          <div className="llm-setup-error">保存失败：{saveErrorMessage ?? '请稍后重试'}</div>
        )}

        <div className="welcome-actions">
          <button className="welcome-btn secondary" onClick={onTest} disabled={busy}>
            测试连接
          </button>
          <button className="welcome-btn primary" onClick={onSave} disabled={busy}>
            保存并进入
          </button>
          <button className="welcome-btn secondary" onClick={onSkip} disabled={busy}>
            暂不配置
          </button>
        </div>
      </div>
    </div>
  );
};

export { LlmSetupCard };
