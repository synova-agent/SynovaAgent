/**
 * tests/config/redact.test.ts — 914-Q2 配置面秘密结构性脱敏（跨 wire 无值）单测
 *
 * spec: handbook 派单件/2026-10-24-规格-914-Q2-秘密结构脱敏.md
 *       §4.1（C1 契约）／§4.4（C3 fail-closed）／C2 边界值清单
 * 覆盖（每条用例均有真 expect，铁律 48）:
 *   ① 嵌套 object + array 深路径（$.a.b[0].token，下标写 [i]）
 *   ② C2 边界值清单逐行（非秘密槽原样；秘密槽 null/''/undefined ⇒ configured:false 且仍入 secrets；
 *      秘密槽 'x'/0/false/{}/[] ⇒ configured:true）
 *   ③ 段名整段相等匹配（命中 / 不命中各 3 个）
 *   ④ 不改入参（脱敏后原对象仍含明文；深比较 + 零共享引用）
 *   ⑤ fail-closed 未知容器（Map canary ⇒ 抛 ConfigRedactError，三字段断言，message 不含 canary）
 *   ⑥ resolveSecretSource 三态 + 数组下标路径 + 非法路径 fail loud
 *
 * 判据 A/B（跨 wire 真实 HTTP、明文对照 app 必红）在 tests/routes/config.test.ts（本批 T2）。
 */
import { describe, it, expect } from 'vitest';
import {
  SECRET_SEGMENTS,
  ConfigRedactError,
  redactSecrets,
  resolveSecretSource,
} from '../../src/config/redact';
import type { LayerDoc } from '../../src/config/config-layers';

/** 32 位十六进制后缀的 canary；只用于证明"值不外泄"。 */
const CANARY = 'CANARY-2f7c9d1e4b5a6c8d0e1f2a3b4c5d6e7f';

describe('redactSecrets：嵌套 object + array 深路径', () => {
  it('深路径 $.a.b[0].token 记入侧车，值槽只剩 configured', () => {
    const input: LayerDoc = {
      llm: { apiKey: 'sk-live-abc', model: 'deepseek-chat', tokenBudget: 4096 },
      a: { b: [{ token: 'tok-1', label: 'one' }, { token: '' }] },
      flags: [true, { password: 'p@ss' }],
    };

    const result = redactSecrets(input);

    // 秘密槽＝{configured}；非秘密叶子原样（含 tokenBudget 整段不匹配）
    expect(result.value.llm).toEqual({
      apiKey: { configured: true },
      model: 'deepseek-chat',
      tokenBudget: 4096,
    });
    // 数组内对象：秘密槽替换、普通字段原样
    expect(result.value.a).toEqual({
      b: [{ token: { configured: true }, label: 'one' }, { token: { configured: false } }],
    });
    expect(result.value.flags).toEqual([true, { password: { configured: true } }]);
    // 侧车路径：数组下标写成 [i]
    expect(result.secrets).toContainEqual({ path: '$.llm.apiKey', configured: true });
    expect(result.secrets).toContainEqual({ path: '$.a.b[0].token', configured: true });
    expect(result.secrets).toContainEqual({ path: '$.a.b[1].token', configured: false });
    expect(result.secrets).toContainEqual({ path: '$.flags[1].password', configured: true });
    // 明文不出现在脱敏副本
    const serialized = JSON.stringify(result.value);
    expect(serialized).not.toContain('sk-live-abc');
    expect(serialized).not.toContain('tok-1');
    expect(serialized).not.toContain('p@ss');
  });
});

