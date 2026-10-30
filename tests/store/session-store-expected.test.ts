/**
 * tests/store/session-store-expected.test.ts — R-E1 ①g 测试义务：expected 资产消费者
 *
 * 为什么有这个文件：`tests/contract/triviality-manifest.yaml` 把 `src/store/session-store.ts`
 * 登记为 `surface: protocol / obligation: expected / asset_glob: tests/expected/session/**`
 * ⇒ 一旦该模块进入变更集，CI ①g 要求补 `tests/expected/session/` 资产（裁 332/353）。
 * 本文件是资产的**消费者与断言方**：资产不是文档，是冻结协议面（改行为 ⇒ 本文件红）。
 *
 * 契约（铁律 47）:
 *   @input   测试内构造的 SessionStore（内存 SQLite）＋ tests/expected/session/session-store.expected.json
 *   @output  逐 case 断言；任一不符 ⇒ vitest 红（含期望值/实得值）
 *   @degraded 资产缺文件/JSON 解析失败 ⇒ 抛错（测试红，不静默跳过——铁律 24/11）
 *   @error   不适用（测试文件）
 *
 * Known Limitations:
 *   · 只冻结「协议面」五案（结果形状/原子性/连续/log-only/cap）；耗时、并发进程数不进资产
 *     （并发归 tests/store/session-seq-concurrency.test.ts 的 20 进程实证）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { SessionStore, SessionEventError } from '../../src/store/session-store';

interface ExpectedAsset {
  schema: string;
  module: string;
  issue: string;
  cases: {
    addMessageSuccess: { result: { ok: boolean; seq: number }; agentMessagesRows: number; sessionEventsRows: number };
    addMessageAppendDegraded: {
      result: { ok: boolean; degraded: boolean };
      agentMessagesRows: number;
      sessionEventsRows: number;
      lastDegraded: boolean;
    };
    appendEventSeqContiguity: { seqs: number[] };
    toolResultLogOnly: { eventRows: number; derivedMessagesDelta: number };
    capReject: { code: string; phase: string; retryable: boolean; countBefore: number; countAfter: number };
  };
}

function loadAsset(): ExpectedAsset {
  const p = path.resolve(process.cwd(), 'tests/expected/session/session-store.expected.json');
  const raw = fs.readFileSync(p, 'utf-8');
  return JSON.parse(raw) as ExpectedAsset;
}

function countRows(db: Database.Database, table: 'agent_messages' | 'session_events'): number {
  return (db.prepare(`SELECT COUNT(*) c FROM ${table}`).get() as { c: number }).c;
}

const asset = loadAsset();

describe('R-E1 expected 资产：会话账本协议面（①g 义务）', () => {
  let db: Database.Database;
  let store: SessionStore;
  let sessionId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    store = new SessionStore(db);
    sessionId = store.createSession('org-expected').id;
  });

  afterEach(() => {
    delete process.env.SYNO_MAX_SESSION_EVENTS;
    db.close();
  });

  it('资产自洽：schema/module/issue 与清单行一致', () => {
    expect(asset.schema).toBe('synova-expected/v1');
    expect(asset.module).toBe('src/store/session-store.ts');
    expect(asset.issue).toBe('#1165');
  });

  it('addMessageSuccess：整笔落账（消息 1 行 / 事件 1 条 / seq=1）', () => {
    const result = store.addMessage(sessionId, 'user', 'hello');
    expect(result).toEqual(asset.cases.addMessageSuccess.result);
    expect(countRows(db, 'agent_messages')).toBe(asset.cases.addMessageSuccess.agentMessagesRows);
    expect(countRows(db, 'session_events')).toBe(asset.cases.addMessageSuccess.sessionEventsRows);
  });

  it('addMessageAppendDegraded：事务回滚（双 0 行 + 返回 degraded + 闩置位）', () => {
    // 注入 appendEvent 降级返回值（协议面：addMessage 必须把"降级"翻译成"整笔回滚"）
    vi.spyOn(store, 'appendEvent').mockReturnValue({ ok: false, degraded: true, error: 'injected' });
    const result = store.addMessage(sessionId, 'user', 'boom');
    expect(result.ok).toBe(false);
    expect(result).toMatchObject(asset.cases.addMessageAppendDegraded.result);
    expect(countRows(db, 'agent_messages')).toBe(asset.cases.addMessageAppendDegraded.agentMessagesRows);
    expect(countRows(db, 'session_events')).toBe(asset.cases.addMessageAppendDegraded.sessionEventsRows);
    expect(store.lastDegraded).toBe(asset.cases.addMessageAppendDegraded.lastDegraded);
    vi.restoreAllMocks();
  });

  it('appendEventSeqContiguity：连续 append ⇒ seq 1,2,3', () => {
    const seqs: number[] = [];
    for (const content of ['a', 'b', 'c']) {
      const r = store.appendEvent(sessionId, 'message', { role: 'user', content });
      expect(r.ok).toBe(true);
      if (r.ok) seqs.push(r.seq);
    }
    expect(seqs).toEqual(asset.cases.appendEventSeqContiguity.seqs);
  });

  it('toolResultLogOnly：无 content 的 tool_result 进日志但不进模型消息（delta=0）', () => {
    store.addMessage(sessionId, 'user', 'seed');
    const before = store.deriveMessages(sessionId).length;
    const r = store.appendEvent(sessionId, 'tool_result', {
      toolCallId: 'call_expected',
      name: 'query_ontology',
      ok: true,
      durationMs: 1,
      resultBytes: 2,
      resultPreview: '{}',
    });
    expect(r.ok).toBe(true);
    expect(store.getEvents(sessionId).filter((e) => e.eventType === 'tool_result')).toHaveLength(
      asset.cases.toolResultLogOnly.eventRows,
    );
    expect(store.deriveMessages(sessionId).length - before).toBe(asset.cases.toolResultLogOnly.derivedMessagesDelta);
  });

  it('capReject：超限写库前拒单条（三态 + 抛前/抛后计数不变）', () => {
    process.env.SYNO_MAX_SESSION_EVENTS = '3';
    for (const content of ['1', '2', '3']) expect(store.appendEvent(sessionId, 'message', { role: 'user', content }).ok).toBe(true);
    const countBefore = countRows(db, 'session_events');
    let err: unknown;
    try {
      store.appendEvent(sessionId, 'message', { role: 'user', content: '4' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SessionEventError);
    const typed = err as SessionEventError;
    expect({ code: typed.code, phase: typed.phase, retryable: typed.retryable }).toEqual({
      code: asset.cases.capReject.code,
      phase: asset.cases.capReject.phase,
      retryable: asset.cases.capReject.retryable,
    });
    expect(countBefore).toBe(asset.cases.capReject.countBefore);
    expect(countRows(db, 'session_events')).toBe(asset.cases.capReject.countAfter);
  });
});
