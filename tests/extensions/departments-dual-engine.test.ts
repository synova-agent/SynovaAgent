/**
 * tests/extensions/departments-dual-engine.test.ts — #711 ②上下文一致 ＋ 双引擎分立可观测
 *
 * 归属：P3-M7 批次 · PR4（Closes #711）｜ 写集：本文件（新建）｜
 * 依据：dev doc §4.1（#711 行）／§4.3；规格 §4.5；域守则 extensions/AGENTS.md、
 *       extensions/sentinels/AGENTS.md（哨兵/内容面装载纪律，无引擎代码）、tests/control-tower/AGENTS.md（测试命名＋禁空壳）。
 *
 * ── 语义锚（只引用，不重定义；权威在院方宪章）──
 * · 宪章 §2.7②「上下文一致：各岗位看到的企业状态是同一份（不是各自的副本）」
 *   判据语义：一致性 = **可对账**，不是输出一样（宪章 §2.7 明示：「一致性 ≠ 相同输出」）。
 * · 宪章 §2.5「它必须是学习引擎」＋ §2.7 配套「双引擎（诊断引擎与学习引擎分工）」
 *   判据语义：诊断产出（系统输出）与学习产出（实际结果）各有**独立**读写点，运行断面可分别计数。
 *
 * ── 断言对象（生产路径，禁夹具替代；file:line as_of 1ca0d4dfc）──
 * 行 A：`src/services/request-context.ts:312` `resolveContext()`（部门轴**单一入口**）
 *       → `:220` `loadDepartmentRegistry()` 真读 `extensions/departments/<id>.yaml`（**无进程级缓存**）。
 * 行 B：`src/growth/feedback-collector.ts:406` `collectFeedback()`（写点：
 *       :427-441 `INSERT INTO feedback_log`）／`:461` `queryFeedback()`（**独立读点**：
 *       :470 `SELECT * FROM feedback_log WHERE enterprise_id = @enterpriseId`）。
 * 两处俱为生产函数本体 —— 不 mock、不造替身。行 A 的变异只落在**临时内容根**（仓库 extensions/ 只读）。
 *
 * ── 判据（三路径）──
 * 正常：A 两岗位共用一件共享真源（`extensions/departments/delivery.yaml`）⇒ 改该件后
 *       **同一轮**两岗位同时变，且叶子值逐字等于**同一源行**（同一文件、同一 key 行）；
 *       B 写一次 ⇒ 独立读点计数 +1、读点可见该条；输出侧/实际侧两链可分别计数且不互相冒充。
 * 降级：A 真源目录缺失 ⇒ 两岗位**同时** degraded:true ＋ 逐字相同的 reason（不是一侧静默空）；
 *       B 无库／写失败／缺 enterpriseId ⇒ degraded:true（**不是静默 0**）。
 * 反例：A 若两岗位各持一份副本 ⇒ "同时变"断言必红（判别力自检）；改岗位自有件 finance.yaml
 *       ⇒ **只**财务岗变（同源投影 ≠ 各自副本，防"任何改动都通过"的恒真）。
 *
 * ── 判别力自检 ──
 * · 行 A：两岗位分别指向两份独立副本 ⇒ `assertBothPostsShareFact` 必抛
 *   `JUDGMENT_POST_DID_NOT_MOVE`（若该断言恒真，"同源"就是空谈）。
 * · 行 B：把读取点换成"看不见本次写入"（计数恒 0）⇒ `judgeLearningCountDelta` 必抛
 *   `JUDGMENT_LEARNING_READ_POINT_BLIND`（= 卡面"计数恒 0 ⇒ 双引擎行必红"的机械形态）。
 * · 外部证据（不进本文件）：真摘掉读点 SQL（改坏 `src/`）⇒ 本文件必红；见 PR 回执原始输出。
 *
 * ── 设计哲学一句 ──
 * 只观测"同一件内容文件的改动能否被两个岗位同时看见"与"写进去的东西能否被另一个读点看见"
 * （性质判据），不断言实现方式 —— 换实现只要性质成立仍绿，实现退化则必红。
 *
 * ── 已知限制（禁写"暂无"）──
 * 1. 行 A 的两岗位以 `departmentIds`（复数）入参模拟：生产来源是 JWT 载荷
 *    （`src/middleware/auth.ts:699` 调 `resolveContext`）；本文件不起服务、不签 JWT，
 *    断言对象是 `resolveContext` 生产函数本体。HTTP 断面判据归
 *    `scripts/control-tower/probe-department-axis.ts`，本文件不重复。
 * 2. 行 A 的变异只落临时内容根（`mkdtemp` ＋ 真 yaml **字节级**拷贝，见 `assertByteIdentical`）：
 *    `extensions/departments/**` 在本批只读（写集＝本文件）⇒ 仓库 `git status --porcelain` 为空。
 *    内容根经 `rootDir` 注入缝（`request-context.ts:125`；生产不传 ⇒ `process.cwd()`）传入，
 *    与生产走同一 `loadDepartmentRegistry` 代码路径（真读文件、无缓存）。
 * 3. 行 B 的"双引擎"在本卡按 dev doc 卡面指定 file:line 映射为 feedback-collector 的写点/读点；
 *    通道 B（`packages/evolution` ／agent_memory）的**存储面**不在本卡判据内
 *    （已由 `tests/growth/feedback-channel-unification.test.ts` 覆盖）。本文件只断言
 *    "归一后同一点可写、可被独立读点计数"。
 * 4. 临时库用 better-sqlite3 直连**文件路径**（不是 `sqlite3` CLI）⇒ 不涉及 `file:` URI 前缀坑；
 *    原始 SQL 交叉核另起独立 `Database` 句柄，不经生产读点。
 *
 * ── 失效条件（何时可撤）──
 * 出口验收（M9）用更强判据（真 HTTP 断面 ＋ D5 探针）接管本卡后，本文件降级为回归锁；
 * 不得无人接管即删（dev doc §4.4）。
 *
 * ── 权威声明（explicit authority）──
 * 判据归 L1 收件闸 ＋ K3 独立复核；本文件**不自宣"通过"**，只产可核证据。
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { join, resolve as resolvePath, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
import { resolveContext } from '../../src/services/request-context';
import type { ResolvedContext, ResolvedDepartment } from '../../src/services/request-context';
import { FeedbackCollector } from '../../src/growth/feedback-collector';

// ═══ 判据失败类型（typed error 带 code：失败点可被逐条点名，不吞错）═══

class JudgmentError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'JudgmentError';
    this.code = code;
  }
}

// ═══ 常量 ═══

/** 仓库根：由本文件位置反推（不依赖 vitest 的 cwd 口径） */
const REPO_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '../..');

