/**
 * tests/fixtures/sentinel-exile/exile-fixture-alpha/aggregate.ts
 *
 * 内容拔除夹具的 aggregate 入口 —— 对齐 sentinel-loader.registerLoadedSentinels 的装配契约：
 *   · exportKey = manifest.exportKey（'exileFixtureAlpha'）
 *   · 导出对象的 check() 是函数（loader 据此判定「可装配」）
 *   · 声明 manifest 字段（loader 注册时把 manifest 挂到哨兵对象上）
 *
 * 用途: 让夹具目录成为「manifest.json ＋ aggregate.ts 齐备」的合法最小哨兵；
 *   计数断言只依赖 loadSentinels 的目录扫描，本文件由 content-exile.test.ts ⑥ 夹具有效性用例
 *   经真实注册管线（registerLoadedSentinels）验证。
 * 夹具不产真实业务 finding（返回空数组；无数据源可读时空结果就是它的真实行为，不是静默降级）。
 */
export const exileFixtureAlpha = {
  manifest: null,

  async check(): Promise<never[]> {
    return [];
  },
};
