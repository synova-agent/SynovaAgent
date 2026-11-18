import { writeFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { DELIVERY_BATCHES, DELIVERY_DASHBOARD, GOLDEN_FILES, OPERATOR_STATEMENT, authorityCounts, seedManifest, writeFixtureRoot } from './fixtures';
import { createScanHarness, viewer } from './test-helpers';

describe('#1398 企业隔离、GET可见范围与源变化', () => {
  it('A/B同type+businessKey+client_request_id均独立成功，A不能读B运行', async () => {
    const { db, service, close } = createScanHarness();
    try {
      const rootA = writeFixtureRoot();
      const rootB = writeFixtureRoot();
      seedManifest(db, { graph: 'org-a', root: rootA });
      seedManifest(db, { graph: 'org-b', root: rootB });
      const a = await service.run(viewer('admin', 'owner-a', 'org-a'), 'manifest-golden', 'same-request');
      const b = await service.run(viewer('admin', 'owner-b', 'org-b'), 'manifest-golden', 'same-request');
      expect(a.record.runId).not.toBe(b.record.runId);
      expect(a.report.ontology.objects.map(item => item.object_id)).not.toEqual(b.report.ontology.objects.map(item => item.object_id));
      expect(authorityCounts(db)).toMatchObject({ scan_runs: 2, graph_nodes: 8, graph_triples: 4, scan_ontology_links: 12 });
      await expect(service.get(viewer('admin', 'owner-a', 'org-a'), b.record.runId)).rejects.toMatchObject({ code: 'RUN_UNAVAILABLE' });
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally { close(); }
  });

  it('受限GET先过滤再生成报告，完全不可见403；源变化409', async () => {
    const { db, service, close } = createScanHarness();
    try {
      const files = {
        ...GOLDEN_FILES,
        'delivery_batches.csv': DELIVERY_BATCHES.replace('2026-10,10,10,8,', '2026-10,10,10,100,'),
        'operator-statement.json': OPERATOR_STATEMENT.replace('"value":8', '"value":120'),
      };
      const root = writeFixtureRoot(files);
      seedManifest(db, { root, files, restricted: ['operator-statement.json'] });
      const full = await service.run(viewer(), 'manifest-golden', 'visibility-get');
      const before = authorityCounts(db);
      const restricted = await service.get(viewer('staff', 'staff-a'), full.record.runId);
      expect(restricted.partial_visibility).toBe(true);
      // 🔴 结构化断言（同 blocking-2 类缺陷）：不对整串 JSON 搜裸数字（UUID 子串会随机命中）。
      expect(restricted.assertions.every(item => item.value !== 120), '私有值 120 不得进入受限报告').toBe(true);
      expect(restricted.sources.every(item => item.visibility !== 'restricted'), '受限报告不得含 restricted 来源').toBe(true);
      expect(restricted.checks.cross_source, '跨来源核对不得建立在私有来源之上').toEqual([]);
      expect(authorityCounts(db)).toMatchObject({
        scan_runs: before.scan_runs,
        scan_evidence: before.scan_evidence,
        scan_evidence_versions: before.scan_evidence_versions,
        graph_nodes: before.graph_nodes,
        graph_triples: before.graph_triples,
        scan_reports: before.scan_reports + 1,
      });
      // #1408 新矩阵：staff 是合法受限可见方（v7 §3.1）⇒ 旧断言（RUN_UNAVAILABLE）语义翻转，按下表重写：
      //   staff 可见企业级来源（3 条），不可见「部门不命中 + 未个人授权」的 restricted 来源 ⇒ 200 + partial。
      const staffView = await service.get(viewer('staff', 'staff-a'), full.record.runId);
      expect(staffView.partial_visibility, 'staff 只看到部分来源 ⇒ 必须标 partial').toBe(true);
      expect(staffView.sources.every(item => item.visibility !== 'restricted'), '受限来源对 staff 不可见').toBe(true);
      expect(staffView.assertions.every(item => item.value !== 120), '私有值 120 不得进入 staff 视图').toBe(true);
      writeFileSync(join(root, 'delivery_dashboard.csv'), DELIVERY_DASHBOARD.replace('accepted_count,13', 'accepted_count,14'));
      await expect(service.get(viewer(), full.record.runId)).rejects.toMatchObject({ code: 'SOURCE_CHANGED_RERUN_REQUIRED' });
    } finally { close(); }
  });

  // 🔴 反序回归（1B 复核阻塞项 1）：原实现按「创建者可见集」落证据版本 ⇒ 受限用户先建 run 后，
  //    更宽可见者 GET 会因 `scan_assertion_evidence` 的复合外键找不到父行而 500
  //    （TRANSACTION_ABORTED，evidenceParent=0）。本用例把该序钉死：admin 必须 200，且受限方不被放宽。
  it('反序：受限先建 run ⇒ 更宽可见者 GET 必须 200；受限方仍看不到私有部分', async () => {
    const { db, service, close } = createScanHarness();
    try {
      const files = {
        ...GOLDEN_FILES,
        'delivery_batches.csv': DELIVERY_BATCHES.replace('2026-10,10,10,8,', '2026-10,10,10,100,'),
        'operator-statement.json': OPERATOR_STATEMENT.replace('"value":8', '"value":120'),
      };
      const root = writeFixtureRoot(files);
      seedManifest(db, { root, files, restricted: ['operator-statement.json'] });

      // ① 受限身份**先**建 run（模型只含 3 个可见来源，partial_visibility=true）
      const restrictedRun = await service.run(viewer('staff', 'staff-a'), 'manifest-golden', 'restricted-first');
      expect(restrictedRun.report.partial_visibility).toBe(true);
      expect(restrictedRun.report.assertions.every(item => item.value !== 120)).toBe(true);

      // ② 更宽可见者（admin）**后** GET：旧实现此处 500，修好后必须 200 且拿到全量视图
      const full = await service.get(viewer('admin', 'owner-a'), restrictedRun.record.runId);
      expect(full.partial_visibility, 'admin 视图不应标 partial').toBe(false);
      expect(full.sources.some(item => item.visibility === 'restricted'), 'admin 必须看到 restricted 来源').toBe(true);
      expect(full.assertions.some(item => item.value === 120), 'admin 必须看到私有来源带来的断言').toBe(true);

      // ③ 受限方再 GET：不得因为存在更宽报告而被放宽
      const again = await service.get(viewer('staff', 'staff-a'), restrictedRun.record.runId);
      expect(again.partial_visibility).toBe(true);
      expect(again.assertions.every(item => item.value !== 120), '受限方仍不得看到私有值 120').toBe(true);
      expect(again.sources.every(item => item.visibility !== 'restricted'), '受限视图不得含 restricted 来源').toBe(true);
      expect(again.checks.cross_source).toEqual([]);

      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally { close(); }
  });
});