/** 部门定义真源相对路径根（`extensions/departments/<id>.yaml`） */
const DEPARTMENTS_REL = join('extensions', 'departments');

/**
 * 两岗位的**共享**部门（同一企业事实）。
 * 取值依据：`extensions/departments/delivery.yaml:5` 自述"本件是多部门身份（departmentIds 复数）
 * 判据的第二个部门：财务 + 交付 ⇒ 两部门并集生效" —— 判据沿用该既有口径，不新造载体。
 */
const SHARED_DEPT = 'delivery';

const TMP_ROOT = mkdtempSync(join(tmpdir(), 'p3m7-pr4-'));

afterAll(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
});

/**
 * 岗位 = 身份面（`departmentIds` 复数）。
 * 生产来源是 JWT 载荷（`src/middleware/auth.ts:699` → `resolveContext`），此处直接构造同一入参形状。
 */
interface Post {
  readonly label: string;
  readonly departmentIds: readonly string[];
}

/** 财务岗：财务 ＋ 交付（多部门并集，delivery.yaml:5 的既有口径） */
const POST_FINANCE: Post = { label: '财务岗', departmentIds: ['finance', SHARED_DEPT] };
/** 交付岗：仅交付 ⇒ 与财务岗共享同一件部门定义 */
const POST_DELIVERY: Post = { label: '交付岗', departmentIds: [SHARED_DEPT] };
/** 人力岗：另一部门的岗位（跨岗位降级一致性用） */
const POST_HR: Post = { label: '人力岗', departmentIds: ['hr'] };

/** 共享部门源文件相对路径（`departments/<id>.yaml` —— 判据要求"指向同一源行"的物理落点） */
const SHARED_SOURCE_REL = join(DEPARTMENTS_REL, `${SHARED_DEPT}.yaml`);

// ═══ 行 A 辅助：内容根 / 源行 / 变异 ═══

