/**
 * hooks/useKeyboard.ts — 全局快捷键 (Phase 2.2)
 *
 * Ctrl+B  = 切换左栏（T5a/B2：与 TitleBar 可见控件共用 app-store 的 toggleLeftPanel——唯一 action）
 * Ctrl+J  = 切换右栏
 * Ctrl+K  = 命令面板
 * Ctrl+F  = 搜索对话
 * Ctrl+N  = 新建工作区
 * Ctrl+Enter = 发送消息
 */
import { useEffect } from 'react';

export interface KeyboardHandlers {
  /** 左栏开合（T5a/B2：必须是 store 的 toggleLeftPanel 本体，不得在此另写一套翻转逻辑） */
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  openCommandPalette?: () => void;
  searchConversation?: () => void;
  newWorkspace?: () => void;
  sendMessage?: () => void;
}

export function useKeyboard(handlers: KeyboardHandlers): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return;

      switch (e.key.toLowerCase()) {
        case 'b':
          e.preventDefault();
          handlers.toggleLeftPanel();
          break;
        case 'j':
          e.preventDefault();
          handlers.toggleRightPanel();
          break;
        case 'k':
          e.preventDefault();
          handlers.openCommandPalette?.();
          break;
        case 'f':
          e.preventDefault();
          handlers.searchConversation?.();
          break;
        case 'n':
          e.preventDefault();
          handlers.newWorkspace?.();
          break;
        case 'enter':
          e.preventDefault();
          handlers.sendMessage?.();
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handlers]);
}
