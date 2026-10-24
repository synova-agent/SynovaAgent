/**
 * src/services/federated-pipeline.ts — 跨企业联邦知识 (D244)
 *
 * 模块四 §二-§四: 双重审批 + 多企业验证 + 质量降级。
 * 企业知识→anonymized→pending_admin_review→pending_ga_review→>=2家验证→federated
 *
 * 质量降级: <3/5 评分且 >=5 企业反馈 → 降级
 * 过期: >6月未达2家验证→搁置, >12月→归档
 *
 * 契约（铁律 47）:
 *   @input    — `new FederatedPipeline(anonymizer?: Anonymizer, clock: Clock = systemClock)`
 *               各方法既有入参不变（markShareable/approveByGa/validateByEnterprise/
 *               checkQualityDegradation/checkExpiry/checkGaWeightDrop）
 *   @output   — `FederatedKnowledge`：条目 id 的尾缀、createdAt/updatedAt/reviewedAt
 *               全部来自注入的 `clock`（本文件已无直取系统时钟）
 *   @degraded — 不新增降级面：不传 `clock` ⇒ 默认 `systemClock`（生产行为与改前逐字节等价）
 *   @error    — 不适用：本类不抛错（既有"查不到 ⇒ 返回 false/undefined"语义不变）；
 *               `clock` 接口不符 ⇒ TypeScript 编译期失败
 */
import { createLogger } from "@synova/logger";
import { Anonymizer } from "./anonymizer";
import { systemClock, type Clock } from "./clock";

const log = createLogger("services/federated-pipeline");

// ═══ 类型 ═══

export type FederatedStatus =
  | "pending_admin"
  | "pending_ga"
  | "federated"
  | "degraded"
  | "stalled"
  | "archived";

export interface FederatedKnowledge {
  /** 原始知识块 ID */
  sourceChunkId: string;
  /** 脱敏后文本 */
  anonymizedText: string;
  /** 原始企业 ID */
  sourceOrgId: string;
  /** 联邦状态 */
  status: FederatedStatus;
  /** 验证企业数 (>=2 → federated) */
  validationCount: number;
  /** 质量评分 (0-5) */
  qualityScore: number;
  /** 企业反馈数 */
  feedbackCount: number;
  /** 审核人 */
  reviewedBy?: string;
  /** 审核时间 */
  reviewedAt?: string;
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
}

// ═══ FederatedPipeline ═══

export class FederatedPipeline {
  private store: Map<string, FederatedKnowledge> = new Map();
  private anonymizer: Anonymizer;
  private idCounter = 0;
  /** 时间源（Q-6）——默认 `systemClock`，不传即旧行为 */
  private readonly clock: Clock;

  /**
   * @param anonymizer — 脱敏器实例（可选，缺省 `new Anonymizer()`）
   * @param clock — 时间源（可选，缺省 `systemClock` ⇒ 生产行为等价）
   */
  constructor(anonymizer?: Anonymizer, clock: Clock = systemClock) {
    this.anonymizer = anonymizer || new Anonymizer();
    this.clock = clock;
  }