/** 建临时内容根：真实 `extensions/departments/**` 的**字节级**拷贝（仓库只读，零改动） */
function makeContentRoot(): string {
  const root = mkdtempSync(join(TMP_ROOT, 'content-root-'));
  const dest = join(root, DEPARTMENTS_REL);
  mkdirSync(dest, { recursive: true });
  cpSync(join(REPO_ROOT, DEPARTMENTS_REL), dest, { recursive: true });
  return root;
}

/** 断言临时副本与仓库原件字节级一致 ⇒ 判据驱动的内容**是实物**，不是自造载体 */
function assertByteIdentical(relPath: string, root: string): void {
  const repoBytes = readFileSync(join(REPO_ROOT, relPath));
  const tempBytes = readFileSync(join(root, relPath));
  if (!repoBytes.equals(tempBytes)) {
    throw new JudgmentError(
      'JUDGMENT_CONTENT_ROOT_NOT_REAL',
      `${relPath}：临时副本与仓库原件不一致（判据驱动的内容必须是实物字节级副本）`,
    );
  }
}

/** 取源行值：`<key>: <value>` 的**原始行**（"同一源行"的物理证据，而非凭记忆断言语义） */
function sourceLineValue(relPath: string, root: string, key: string): string {
  const text = readFileSync(join(root, relPath), 'utf8');
  const match = new RegExp(`^${key}:[ \\t]*(.+)$`, 'm').exec(text);
  if (match === null) {
    throw new JudgmentError('JUDGMENT_SOURCE_LINE_MISSING', `${relPath} 缺 \`${key}:\` 行（真源形态异常）`);
  }
  return match[1].trim();
}

/** 改临时根里的某一行（只在 mkdtemp 内容根内写，仓库文件一律不碰） */
function rewriteSourceLine(relPath: string, root: string, key: string, value: string): void {
  const file = join(root, relPath);
  const text = readFileSync(file, 'utf8');
  const pattern = new RegExp(`^${key}:[ \\t]*.*$`, 'm');
  if (!pattern.test(text)) {
    throw new JudgmentError('JUDGMENT_SOURCE_LINE_MISSING', `${relPath} 缺 \`${key}:\` 行，无法构造变异`);
  }
  writeFileSync(file, text.replace(pattern, `${key}: ${value}`), 'utf8');
}

/** 单岗位观测：解析结果 ＋ 它在共享部门上的投影 ＋ 投影的源文件相对路径 */
interface SharedObservation {
  readonly post: Post;
  readonly resolved: ResolvedContext;
  readonly shared: ResolvedDepartment | undefined;
  readonly sharedSourceRelPath: string;
}

async function observeSharedFact(root: string, post: Post): Promise<SharedObservation> {
  const resolved = await resolveContext({
    departmentIds: post.departmentIds,
    userId: `post:${post.label}`,
    rootDir: root,
  });
  return {
    post,
    resolved,
    shared: resolved.profiles.find(profile => profile.id === SHARED_DEPT),
    sharedSourceRelPath: SHARED_SOURCE_REL,
  };
}

/**
 * 行 A 判据本体（可被判"红" ⇒ 判据有判别力，不是恒真）：
 * 指定根解析下，两岗位必须**同一轮**都看到共享件的新值，且都指向同一个源文件。
 */
async function assertBothPostsShareFact(
  rootFor: (post: Post) => string,
  expectedDisplayName: string,
): Promise<void> {
  const seen: Array<{ label: string; displayName: string; sourceRelPath: string }> = [];
  for (const post of [POST_FINANCE, POST_DELIVERY]) {
    const observation = await observeSharedFact(rootFor(post), post);
    if (observation.shared === undefined) {
      throw new JudgmentError(
        'JUDGMENT_SHARED_FACT_INVISIBLE',
        `岗位「${post.label}」解析不到共享部门 ${SHARED_DEPT}（degraded=${observation.resolved.degraded}）`,
      );
    }
    if (observation.resolved.degraded) {
      throw new JudgmentError(
        'JUDGMENT_UNEXPECTED_DEGRADED',
        `岗位「${post.label}」解析降级：${observation.resolved.degradedReasons.join(' | ')}`,
      );
    }
    if (observation.shared.displayName !== expectedDisplayName) {
      throw new JudgmentError(
        'JUDGMENT_POST_DID_NOT_MOVE',
        `岗位「${post.label}」未同步共享件新值：期望「${expectedDisplayName}」，实得「${observation.shared.displayName}」`
        + '（只变一侧 ⇒ 两岗位读的不是同一份真源）',
      );
    }
    seen.push({
      label: post.label,
      displayName: observation.shared.displayName,
      sourceRelPath: observation.sharedSourceRelPath,
    });
  }
  const sourcePaths = new Set(seen.map(entry => entry.sourceRelPath));
  if (sourcePaths.size !== 1 || seen.length !== 2) {
    throw new JudgmentError(
      'JUDGMENT_DIFFERENT_SOURCE',
      `两岗位指向的源文件不唯一：${seen.map(entry => `${entry.label}=${entry.sourceRelPath}`).join(' / ')}`,
    );
  }
}

