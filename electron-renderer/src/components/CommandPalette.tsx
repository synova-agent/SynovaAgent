/**
 * components/CommandPalette.tsx — 全局命令面板 (Phase 2.2)
 *
 * Ctrl+K 打开. 输入关键词实时搜索:
 * - 工作区 (标题匹配)
 * - 对话历史 (标题/预览匹配)
 * - 命令 (/诊断, /摘要, /导出, /方案)
 * - 哨兵数据 (sentinelId 匹配)
 *
 * Escape 关闭. 点击结果项执行对应动作.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../stores/app-store';
import type { WorkspaceInfo, ConversationInfo } from '../stores/app-store';
import { TechnicalDetails } from './TechnicalDetails';
import { searchTypeLabel } from '../lib/words';

interface SearchItem {
  id: string;
  type: 'workspace' | 'conversation' | 'command' | 'sentinel';
  title: string;
  subtitle?: string;
  icon: string;
}

const COMMANDS: SearchItem[] = [
  { id: 'diag', type: 'command', title: '/诊断', subtitle: '启动全面组织诊断', icon: '🔍' },
  { id: 'summary', type: 'command', title: '/摘要', subtitle: '生成当前会话摘要', icon: '📝' },
  { id: 'export', type: 'command', title: '/导出', subtitle: '导出诊断报告', icon: '📤' },
  { id: 'plan', type: 'command', title: '/方案', subtitle: '生成落地执行方案', icon: '📋' },
];

const SENTINELS: SearchItem[] = [
  { id: 'F1', type: 'sentinel', title: '现金流预警', subtitle: '监测现金流健康度', icon: '💰' },
  { id: 'O1', type: 'sentinel', title: '组织健康度', subtitle: '团队结构与协作', icon: '🏢' },
  { id: 'T4', type: 'sentinel', title: '技术债务', subtitle: '软件质量与维护', icon: '⚙️' },
  { id: 'D1', type: 'sentinel', title: '增长飞轮', subtitle: '收入增长指标', icon: '📈' },
];

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

const CommandPalette: React.FC<CommandPaletteProps> = ({ open, onClose }) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const workspaces = useAppStore((s) => s.workspaces);
  const conversations = useAppStore((s) => s.conversations);
  const setActiveWorkspaceId = useAppStore((s) => s.setActiveWorkspaceId);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // 构建搜索结果
  const allItems = useCallback((): SearchItem[] => {
    const q = query.toLowerCase().trim();
    if (!q) {
      // 无查询时显示全部
      return [
        ...COMMANDS,
        ...workspaces.map((w: WorkspaceInfo) => ({
          id: w.id, type: 'workspace' as const, title: w.title,
          subtitle: w.type === 'diagnostic' ? '诊断工作区' : '手动创建', icon: '📁',
        })),
        ...conversations.map((c: ConversationInfo) => ({
          id: c.id, type: 'conversation' as const, title: c.title,
          subtitle: c.preview, icon: '💬',
        })),
        ...SENTINELS,
      ];
    }
    const results: SearchItem[] = [];
    for (const list of [COMMANDS, SENTINELS]) {
      for (const item of list) {
        if (item.title.toLowerCase().includes(q) || (item.subtitle || '').toLowerCase().includes(q)) {
          results.push(item);
        }
      }
    }
    for (const ws of workspaces) {
      if (ws.title.toLowerCase().includes(q)) {
        results.push({ id: ws.id, type: 'workspace', title: ws.title, subtitle: '工作区', icon: '📁' });
      }
    }
    for (const conv of conversations) {
      if (conv.title.toLowerCase().includes(q) || conv.preview.toLowerCase().includes(q)) {
        results.push({ id: conv.id, type: 'conversation', title: conv.title, subtitle: conv.preview, icon: '💬' });
      }
    }
    return results;
  }, [query, workspaces, conversations]);

  const items = allItems();

  const handleSelect = (item: SearchItem) => {
    if (item.type === 'workspace') setActiveWorkspaceId(item.id);
    // Phase 2.3+: 执行命令/跳转对话
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, items.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)); return; }
    if (e.key === 'Enter' && items[selectedIndex]) { handleSelect(items[selectedIndex]); return; }
  };

  if (!open) return null;

  return (
    <div className="cmd-palette-overlay" onClick={onClose}>
      <div className="cmd-palette" onClick={(e) => e.stopPropagation()}>
        <div className="cmd-palette-input-row">
          <span className="cmd-palette-icon">⌘</span>
          <input
            ref={inputRef}
            className="cmd-palette-input"
            type="text"
            placeholder="搜索工作区、对话、命令..."
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
            onKeyDown={handleKeyDown}
          />
          <kbd className="cmd-palette-esc" onClick={onClose}>Esc</kbd>
        </div>

        <div className="cmd-palette-results">
          {items.length === 0 && (
            <div className="cmd-palette-empty">无匹配结果</div>
          )}
          {items.map((item, i) => (
            <button
              key={`${item.type}-${item.id}`}
              className={`cmd-palette-item${i === selectedIndex ? ' selected' : ''}`}
              onClick={() => handleSelect(item)}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <span className="cmd-palette-item-icon">{item.icon}</span>
              <div className="cmd-palette-item-body">
                <div className="cmd-palette-item-title">{item.title}</div>
                {item.subtitle && (
                  <div className="cmd-palette-item-sub">{item.subtitle}</div>
                )}
              </div>
              <span className="cmd-palette-item-type">{searchTypeLabel(item.type)}</span>
            </button>
          ))}
        </div>

        <div className="cmd-palette-footer">
          <span>↑↓ 导航</span>
          <span>Enter 选择</span>
          <span>Esc 关闭</span>
        </div>
        <TechnicalDetails
          items={items.length === 0
            ? []
            : [{ label: '结果原始类型', value: items.map((item) => `${item.title}:${item.type}`).join('；') }]}
        />
      </div>
    </div>
  );
};

export default React.memo(CommandPalette);
