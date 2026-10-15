/**
 * tests/evolution/proposal-payloads.test.ts — K6-E9 (#539 / Closes #539)
 *
 * 卡面 Done ②：四类 payload 各一组「改坏即红」—— 载荷缺任一必填字段 ⇒
 * PAYLOAD_CONTRACTS[kind].validate 必 false（改坏即红：若校验放行，本组必红）。
 * 铁律 48：全部用例有 expect 断言；铁律 47：契约见各 describe。
 */
import { describe, it, expect } from 'vitest';
import {
  PAYLOAD_CONTRACTS,
  kindOf,
  describeChange,
  isThresholdChange,
  type TypedChange,
  type LoopParamChange,
  type OntologyChange,
  type ParamPriorChange,
  type NavWeightChange,
} from '@synova/evolution';
import type { ThresholdChange } from '@synova/evolution';

function validLoopParam(): LoopParamChange {
  return { kind: 'loop-param', cycleId: 'cash-reserve', paramKey: 'triggerThreshold', from: 3, to: 5 };
}
function validOntology(): OntologyChange {
  return { kind: 'ontology', nodeType: 'Financial', op: 'update', patch: { field: 'cash' } };
}
function validPrior(): ParamPriorChange {
  return { kind: 'param-prior', paramId: 'F1_KZ.prior', priorAlpha: 2, priorBeta: 5, evidenceCount: 12 };
}
function validNav(): NavWeightChange {
  return { kind: 'nav-weight', expertId: 'fundamental-efficiency', weightFrom: 0.5, weightTo: 0.4 };
}
/** 负路径构造器：unknown → TypedChange 单点合法转换（铁律 38：禁双层断言链） */
function asBad(v: unknown): TypedChange {
  return v as TypedChange;
}

function validThreshold(): ThresholdChange {
  return { sentinelId: 'F1_KZ', from: { warning: 0.5, critical: 1.0 }, to: { warning: 0.6, critical: 1.1 } };
}

describe('K6-E9 proposal-payloads：四类 payload 判据（每类自声明）', () => {
  it('四类 + 阈值：合法载荷全部过各自判据', () => {
    expect(PAYLOAD_CONTRACTS['loop-param'].validate(validLoopParam())).toBe(true);
    expect(PAYLOAD_CONTRACTS['ontology'].validate(validOntology())).toBe(true);
    expect(PAYLOAD_CONTRACTS['param-prior'].validate(validPrior())).toBe(true);
    expect(PAYLOAD_CONTRACTS['nav-weight'].validate(validNav())).toBe(true);
    expect(PAYLOAD_CONTRACTS['sentinel-threshold'].validate(validThreshold())).toBe(true);
  });

  it('① loop-param 改坏即红：缺 cycleId / paramKey / 非数值 ⇒ validate 必 false', () => {
    const base = validLoopParam();
    expect(PAYLOAD_CONTRACTS['loop-param'].validate({ ...base, cycleId: '' })).toBe(false);
    expect(PAYLOAD_CONTRACTS['loop-param'].validate(asBad({ ...base, paramKey: undefined }))).toBe(false);
    expect(PAYLOAD_CONTRACTS['loop-param'].validate({ ...base, to: Number.NaN })).toBe(false);
  });

  it('② ontology 改坏即红：非法 op / 缺 nodeType / patch 非对象 ⇒ validate 必 false', () => {
    const base = validOntology();
    expect(PAYLOAD_CONTRACTS.ontology.validate(asBad({ ...base, op: 'delete' }))).toBe(false);
    expect(PAYLOAD_CONTRACTS.ontology.validate({ ...base, nodeType: '' })).toBe(false);
    expect(PAYLOAD_CONTRACTS.ontology.validate(asBad({ ...base, patch: 'not-an-object' }))).toBe(false);
  });

  it('④ param-prior 改坏即红：非正先验 / 证据数 <1 或非整数 ⇒ validate 必 false', () => {
    const base = validPrior();
    expect(PAYLOAD_CONTRACTS['param-prior'].validate({ ...base, priorAlpha: 0 })).toBe(false);
    expect(PAYLOAD_CONTRACTS['param-prior'].validate({ ...base, priorBeta: -1 })).toBe(false);
    expect(PAYLOAD_CONTRACTS['param-prior'].validate({ ...base, evidenceCount: 0 })).toBe(false);
    expect(PAYLOAD_CONTRACTS['param-prior'].validate({ ...base, evidenceCount: 1.5 })).toBe(false);
  });

  it('⑤ nav-weight 改坏即红：权重越界 [0,1] / 缺 expertId ⇒ validate 必 false', () => {
    const base = validNav();
    expect(PAYLOAD_CONTRACTS['nav-weight'].validate({ ...base, weightTo: 1.5 })).toBe(false);
    expect(PAYLOAD_CONTRACTS['nav-weight'].validate({ ...base, weightTo: -0.1 })).toBe(false);
    expect(PAYLOAD_CONTRACTS['nav-weight'].validate({ ...base, expertId: '' })).toBe(false);
  });

  it('③ sentinel-threshold 改坏即红：缺 sentinelId / to 非数值 ⇒ validate 必 false', () => {
    const base = validThreshold();
    expect(PAYLOAD_CONTRACTS['sentinel-threshold'].validate({ ...base, sentinelId: '' })).toBe(false);
    expect(PAYLOAD_CONTRACTS['sentinel-threshold'].validate(asBad({ ...base, to: undefined }))).toBe(false);
  });

  it('kindOf：存量无 kind ⇒ sentinel-threshold；未知 kind 字符串 ⇒ 回落 sentinel-threshold', () => {
    expect(kindOf(validThreshold() as TypedChange)).toBe('sentinel-threshold');
    expect(kindOf(validLoopParam())).toBe('loop-param');
    expect(kindOf(asBad({ kind: 'bogus' }))).toBe('sentinel-threshold');
  });

  it('isThresholdChange 形态守卫 + describeChange 审计描述可读', () => {
    expect(isThresholdChange(validThreshold())).toBe(true);
    expect(isThresholdChange(validLoopParam())).toBe(false);
    expect(describeChange(validLoopParam())).toContain('cash-reserve.triggerThreshold');
    expect(describeChange(validPrior())).toContain('Beta(2,5)');
  });
});