// ═══ 行 B 辅助：生产写点/读点计数 ═══

const ENTERPRISE_ID = 'ent-p3m7-pr4';

/** 新开一个库文件句柄（临时目录；不是 `sqlite3` CLI ⇒ 无需 `file:` URI 前缀） */
function openFeedbackDb(fileName: string): Database.Database {
  return new Database(join(TMP_ROOT, fileName));
}

function makeCollector(db?: Database.Database): FeedbackCollector {
  const collector = new FeedbackCollector();
  if (db !== undefined) collector.setDatabase(db);
  return collector;
}

/**
 * 行 B 判据本体（可被判"红"）：写一次 ⇒ 独立读点计数必须 +1。
 * 计数恒 0（= 学习侧读取点缺失/看不见）= 红，绝不放行。
 */
function judgeLearningCountDelta(before: number, after: number, label: string): number {
  const delta = after - before;
  if (delta !== 1) {
    throw new JudgmentError(
      'JUDGMENT_LEARNING_READ_POINT_BLIND',
      `${label}：写一次后独立读点计数应 +1，实测 ${before}→${after}（delta=${delta}）`
      + ' —— 读点看不见本次写入 ⇒ 双引擎分立不可观测',
    );
  }
  return delta;
}

// ════════════════════════════════════════════════════════════════
// 行 A · ②上下文一致：两岗位解析走同一 departments 真源
// ════════════════════════════════════════════════════════════════

