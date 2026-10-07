/**
 * agent/expert-name-map.ts — 专家名映射「单一真源」（D986 / 0-12）
 *
 * 为什么有这个文件（背景）:
 *   D650（权威第六章 §6.6「专家名禁含 cycle」+ §7.4 英文名）之后，仓内出现**两处**需要
 *   「旧名 → v3.0 问题域专家 id」映射的消费方:
 *     ① 维度/部门 → 专家   — `src/l3/synova-diagnosis-engine-impl.ts` 的 mapDimensionToExpert()
 *     ② skills/ 目录名 → 专家 — `src/agent/skill-lazy-loader.ts` scanFromFiles() 的挂载键
 *   若各写一份，两份必然漂移 —— 而「两套并行的同一件东西」正是本项目反复吃亏的病
 *   （两套 registry / 两套坐标系 / 两套 proposal）。故抽为本模块，两处共用。
 *
 * 出处（**不得自创**）:
 *   · `src/l3/synova-diagnosis-engine-impl.ts:538-552` 原表（D650 迁移落地处）
 *   · 权威第六章 §6.9.1 迁移映射: capital-cycle→资金效率 / customer-cycle→客户增长 /
 *     talent-cycle→组织能力 / tech→技术底座 / finance-structure→并入资金效率
 *
 * 契约（铁律 47）:
 *   @input  — 无（纯常量）
 *   @output — 旧名/维度名 → v3.0 专家 id；未登记的键由调用方自行降级
 *   @degraded — 本模块无运行时副作用；调用方**必须**用 `getAllExpertIds()`
 *               （`expert/expert-registry.yaml` 为唯一事实源）校验映射目标，
 *               未知目标不得静默使用（技能挂载侧只保留 legacy 键 + log.warn）
 *
 * @note 键的拼写差异（实测）: D650 原表写 `business_model`（下划线），而 `skills/` 目录名是
 *   `business-model`（连字符）。两种拼写都登记，避免任一拼写漏命中；改动任一处都须两处同步。
 */

export const LEGACY_TO_EXPERT_ID_MAP: Record<string, string> = {
  // ── 诊断维度 ID（D1-D7）→ 问题域专家 ──
  D1: 'competitive-strategy',
  D2: 'organizational-capability',
  D3: 'organizational-capability',
  D4: 'technology-foundation',
  D5: 'technology-foundation',
  D6: 'competitive-strategy',
  D7: 'fundamental-efficiency', // dept=D7 expert mapping

  // ── 旧专家/部门目录名 → 问题域专家 ──
  strategy: 'competitive-strategy',
  org: 'organizational-capability',
  finance: 'fundamental-efficiency', // dept=finance expert
  tech: 'technology-foundation',
  marketing: 'customer-growth', // dept=marketing expert
  action: 'host',
  business_model: 'competitive-strategy', // D650 原表写法（下划线）
  'business-model': 'competitive-strategy', // skills/ 目录写法（连字符）— 见文件头 @note
  knowledge: 'host',

  // ── 恒等（v3.0 自身，便于调用方统一走一次查表）──
  host: 'host',
  'fundamental-efficiency': 'fundamental-efficiency',
  'customer-growth': 'customer-growth',
  'organizational-capability': 'organizational-capability',
  'technology-foundation': 'technology-foundation',
  'competitive-strategy': 'competitive-strategy',
};
