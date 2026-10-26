// 时间注入缝：唯一 Date.now() 落点；测试可用 SYNO_FIXED_NOW_MS 固定时钟
export function nowMs(): number {
  const fixed = process.env.SYNO_FIXED_NOW_MS;
  return fixed !== undefined && fixed !== '' ? Number(fixed) : Date.now();
}