describe('#711 行 A · ②上下文一致（两岗位同一 departments 真源）', () => {
  it('正常：两岗位对**仓库实物**根解析 ⇒ 共享部门叶子值逐字等于源行，且岗位自有面各异', async () => {
    const finance = await observeSharedFact(REPO_ROOT, POST_FINANCE);
    const delivery = await observeSharedFact(REPO_ROOT, POST_DELIVERY);

    for (const observation of [finance, delivery]) {
      expect(observation.resolved.degraded).toBe(false);
      expect(observation.resolved.degradedReasons).toEqual([]);
      expect(observation.shared).toBeDefined();
      // 叶子字段逐字来自 `extensions/departments/delivery.yaml` 的同一源行
      expect(observation.shared?.displayName).toBe(
        sourceLineValue(SHARED_SOURCE_REL, REPO_ROOT, 'displayName'),
      );
      expect(observation.shared?.description).toBe(
        sourceLineValue(SHARED_SOURCE_REL, REPO_ROOT, 'description'),
      );
    }

    // 同一份企业状态：两岗位对共享事实给出**同一个值**（不是各自一份）
    expect(finance.shared?.displayName).toBe(delivery.shared?.displayName);
    expect(finance.shared?.id).toBe(SHARED_DEPT);
    expect(delivery.shared?.id).toBe(SHARED_DEPT);

    // 同源 ≠ 相同输出（宪章 §2.7）：财务岗自有财务部，交付岗没有
    expect(finance.resolved.profiles.map(profile => profile.id)).toEqual(['finance', SHARED_DEPT]);
    expect(delivery.resolved.profiles.map(profile => profile.id)).toEqual([SHARED_DEPT]);
  });

  it('正常：改共享件 delivery.yaml ⇒ 两岗位**同一轮同时变**，且都指向同一源行', async () => {
    const root = makeContentRoot();
    assertByteIdentical(SHARED_SOURCE_REL, root);

    const baseline = sourceLineValue(SHARED_SOURCE_REL, root, 'displayName');
    await assertBothPostsShareFact(() => root, baseline);

    const mutated = '交付与实施部';
    rewriteSourceLine(SHARED_SOURCE_REL, root, 'displayName', mutated);
    rewriteSourceLine(SHARED_SOURCE_REL, root, 'description', '改后描述（判据用 · 仅临时内容根）');

    // 源行已变（先确认变异真的落到文件上，否则下面的"同时变"可能是假绿）
    const mutatedSourceValue = sourceLineValue(SHARED_SOURCE_REL, root, 'displayName');
    expect(mutatedSourceValue).toBe(mutated);

    // 判据：两岗位同一轮都跟上（任一岗位没跟上 ⇒ JUDGMENT_POST_DID_NOT_MOVE ⇒ 红）
    await assertBothPostsShareFact(() => root, mutated);

    // "同一源行"：两岗位各自读到的值 == 同一文件、同一 key 行的值
    for (const post of [POST_FINANCE, POST_DELIVERY]) {
      const observation = await observeSharedFact(root, post);
      expect(observation.shared?.displayName).toBe(mutatedSourceValue);
      expect(observation.shared?.description).toBe(
        sourceLineValue(SHARED_SOURCE_REL, root, 'description'),
      );
      expect(observation.sharedSourceRelPath).toBe(join(DEPARTMENTS_REL, `${SHARED_DEPT}.yaml`));
    }

    // 仓库实物零改动（变异只可能落在临时根）
    expect(readFileSync(join(REPO_ROOT, SHARED_SOURCE_REL), 'utf8')).toContain(
      `displayName: ${baseline}`,
    );
  });

  it('反例对照：改岗位自有件 finance.yaml ⇒ **只**财务岗变（同源投影 ≠ 各自副本）', async () => {
    const root = makeContentRoot();
    const ownSourceRel = join(DEPARTMENTS_REL, 'finance.yaml');

    const sharedBefore = sourceLineValue(SHARED_SOURCE_REL, root, 'displayName');
    const ownBefore = sourceLineValue(ownSourceRel, root, 'displayName');
    expect(ownBefore).not.toBe(sharedBefore);

    const ownMutated = '财务与资金部';
    rewriteSourceLine(ownSourceRel, root, 'displayName', ownMutated);

    const finance = await observeSharedFact(root, POST_FINANCE);
    const delivery = await observeSharedFact(root, POST_DELIVERY);

    const financeOwnProfile = finance.resolved.profiles.find(profile => profile.id === 'finance');
    expect(financeOwnProfile?.displayName).toBe(ownMutated);
    expect(financeOwnProfile?.displayName).toBe(
      sourceLineValue(ownSourceRel, root, 'displayName'),
    );

    // 另一岗位完全不受影响：它没请求 finance，且共享件这一轮没被改
    expect(delivery.resolved.profiles.map(profile => profile.id)).toEqual([SHARED_DEPT]);
    expect(delivery.shared?.displayName).toBe(sharedBefore);
    expect(sourceLineValue(SHARED_SOURCE_REL, root, 'displayName')).toBe(sharedBefore);
  });

  it('判别力自检：两岗位各持一份副本 ⇒ "同时变"断言必红（防恒真）', async () => {
    const rootForFinance = makeContentRoot();
    const rootForDelivery = makeContentRoot();
    const mutated = '只改了财务岗读到的那份副本';

    rewriteSourceLine(SHARED_SOURCE_REL, rootForFinance, 'displayName', mutated);

    const rootFor = (post: Post): string =>
      post.label === POST_FINANCE.label ? rootForFinance : rootForDelivery;

    // 各持一份副本 ⇒ 只变一侧 ⇒ 判据必须抛（否则"同源"是空谈）
    await expect(assertBothPostsShareFact(rootFor, mutated)).rejects.toThrow(
      /JUDGMENT_POST_DID_NOT_MOVE/,
    );

    // 对照：两岗位读**同一根**时同一判据放行（否则上面是"真·永红"而非判别力）
    rewriteSourceLine(SHARED_SOURCE_REL, rootForDelivery, 'displayName', mutated);
    await assertBothPostsShareFact(rootFor, mutated);
  });

  it('降级：真源目录缺失 ⇒ 两岗位**同时** degraded:true ＋ 逐字相同 reason（不是一侧静默空）', async () => {
    const emptyRoot = mkdtempSync(join(TMP_ROOT, 'no-departments-'));

    const finance = await observeSharedFact(emptyRoot, POST_FINANCE);
    const hr = await observeSharedFact(emptyRoot, POST_HR);

    for (const observation of [finance, hr]) {
      expect(observation.resolved.degraded).toBe(true);
      expect(observation.resolved.departments).toEqual([]);
      expect(observation.shared).toBeUndefined();
      expect(
        observation.resolved.degradedReasons.some(reason => reason.startsWith('DEPT_SOURCE_MISSING')),
      ).toBe(true);
    }

    // 同一份企业状态：两个不同岗位的降级原因**逐字相同**（不是各自一份、各自不同）
    expect(finance.resolved.degradedReasons).toEqual(hr.resolved.degradedReasons);
  });
});