describe('redactSecrets：C2 边界值清单', () => {
  it('非秘密槽 null/""/0/false/{} 原样；秘密槽 null/""/undefined ⇒ configured:false 且仍入 secrets', () => {
    const input: LayerDoc = {
      plainNull: null,
      plainEmpty: '',
      plainZero: 0,
      plainFalse: false,
      plainObject: {},
      apiKey: null,
      password: '',
      token: undefined,
    };

    const result = redactSecrets(input);

    expect(result.value.plainNull).toBeNull();
    expect(result.value.plainEmpty).toBe('');
    expect(result.value.plainZero).toBe(0);
    expect(result.value.plainFalse).toBe(false);
    expect(result.value.plainObject).toEqual({});
    expect(result.value.apiKey).toEqual({ configured: false });
    expect(result.value.password).toEqual({ configured: false });
    expect(result.value.token).toEqual({ configured: false });
    // 无值的秘密**仍列入** secrets（"有无值"可渲染）
    expect(result.secrets).toEqual([
      { path: '$.apiKey', configured: false },
      { path: '$.password', configured: false },
      { path: '$.token', configured: false },
    ]);
  });

  it("秘密槽 'x'/0/false/{}/[] ⇒ configured:true（非空即真，对象/数组也算有值）", () => {
    const input: LayerDoc = {
      secretKey: 'x',
      accessKey: 0,
      refreshToken: false,
      clientSecret: {},
      privateKey: [],
    };

    const result = redactSecrets(input);

    expect(result.value.secretKey).toEqual({ configured: true });
    expect(result.value.accessKey).toEqual({ configured: true });
    expect(result.value.refreshToken).toEqual({ configured: true });
    expect(result.value.clientSecret).toEqual({ configured: true });
    expect(result.value.privateKey).toEqual({ configured: true });
    expect(result.secrets).toEqual([
      { path: '$.secretKey', configured: true },
      { path: '$.accessKey', configured: true },
      { path: '$.refreshToken', configured: true },
      { path: '$.clientSecret', configured: true },
      { path: '$.privateKey', configured: true },
    ]);
  });
});

describe('redactSecrets：段名整段相等匹配', () => {
  it('token/apiKey/credentials 命中；tokenBudget/apiKeyHint/mytoken 不命中', () => {
    const input: LayerDoc = {
      token: 't',
      apiKey: 'k',
      credentials: { user: 'u' },
      tokenBudget: 100,
      apiKeyHint: 'hint',
      mytoken: 'm',
    };

    const result = redactSecrets(input);

    expect(result.value.token).toEqual({ configured: true });
    expect(result.value.apiKey).toEqual({ configured: true });
    expect(result.value.credentials).toEqual({ configured: true });
    expect(result.value.tokenBudget).toBe(100);
    expect(result.value.apiKeyHint).toBe('hint');
    expect(result.value.mytoken).toBe('m');
    expect(result.secrets.map((slot) => slot.path)).toEqual(['$.token', '$.apiKey', '$.credentials']);
  });

  it('SECRET_SEGMENTS 首版＝dev doc C2 的 18 个段名（不改判据）', () => {
    expect(SECRET_SEGMENTS).toHaveLength(18);
    expect(SECRET_SEGMENTS).toContain('api_key');
    expect(SECRET_SEGMENTS).toContain('refreshToken');
    expect(SECRET_SEGMENTS).not.toContain('tokenBudget');
    expect(SECRET_SEGMENTS).not.toContain('mytoken');
  });
});

describe('redactSecrets：不改入参', () => {
  it('脱敏后原对象仍含明文；结果与入参零共享引用', () => {
    const input: LayerDoc = {
      llm: { apiKey: 'sk-live-abc' },
      list: [{ password: 'pw' }],
    };

    const result = redactSecrets(input);

    expect(input).toEqual({ llm: { apiKey: 'sk-live-abc' }, list: [{ password: 'pw' }] });
    expect(result.value).not.toBe(input);
    expect(result.value.llm).not.toBe(input.llm);
    expect(result.value.list).not.toBe(input.list);
  });
});

describe('redactSecrets：fail-closed 未知容器', () => {
  it('Map（值含 canary）⇒ 抛 ConfigRedactError，三字段符合 C1，message 不含 canary', () => {
    const input: LayerDoc = { weird: new Map<string, string>([['k', CANARY]]) };

    expect(() => redactSecrets(input)).toThrow(ConfigRedactError);

    let caught: unknown;
    try {
      redactSecrets(input);
    } catch (error) {
      caught = error;
    }
    if (!(caught instanceof ConfigRedactError)) throw new Error('期望 ConfigRedactError，实际未抛出');
    expect(caught.code).toBe('REDACT_UNSUPPORTED');
    expect(caught.phase).toBe('redactSecrets');
    expect(caught.retryable).toBe(false);
    expect(caught.message).toContain('Map');
    expect(caught.message).toContain('$.weird');
    expect(caught.message).not.toContain(CANARY);
    expect(caught.message).not.toContain('CANARY');
  });

  it('Date／function／深层未知容器同样抛（不静默跳过）', () => {
    expect(() => redactSecrets({ when: new Date(0) })).toThrow(ConfigRedactError);
    expect(() => redactSecrets({ fn: () => CANARY })).toThrow(/不支持的容器 function/);
    expect(() => redactSecrets({ deep: { list: [new Map<string, string>()] } })).toThrow(
      /不支持的容器 Map（路径 \$\.deep\.list\[0\]）/,
    );
  });
});