  /**
   * 管理员标记知识为可共享 → 执行脱敏 + 进入 pending_admin 状态。
   */
  markShareable(chunkId: string, text: string, orgId: string): FederatedKnowledge {
    const { anonymizedText, replacedCount } = this.anonymizer.anonymize(text);
    const id = `fed-${++this.idCounter}-${this.clock.now().toString(36)}`;
    const now = this.clock.nowIso();

    const entry: FederatedKnowledge = {
      sourceChunkId: chunkId,
      anonymizedText,
      sourceOrgId: orgId,
      status: "pending_admin",
      validationCount: 0,
      qualityScore: 0,
      feedbackCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    this.store.set(id, entry);
    log.info({ chunkId, replacedCount, id }, "知识标记为可共享 → pending_admin");
    return entry;
  }

  /**
   * GA 审批: pending_admin → pending_ga ← 等待多企业验证。
   */
  approveByGa(id: string, reviewer: string): boolean {
    const entry = this.store.get(id);
    if (!entry || entry.status !== "pending_admin") return false;

    entry.status = "pending_ga";
    entry.reviewedBy = reviewer;
    entry.reviewedAt = this.clock.nowIso();
    entry.updatedAt = this.clock.nowIso();
    log.info({ id, reviewer }, "GA 已审批 → pending_ga");
    return true;
  }

  /**
   * 企业验证: 验证 + 评分。
   * >=2 企业验证 → federated
   */
  validateByEnterprise(id: string, score: number): boolean {
    const entry = this.store.get(id);
    if (!entry || entry.status === "archived") return false;

    entry.validationCount++;
    entry.feedbackCount++;
    entry.qualityScore = (entry.qualityScore * (entry.feedbackCount - 1) + score) / entry.feedbackCount;
    entry.updatedAt = this.clock.nowIso();

    if (entry.validationCount >= 2 && entry.status !== "federated") {
      entry.status = "federated";
      log.info({ id, validationCount: entry.validationCount }, "已达成 2 家验证 → federated");
    }

    return true;
  }

  /**
   * 质量降级检查: <3/5 评分且 >=5 企业反馈 → degraded。
   * 在每次 validateByEnterprise 后调用。
   */
  checkQualityDegradation(id: string): boolean {
    const entry = this.store.get(id);
    if (!entry) return false;

    if (entry.qualityScore < 3 && entry.feedbackCount >= 5) {
      entry.status = "degraded";
      entry.updatedAt = this.clock.nowIso();
      log.warn({ id, qualityScore: entry.qualityScore, feedbackCount: entry.feedbackCount }, "联邦知识质量降级");
      return true;
    }
    return false;
  }

  /**
   * 检查过期: >6月未达2家验证→搁置, >12月→归档。
   */
  checkExpiry(id: string): boolean {
    const entry = this.store.get(id);
    if (!entry) return false;

    const now = this.clock.now();
    const created = new Date(entry.createdAt).getTime();
    const monthsElapsed = (now - created) / (1000 * 60 * 60 * 24 * 30);

    if (monthsElapsed > 12 && entry.validationCount < 2) {
      entry.status = "archived";
      entry.updatedAt = this.clock.nowIso();
      log.warn({ id, monthsElapsed: Math.round(monthsElapsed) }, "联邦知识超 12 月 → 归档");
      return true;
    }

    if (monthsElapsed > 6 && entry.validationCount < 2) {
      entry.status = "stalled";
      entry.updatedAt = this.clock.nowIso();
      log.warn({ id, monthsElapsed: Math.round(monthsElapsed) }, "联邦知识超 6 月 → 搁置");
      return true;
    }

    return false;
  }

  /**
   * GA 离职权重降低。
   *
   * 当某 GA 离职后, 调用此方法自动降低该 GA 历史审批的联邦知识权重。
   * 规则:
   *   - 被该 GA 审批过的条目 qualityScore 降低 50%
   *   - 降低后 qualityScore < 3 且 feedbackCount >= 3 → 标记 degraded
   *
   * @param gaUserId — 离职 GA 的用户 ID
   * @returns 受影响的条目数
   */
  checkGaWeightDrop(gaUserId: string): number {
    let affected = 0;
    for (const [, entry] of this.store) {
      if (entry.reviewedBy !== gaUserId) continue;
      entry.qualityScore = entry.qualityScore * 0.5;
      entry.updatedAt = this.clock.nowIso();
      affected++;

      // 降低后评分过低 → 降级
      if (entry.qualityScore < 3 && entry.feedbackCount >= 3) {
        entry.status = "degraded";
        log.warn(
          { id: entry.sourceChunkId, gaUserId, qualityScore: entry.qualityScore },
          "GA 离职 → 联邦知识降级",
        );
      } else {
        log.info(
          { id: entry.sourceChunkId, gaUserId, qualityScore: entry.qualityScore },
          "GA 离职 → 权重已降低 (未触发降级)",
        );
      }
    }
    if (affected > 0) {
      log.warn({ gaUserId, affected }, "GA 离职权重降低处理完成");
    } else {
      log.info({ gaUserId }, "该 GA 无历史审批记录，无需处理");
    }
    return affected;
  }

  /** 获取联邦知识 */
  get(id: string): FederatedKnowledge | undefined {
    return this.store.get(id);
  }

  /** 按 sourceChunkId 查找联邦 ID */
  findIdBySourceChunk(sourceChunkId: string): string | undefined {
    for (const [id, entry] of this.store) {
      if (entry.sourceChunkId === sourceChunkId) return id;
    }
    return undefined;
  }

  /** 按状态列出 */
  listByStatus(status: FederatedStatus): FederatedKnowledge[] {
    return Array.from(this.store.values()).filter((e) => e.status === status);
  }

  /** 列出所有 */
  listAll(): FederatedKnowledge[] {
    return Array.from(this.store.values());
  }
}