// ════════════════════════════════════════════════════════════════
// 行 B · 双引擎分立可观测：生产写点（feedback_log INSERT）／独立读点（queryFeedback）
// ════════════════════════════════════════════════════════════════

describe('#711 行 B · 双引擎分立（诊断产出／学习产出各自读写点可计数）', () => {
  it('正常：写一次 ⇒ 独立读点计数 +1，读点独立可见该条（不依赖写点返回值）', async () => {
    const dbFile = `write-${randomUUID()}.db`;
    const db = openFeedbackDb(dbFile);
    const collector = makeCollector(db);

    const before = collector.queryFeedback({ enterpriseId: ENTERPRISE_ID });
    expect(before.degraded).toBe(false);
    expect(before.entries).toHaveLength(0);

    const written = collector.collectFeedback({
      enterpriseId: ENTERPRISE_ID,
      actorId: 'post:财务岗',
      actorRole: 'finance',
      decision: 'confirm',
      targetType: 'diagnosis_conclusion',
      targetId: 'diag-1',
      reason: '诊断结论采纳',
    });
    expect(written.degraded).toBeUndefined();

    const after = collector.queryFeedback({ enterpriseId: ENTERPRISE_ID });
    expect(after.degraded).toBe(false);
    judgeLearningCountDelta(before.entries.length, after.entries.length, '同一实例读点');
    expect(after.entries.map(entry => entry.id)).toContain(written.id);

    // 独立性：另起 collector 实例 ＋ 另起库句柄 ⇒ 仍看得见（读点读的是持久化状态，不是写点返回值）
    const independentReader = makeCollector(openFeedbackDb(dbFile));
    const independentView = independentReader.queryFeedback({ enterpriseId: ENTERPRISE_ID });
    expect(independentView.degraded).toBe(false);
    expect(independentView.entries.map(entry => entry.id)).toContain(written.id);

    // 第三通道交叉核：原始 SQL（不经生产读点）⇒ 写点确实 INSERT 落库
    const rawDb = new Database(join(TMP_ROOT, dbFile), { readonly: true });
    const rowCount = rawDb
      .prepare('SELECT COUNT(*) AS n FROM feedback_log WHERE enterprise_id = ?')
      .get(ENTERPRISE_ID) as { n: number };
    expect(rowCount).toEqual({ n: 1 });
    rawDb.close();
    db.close();
  });

  it('正常：诊断产出／实际结果两条链可**分别计数**（互不冒充，共同覆盖同一切面）', () => {
    const db = openFeedbackDb(`chains-${randomUUID()}.db`);
    const collector = makeCollector(db);

    // 输出侧 = 诊断产出的目标类型（target_type）；实际侧 = 中层真实判定（decision）
    const writes = [
      { actorRole: 'finance', decision: 'confirm' as const, targetType: 'diagnosis_conclusion' as const, targetId: 'diag-1' },
      { actorRole: 'finance', decision: 'reject' as const, targetType: 'sentinel_alert' as const, targetId: 'alert-1' },
      { actorRole: 'hr', decision: 'reject' as const, targetType: 'sentinel_alert' as const, targetId: 'alert-2' },
    ];
    for (const write of writes) {
      collector.collectFeedback({
        enterpriseId: ENTERPRISE_ID,
        actorId: `post:${write.actorRole}`,
        actorRole: write.actorRole,
        decision: write.decision,
        targetType: write.targetType,
        targetId: write.targetId,
        reason: '双引擎分立判据用',
      });
    }

    const outputSide = collector.queryFeedback({
      enterpriseId: ENTERPRISE_ID,
      targetType: 'diagnosis_conclusion',
    });
    const actualSide = collector.queryFeedback({
      enterpriseId: ENTERPRISE_ID,
      decision: 'reject',
    });
    const wholeSection = collector.queryFeedback({ enterpriseId: ENTERPRISE_ID });

    expect(outputSide.degraded).toBe(false);
    expect(actualSide.degraded).toBe(false);
    expect(wholeSection.degraded).toBe(false);

    expect(outputSide.entries).toHaveLength(1);
    expect(actualSide.entries).toHaveLength(2);
    expect(wholeSection.entries).toHaveLength(3);

    // 分别计数 ⇒ 两数不同；若读点只回**单一计数**（一条链冒充两条）则必红
    expect(outputSide.entries.length).not.toBe(actualSide.entries.length);

    // 两链在同一运行断面上覆盖**同一批行**（不是两张互不相干的表）
    expect(outputSide.entries.length + actualSide.entries.length).toBe(wholeSection.entries.length);

    db.close();
  });

  it('降级：三态可见（无库／写失败／缺 enterpriseId）—— degraded:true，不是静默 0', () => {
    const input = {
      enterpriseId: ENTERPRISE_ID,
      actorId: 'post:财务岗',
      actorRole: 'finance',
      decision: 'reject' as const,
      targetType: 'sentinel_alert' as const,
      targetId: 'alert-x',
      reason: '降级路径判据用',
    };

    // (i) 无库（SQLite 未注入）
    const withoutDb = new FeedbackCollector();
    expect(withoutDb.collectFeedback(input).degraded).toBe(true);
    const readWithoutDb = withoutDb.queryFeedback({ enterpriseId: ENTERPRISE_ID });
    expect(readWithoutDb.entries).toHaveLength(0);
    expect(readWithoutDb.degraded).toBe(true);

    // (ii) 写失败：库已关闭（写点与读点都必须显式降级，不得静默 0）
    const db = openFeedbackDb(`degraded-${randomUUID()}.db`);
    const broken = makeCollector(db);
    db.close();
    expect(broken.collectFeedback(input).degraded).toBe(true);
    const readBroken = broken.queryFeedback({ enterpriseId: ENTERPRISE_ID });
    expect(readBroken.entries).toHaveLength(0);
    expect(readBroken.degraded).toBe(true);

    // (iii) 缺 enterpriseId ⇒ fail-closed（不回落全局查询）
    const healthy = makeCollector(openFeedbackDb(`failclosed-${randomUUID()}.db`));
    const readWithoutEnterprise = healthy.queryFeedback({});
    expect(readWithoutEnterprise.entries).toHaveLength(0);
    expect(readWithoutEnterprise.degraded).toBe(true);
  });

  it('判别力自检：读取点"看不见本次写入"（计数恒 0）⇒ 计数 +1 判据必红', () => {
    expect(() => judgeLearningCountDelta(0, 0, '恒 0 读点')).toThrow(
      /JUDGMENT_LEARNING_READ_POINT_BLIND/,
    );
    // 对照：真 +1 时判据放行（否则上面是"真·永红"而非判别力）
    expect(judgeLearningCountDelta(0, 1, '正常读点')).toBe(1);
  });

  it('锚点核对（辅助，非验收唯一依据）：写点 INSERT ／读点 SELECT 是两条独立生产语句', () => {
    const source = readFileSync(join(REPO_ROOT, 'src/growth/feedback-collector.ts'), 'utf8');
    // 写点：feedback_log INSERT（卡面 :428 附近）
    expect(source).toMatch(/INSERT INTO feedback_log \(id, enterprise_id, actor_id/);
    // 独立读点：feedback_log SELECT（卡面 :470 附近；不是把写点返回值当读结果）
    expect(source).toMatch(/SELECT \* FROM feedback_log WHERE enterprise_id = @enterpriseId/);
    // 两个方法都在生产类上（读写点分立，不是一个函数既写又读）
    expect(typeof FeedbackCollector.prototype.collectFeedback).toBe('function');
    expect(typeof FeedbackCollector.prototype.queryFeedback).toBe('function');
  });
});
