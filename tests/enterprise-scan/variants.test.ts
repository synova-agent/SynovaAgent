import { writeFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { EnterpriseScanError } from '../../src/connectors/enterprise-scan/errors';
import {
  DELIVERY_BATCHES,
  DELIVERY_DASHBOARD,
  GOLDEN_FILES,
  OPERATOR_STATEMENT,
  authorityCounts,
  seedManifest,
  writeFixtureRoot,
} from './fixtures';
import { createScanHarness, viewer } from './test-helpers';

function setup(files: Record<string, string> = GOLDEN_FILES, options: { restricted?: readonly string[]; requiredAsOf?: string } = {}) {
  const harness = createScanHarness();
  const root = writeFixtureRoot(files);
  seedManifest(harness.db, { root, files, restricted: options.restricted, requiredAsOf: options.requiredAsOf });
  return { ...harness, root };
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  try { await promise; throw new Error(`预期 ${code}，实际成功`); }
  catch (error) {
    expect(error).toBeInstanceOf(EnterpriseScanError);
    expect((error as EnterpriseScanError).code).toBe(code);
  }
}

describe('#1398 八类变体与幂等反例', () => {
  it('缺失保持null/missing，不补零且给出补证路径', async () => {
    const files = { ...GOLDEN_FILES, 'delivery_batches.csv': DELIVERY_BATCHES.replace('2026-10,5,5,5,', '2026-10,5,5,,') };
    const { service, close } = setup(files);
    try {
      const { report } = await service.run(viewer(), 'manifest-golden', 'missing');
      const direct = report.assertions.find(item => item.target && (item.target as { businessKey?: string }).businessKey === 'delivery_batch:B-2026-10-002' && item.field === 'accepted_count');
      expect(direct).toMatchObject({ value: null, instance_state: 'missing', assertion_type: 'unknown' });
      const check = report.checks.dashboard.find(item => item.metric === 'accepted_count');
      expect(check).toMatchObject({ calculated: null, calculation_match: null, difference: null });
      expect(report.evidence_gaps[0]).toMatchObject({ field: 'accepted_count', source_ref: 'delivery_batches.csv#L3' });
      expect(report.supplement_requests[0].required_source).toBe('delivery_batches.csv');
      expect(JSON.stringify(report)).not.toContain('"calculated":0');
    } finally { close(); }
  });

  it('重复源行全部保留且自然键对象仍唯一', async () => {
    const duplicate = DELIVERY_BATCHES + 'delivery_batch:B-2026-10-001,十月华东交付批次,team:delivery-a,交付一组,2026-10,10,10,9,2026-10-01,2026-10-31,delivery-v1\n';
    const { service, close } = setup({ ...GOLDEN_FILES, 'delivery_batches.csv': duplicate });
    try {
      const { report } = await service.run(viewer(), 'manifest-golden', 'duplicate');
      expect(report.ontology.objects).toHaveLength(4);
      const direct = report.assertions.find(item => item.assertion_id && item.field === 'accepted_count' && item.assertion_kind === 'direct' && (item.target as { businessKey?: string }).businessKey === 'delivery_batch:B-2026-10-001');
      expect(direct).toMatchObject({ value: [8, 9], instance_state: 'conflict', evidence_status: 'conflict' });
      expect(direct?.evidence).toHaveLength(3);
      expect(report.checks.source_internal.some(item => item.status === 'conflict')).toBe(true);
    } finally { close(); }
  });

  it('过期分别保存证据stale与②实例stale', async () => {
    const stale = DELIVERY_BATCHES.replaceAll('2026-10-31', '2026-09-30');
    const { service, close } = setup({ ...GOLDEN_FILES, 'delivery_batches.csv': stale }, { requiredAsOf: '2026-11-01' });
    try {
      const { report } = await service.run(viewer(), 'manifest-golden', 'stale');
      expect(report.sources.find(item => item.source_id.includes('batches'))).toMatchObject({ evidence_status: 'stale', instance_state: 'stale' });
      expect(report.assertions.filter(item => item.instance_state === 'stale').length).toBeGreaterThanOrEqual(5);
      expect(report.checks.source_internal.some(item => item.status === 'stale')).toBe(true);
    } finally { close(); }
  });

  it('看板冲突保留13/14/difference=1，人的9与业务8并列不择一', async () => {
    const files = {
      ...GOLDEN_FILES,
      'delivery_dashboard.csv': DELIVERY_DASHBOARD.replace('accepted_count,13', 'accepted_count,14'),
      'operator-statement.json': OPERATOR_STATEMENT.replace('"value":8', '"value":9'),
    };
    const { service, close } = setup(files);
    try {
      const { report } = await service.run(viewer(), 'manifest-golden', 'conflict');
      expect(report.checks.dashboard.find(item => item.metric === 'accepted_count')).toMatchObject({ calculated: 13, dashboard: 14, calculation_match: false, difference: 1 });
      const direct = report.assertions.find(item => item.assertion_kind === 'direct' && item.field === 'accepted_count');
      const claim = report.assertions.find(item => item.assertion_kind === 'statement' && item.field === 'accepted_count');
      expect(direct).toMatchObject({ value: 8, instance_state: 'conflict' });
      expect(claim).toMatchObject({ value: 9, instance_state: 'conflict', assertion_type: 'inference' });
      expect(report.checks.cross_source[0].values).toEqual([8, 9]);
    } finally { close(); }
  });

  it('越权、空内容和不支持格式均零新增', async () => {
    const empty = setup({ ...GOLDEN_FILES, 'delivery-policy.md': '' });
    try {
      const before = authorityCounts(empty.db);
      await expectCode(empty.service.run(viewer(), 'manifest-golden', 'empty'), 'EMPTY_CONTENT');
      expect(authorityCounts(empty.db)).toEqual(before);
    } finally { empty.close(); }

    const unsupported = setup();
    try {
      writeFileSync(join(unsupported.root, 'delivery-policy.xlsx'), 'synthetic');
      unsupported.db.prepare("UPDATE scan_authorizations SET allowed_path = ?, format = 'xlsx' WHERE source_id LIKE '%policy'").run(join(unsupported.root, 'delivery-policy.xlsx'));
      const before = authorityCounts(unsupported.db);
      await expectCode(unsupported.service.run(viewer(), 'manifest-golden', 'xlsx'), 'UNSUPPORTED_FORMAT');
      expect(authorityCounts(unsupported.db)).toEqual(before);
    } finally { unsupported.close(); }

    const unauthorized = setup();
    try {
      unauthorized.db.prepare("UPDATE scan_authorizations SET allowed_path = ? WHERE source_id LIKE '%policy'").run(join(unauthorized.root, '..', 'delivery-policy.md'));
      const before = authorityCounts(unauthorized.db);
      await expectCode(unauthorized.service.run(viewer(), 'manifest-golden', 'path'), 'UNAUTHORIZED_PATH');
      expect(authorityCounts(unauthorized.db)).toEqual(before);
      await expectCode(unauthorized.service.run(viewer(), 'not-registered', 'scope'), 'SCOPE_DENIED');
      expect(authorityCounts(unauthorized.db)).toEqual(before);
    } finally { unauthorized.close(); }
  });

  it('同键不同载荷、不同用户同键和可见范围变化均409且不泄露旧报告', async () => {
    const { db, service, close, root } = setup(GOLDEN_FILES, { restricted: ['operator-statement.json'] });
    try {
      await service.run(viewer('staff', 'staff-a'), 'manifest-golden', 'same-key');
      const initial = authorityCounts(db);
      const replay = await service.run(viewer('staff', 'staff-a'), 'manifest-golden', 'same-key');
      expect(replay.replayed).toBe(true);
      expect(authorityCounts(db)).toEqual(initial);
      await expectCode(service.run(viewer('staff', 'other-user'), 'manifest-golden', 'same-key'), 'IDEMPOTENCY_KEY_UNAVAILABLE');
      expect(authorityCounts(db)).toEqual(initial);
      db.prepare("UPDATE scan_authorizations SET allowed_users_json = ? WHERE source_id LIKE '%operator-statement'").run(JSON.stringify(['staff-a']));
      await expectCode(service.run(viewer('staff', 'staff-a'), 'manifest-golden', 'same-key'), 'IDEMPOTENCY_REPLAY_SCOPE_CHANGED');
      expect(authorityCounts(db)).toEqual(initial);
      writeFileSync(join(root, 'delivery_dashboard.csv'), DELIVERY_DASHBOARD.replace('accepted_count,13', 'accepted_count,14'));
      await expectCode(service.run(viewer('staff', 'staff-a'), 'manifest-golden', 'same-key'), 'IDEMPOTENCY_PAYLOAD_MISMATCH');
      expect(authorityCounts(db)).toEqual(initial);
    } finally { close(); }
  });

  it('公开100+私有120：admin见双方conflict，受限staff只见100且partial_visibility', async () => {
    const files = {
      ...GOLDEN_FILES,
      'delivery_batches.csv': DELIVERY_BATCHES.replace('2026-10,10,10,8,', '2026-10,10,10,100,'),
      'operator-statement.json': OPERATOR_STATEMENT.replace('"value":8', '"value":120'),
    };
    const { service, close } = setup(files, { restricted: ['operator-statement.json'] });
    try {
      const full = await service.run(viewer(), 'manifest-golden', 'admin-conflict');
      expect(full.report.assertions.some(item => item.value === 100 && item.instance_state === 'conflict')).toBe(true);
      expect(full.report.assertions.some(item => item.value === 120)).toBe(true);
      // T-5：受限方 = `staff` @ `dept-delivery`（restricted 来源部门为 `dept-other` ⇒ 不可见）
      const restricted = await service.run(viewer('staff', 'staff-a'), 'manifest-golden', 'restricted-conflict');
      expect(restricted.report.partial_visibility).toBe(true);
      expect(restricted.report.assertions.some(item => item.value === 100 && item.instance_state === 'measured')).toBe(true);
      const restrictedReport = restricted.report;
      // 🔴 结构化断言（1B 复核阻塞项 2）：**禁**对整串 JSON 搜裸数字 —— graph node UUID 里可能出现
      //   `…1202…` 之类子串，会随机红（复核者实测 ~13% flake，且命中的不是产品泄漏）。
      //   ⇒ 按语义点断言：值 / 来源可见性 / 证据链 / 跨来源核对 / 遮蔽标记。
      expect(restrictedReport.assertions.every(item => item.value !== 120), '私有值 120 不得出现在受限报告').toBe(true);
      expect(restrictedReport.sources.every(item => item.visibility !== 'restricted'), '受限报告不得含 restricted 来源').toBe(true);
      expect(restrictedReport.sources.every(item => !item.source_id.includes('operator-statement')), '私有 source_id 不得出现').toBe(true);
      // 断言证据链不得指向私有来源（比"整串不含 operator-statement"更精确：只看真正承载证据关联的字段）
      const evidenceSourceRefs = restrictedReport.assertions.flatMap(item => {
        const links = item.evidence as Array<{ sourceRef?: string }> | undefined;
        return (links ?? []).map(link => link.sourceRef ?? '');
      });
      expect(evidenceSourceRefs.some(ref => ref.includes('operator-statement')), '断言证据链不得引用私有来源').toBe(false);
      expect(restrictedReport.checks.cross_source, '跨来源核对不得建立在私有来源之上').toEqual([]);
      expect(restrictedReport.partial_visibility, '受限视图必须显式标 partial_visibility').toBe(true);
      // 说明（防误读）：受限报告**允许**出现 conflict —— 该 conflict 由**可见**的 batches(100) 与
      //   dashboard(13) 的计算差异产生，不涉及私有来源；这里显式钉住它的成因，防止将来被误当成泄漏。
      expect(restrictedReport.checks.dashboard.some(check => check.calculation_match === false), '可见来源间的计算差异必须如实暴露').toBe(true);
      // 固定文件名可保留整串判据（无数字碰撞风险；与上面的结构化断言互补）
      expect(JSON.stringify(restrictedReport)).not.toContain('operator-statement');
    } finally { close(); }
  });
});