describe('resolveSecretSource：完整路径最高持有层', () => {
  const layers: Array<{ layer: string; doc: LayerDoc | null }> = [
    { layer: 'default', doc: { llm: { apiKey: 'd', model: 'm' }, onlyDefault: 'x' } },
    { layer: 'industry', doc: null },
    { layer: 'customer', doc: { llm: { apiKey: 'c' } } },
    { layer: 'workspace', doc: { llm: { apiKey: 'w' } } },
  ];

  it('多层命中 ⇒ 最高层名（workspace）', () => {
    expect(resolveSecretSource('$.llm.apiKey', layers)).toBe('workspace');
  });

  it('只在 default 层 ⇒ default', () => {
    expect(resolveSecretSource('$.onlyDefault', layers)).toBe('default');
  });

  it('路径不存在 ⇒ null；空 layers ⇒ null', () => {
    expect(resolveSecretSource('$.llm.missing', layers)).toBeNull();
    expect(resolveSecretSource('$.llm.apiKey', [])).toBeNull();
  });

  it('数组下标路径 $.a.b[0].token：命中层名；越界 ⇒ null', () => {
    const arrayLayers: Array<{ layer: string; doc: LayerDoc | null }> = [
      { layer: 'default', doc: { a: { b: [{ token: 'x' }] } } },
    ];
    expect(resolveSecretSource('$.a.b[0].token', arrayLayers)).toBe('default');
    expect(resolveSecretSource('$.a.b[1].token', arrayLayers)).toBeNull();
  });

  it('非法路径 ⇒ 抛 ConfigRedactError（fail loud，不静默 null）', () => {
    expect(() => resolveSecretSource('llm.apiKey', layers)).toThrow(ConfigRedactError);
    expect(() => resolveSecretSource('$', layers)).toThrow(ConfigRedactError);
  });
});

describe('resolveSecretSource：非 ASCII／特殊字符父键（N3 回归 · 裁 371）', () => {
  // 客户侧 YAML 允许任意键名：中文父键 / 含点键 / 含空格键都必须「可脱敏 + 可解析来源」，
  // 否则 resolveSecretSource 抛错会经路由 catch 把整条 dump 退化成 config:{}（N3 阻断）。
  const specialLayers: Array<{ layer: string; doc: LayerDoc | null }> = [
    { layer: 'default', doc: null },
    {
      layer: 'customer',
      doc: { 诊断: { apiKey: 'v1' }, 'a.b': { apiKey: 'v2' }, 'my key': { apiKey: 'v3' } },
    },
  ];

  it('中文父键 ⇒ 路径 $.诊断.apiKey 可解析且命中来源层（旧 PATH_SHAPE 只认 ASCII ⇒ 抛错）', () => {
    const red = redactSecrets({ 诊断: { apiKey: 'v1' } });
    expect(red.secrets).toContainEqual({ path: '$.诊断.apiKey', configured: true });
    expect(resolveSecretSource('$.诊断.apiKey', specialLayers)).toBe('customer');
  });

  it('含点键 ⇒ 以 ["a.b"] 段表示，解析为单段（不被拆成 a→b）', () => {
    const red = redactSecrets({ 'a.b': { apiKey: 'v2' } });
    expect(red.secrets).toContainEqual({ path: '$["a.b"].apiKey', configured: true });
    expect(resolveSecretSource('$["a.b"].apiKey', specialLayers)).toBe('customer');
    // 反例：把含点键当成两级路径 ⇒ 解析不到（防"看起来命中"的假绿）
    expect(resolveSecretSource('$.a.b.apiKey', specialLayers)).toBeNull();
  });

  it('含空格键 ⇒ 原样保留在点段中（不被当作非法字符）', () => {
    const red = redactSecrets({ 'my key': { apiKey: 'v3' } });
    expect(red.secrets).toContainEqual({ path: '$.my key.apiKey', configured: true });
    expect(resolveSecretSource('$.my key.apiKey', specialLayers)).toBe('customer');
  });
});
