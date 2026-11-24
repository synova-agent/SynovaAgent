/**
 * tests/fixtures/sentinel-determinism/determinism-demo/computes/score.ts
 * 确定性契约夹具的 compute（**夹具输入，不是产品代码**）。
 *
 * 契约：
 *   @input  autonomy / monitored —— 两个 [0,1] 比例（由夹具 aggregate 从固定图算出）
 *   @output 两位小数的确定性分值（同一输入逐次同值）
 *   @invariant 唯一语义常量 = AUTONOMY_WEIGHT；它同时进入分值与描述，
 *              因此 tests/contract/sentinel-determinism.test.ts 的「改坏必红」相位
 *              只需替换这一处常量（锚点出现次数在测试里 fail-loud 校验）。
 */

/** 自主度权重（测试的变异锚点：恰好一处。改它 ⇒ 稳定投影必变）。 */
export const AUTONOMY_WEIGHT = 0.5;

/** 确定性分值：weighted average，四舍五入到两位小数（消除浮点尾差，便于期望值可读）。 */
export function computeDeterminismScore(input: { autonomy: number; monitored: number }): number {
  const raw = AUTONOMY_WEIGHT * input.autonomy + (1 - AUTONOMY_WEIGHT) * input.monitored;
  return Math.round(raw * 100) / 100;
}

/** 人类可读描述（把权重也写进去：常量一改，finding 描述同样变化）。 */
export function describeDeterminismScore(score: number): string {
  return `确定性演示评分 ${score.toFixed(2)}（自主度权重 ${AUTONOMY_WEIGHT}）`;
}
