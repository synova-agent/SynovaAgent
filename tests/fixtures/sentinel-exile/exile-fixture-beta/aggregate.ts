/**
 * tests/fixtures/sentinel-exile/exile-fixture-beta/aggregate.ts
 *
 * 内容拔除夹具的 aggregate 入口 —— 对齐 sentinel-loader.registerLoadedSentinels 的装配契约：
 *   · exportKey = manifest.exportKey（'exileFixtureBeta'）
 *   · 导出对象的 check() 是函数（loader 据此判定「可装配」）
 *   · 声明 manifest 字段（loader 注册时把 manifest 挂到哨兵对象上）
 *
 * 用途: 让夹具目录成为「manifest.json ＋ aggregate.ts 齐备」的合法最小哨兵（与 alpha 同构）；
 *   在「移走 alpha」断言里作为「其余项逐 id 不变」的对照项。
 * 夹具不产真实业务 finding（返回空数组；无数据源可读时空结果就是它的真实行为，不是静默降级）。
 */
export const exileFixtureBeta = {
  manifest: null,

  async check(): Promise<never[]> {
    return [];
  },
};
