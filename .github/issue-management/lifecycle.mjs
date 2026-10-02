#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════
// lifecycle.mjs — Issue/PR 状态自动流转执行器（D1124，**非门禁**）
//
// 定位：GitHub Project「Synova 作业面」(#1) 的状态随 PR/Review 事件自动流转。
//   🔴 这不是门禁：不产出必需检查、不进 branch protection、不阻断任何 PR。
//      本 workflow 的失败只会让**本 job** 变红；合并阻断由既有 12 条必需集负责。
//
// 由 .github/workflows/issue-lifecycle.yml 调用；也可单独手动运行（见 --help）。
//
// 契约（铁律 47）:
//   @input   CLI:
//     --event <name>        事件名（默认取 env GITHUB_EVENT_NAME）
//     --payload <file|->    事件 JSON 路径，`-` = stdin（默认取 env GITHUB_EVENT_PATH）
//     --dry-run             只打印计划，**零网络零写入**（测试注入缝）
//     --repo <owner/name>   默认取 env GITHUB_REPOSITORY
//     --token-env <VAR>     取 token 的环境变量名（默认 ISSUE_LIFECYCLE_TOKEN，回退 GH_TOKEN）
//     --json                计划以 JSON 打印（供机器消费）
//     --help
//     注入缝（仅测试/离线，**零网络零凭据**）:
//       SYNO_LIFECYCLE_MUTATION_LOG=<file>  进入 offline 模式：不联网，把计划中的 mutation
//                                           逐行追加该文件（用于机械证明"某事件 = N 处 mutation"）
//       SYNO_LIFECYCLE_TARGETS=<json>       offline 模式下注入 item 现值，形如
//                                           {"101":{"itemId":"PVTI_x","statusName":"Ready","startDate":null}}
//       SYNO_LIFECYCLE_PR_BODY=<md>         offline 模式下 workflow_dispatch 的来源 body
//   @output  stdout 人类可读计划 + 末行固定三态之一：
//              `LIFECYCLE: APPLIED(n) | NOOP | DEGRADED | ERROR`
//            GITHUB_STEP_SUMMARY 存在时追加同内容摘要（供 Actions 面板复核）
//   @exit    0 = 已应用 或 无事可做（noop）
//            1 = 真错误（payload 不可读/畸形、需要的 token 缺失、GraphQL 失败）
//            2 = 显式降级（平台性跳过：fork PR 无 secrets；**不静默**，打印原因）
//   @degraded 见 @exit 2 各分支；每条降级都在 stdout 打印 `DEGRADED: <原因>`
//             且 grep 命中的原因串可被测试断言（不空吞）
//
// 只改标题不触发（CTO 明写判据）——**两道保证**：
//   ① 触发面：workflow `on:` **不订阅** `edited` ⇒ 标题编辑根本不产生 run；
//   ② 代码面：decide() 对 `pull_request:edited` 一律返回 NOOP（含 title-only 显式判定），
//      即使将来有人误加 `edited` 订阅，也不会改状态（改坏即红：夹具 `edited-title-only`）。
//
// 平台事实（本文件只读核过，勿凭记忆改）:
//   · `GITHUB_TOKEN` 为 repo-scoped，**无法**读写 Projects (V2) GraphQL API
//     ⇒ 必须由 secret 提供 PAT（组织权限 `Projects: Read and write`）。
//     ref: https://github.github.com/gh-aw/reference/auth-projects/
//   · `permissions:` 无可授予 Projects V2 的键（`repository-projects` 仅 Projects classic）。
//     ref: https://github.com/github/docs → data/reusables/actions/github-token-available-permissions.md
// ═══════════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// ─────────────────────────── Project 常量（只读实测取得，非猜测）───────────────────────────
// 实测命令: gh api graphql -f query='query{node(id:"PVT_kwDOFAmDns4Blb57"){...on ProjectV2{id title fields(first:50){nodes{...on ProjectV2FieldCommon{id name} ...on ProjectV2SingleSelectField{id name options{id name}}}}}}}'
export const PROJECT = Object.freeze({
  org: 'synova-agent',
  number: 1,
  nodeId: 'PVT_kwDOFAmDns4Blb57',
  fields: Object.freeze({
    status: Object.freeze({
      id: 'PVTSSF_lADOFAmDns4Blb57zhkIzLE',
      options: Object.freeze({
        Inbox: '7136be82',
        Backlog: '8754811d',
        Ready: 'af6c98f6',
        'In progress': 'a3530961',
        'In review': '1b0f439f',
        Done: 'e8289d05',
        'No action': 'e1b14374',
      }),
    }),
    startDate: Object.freeze({ id: 'PVTF_lADOFAmDns4Blb57zhkIzfQ' }),
  }),
});

const EXIT = Object.freeze({ OK: 0, ERROR: 1, DEGRADED: 2 });

// ─────────────────────────────────── 纯函数（可测，零 IO）───────────────────────────────────

/**
 * 去掉 markdown 代码块与行内代码，避免把示例里的 `#123` 误判为 issue 引用。
 * @param {string} md
 * @returns {string}
 */
export function stripCode(md) {
  if (typeof md !== 'string') return '';
  return md
    .replace(/```[\s\S]*?```/g, ' ')   // fenced
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`[^`\n]*`/g, ' ');       // inline
}

/**
 * 解析 PR body 中引用到的 issue 编号（去重升序）。
 * 支持：关键词引用（Closes/Fixes/Resolves/Refs/References/Related to/Part of #N）
 *       + 裸 `#N`（排除 `owner/repo#N` 与 `abc#N` 这类非 issue 形态）。
 * @param {string} body
 * @returns {number[]} 升序去重编号
 */
export function parseIssueRefs(body) {
  const text = stripCode(body || '');
  const found = new Set();
  const kw = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?|references?|related\s+to|part\s+of)\s*:?\s*#(\d+)/gi;
  for (const m of text.matchAll(kw)) found.add(Number(m[1]));
  const bare = /(?<![\w/])#(\d+)\b/g;   // `(?<![\w/])` 排除 `repo#123` / `v1#123`
  for (const m of text.matchAll(bare)) found.add(Number(m[1]));
  return [...found].filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
}

/**
 * 是否"只改标题"的 edited 事件（changes 仅含 title）。
 * @param {object} payload
 * @returns {boolean}
 */
export function isTitleOnlyEdit(payload) {
  const changes = payload?.changes;
  if (!changes || typeof changes !== 'object') return false;
  const keys = Object.keys(changes);
  return keys.length > 0 && keys.every((k) => k === 'title');
}

/** 从 payload 安全取 PR body / PR 号 / fork 标记。 */
export function prFacts(payload) {
  const pr = payload?.pull_request;
  return {
    number: typeof pr?.number === 'number' ? pr.number : null,
    body: typeof pr?.body === 'string' ? pr.body : '',
    isFork: pr?.head?.repo?.fork === true,
    isCrossRepo:
      typeof pr?.head?.repo?.full_name === 'string' &&
      typeof payload?.repository?.full_name === 'string' &&
      pr.head.repo.full_name !== payload.repository.full_name,
  };
}

/**
 * 事件 → 决策（**唯一的状态流转真相源**，无 IO）。
 * @param {string} eventName
 * @param {object} payload
 * @returns {{kind:'flow'|'noop', status?:string, initStartDate?:boolean, issues:number[], reason:string}}
 */
export function decide(eventName, payload) {
  const action = typeof payload?.action === 'string' ? payload.action : '';
  const noop = (reason) => ({ kind: 'noop', issues: [], reason });

  if (eventName === 'pull_request') {
    const { body } = prFacts(payload);
    const issues = parseIssueRefs(body);
    if (action === 'opened') {
      return { kind: 'flow', status: 'In progress', initStartDate: true, issues, reason: 'PR opened → In progress（并初始化 Start Date）' };
    }
    if (action === 'reopened') {
      return { kind: 'flow', status: 'In progress', initStartDate: false, issues, reason: 'PR reopened → In progress' };
    }
    if (action === 'review_requested') {
      return { kind: 'flow', status: 'In review', initStartDate: false, issues, reason: 'review_requested → In review' };
    }
    if (action === 'edited') {
      // ② 代码面保证：即便被误订阅，title-only 也绝不改状态
      return noop(
        isTitleOnlyEdit(payload)
          ? '只改标题（changes 仅 title）→ 不改状态（且本 workflow 不订阅 edited）'
          : 'edited 事件不在订阅集合 → 不改状态',
      );
    }
    return noop(`pull_request:${action || '(无 action)'} 不在订阅集合`);
  }

  if (eventName === 'pull_request_review') {
    if (action !== 'submitted') return noop(`pull_request_review:${action || '(无 action)'} 不在订阅集合`);
    const state = String(payload?.review?.state || '').toLowerCase();
    const { body } = prFacts(payload);
    const issues = parseIssueRefs(body);
    if (state === 'changes_requested') {
      return { kind: 'flow', status: 'In progress', initStartDate: false, issues, reason: 'review changes_requested → 退回 In progress' };
    }
    return noop(`review state=${state || '(空)'} → 不改状态（仅 changes_requested 退回）`);
  }

  if (eventName === 'workflow_dispatch') {
    // 人工修复通道：状态机必须有一条可用的手动纠偏路径
    const inputs = payload?.inputs || {};
    const status = typeof inputs.status === 'string' ? inputs.status : '';
    const prNumber = Number(inputs.pr_number);
    if (!status || !Number.isInteger(prNumber) || prNumber <= 0) {
      return noop('workflow_dispatch 缺 pr_number/status 输入 → 不改状态');
    }
    if (!Object.prototype.hasOwnProperty.call(PROJECT.fields.status.options, status)) {
      return noop(`workflow_dispatch status="${status}" 不是合法状态档 → 不改状态`);
    }
    return { kind: 'flow', status, initStartDate: false, issues: [prNumber], reason: `手动纠偏：PR #${prNumber} → ${status}`, manual: true };
  }

  return noop(`未订阅的事件: ${eventName || '(空)'}`);
}

/**
 * 由"决策 + 目标当前值"算出要执行的 mutation 计划（无 IO）。
 * @param {object} decision decide() 的返回值
 * @param {{itemId:string, statusName:string|null, startDate:string|null}} target
 * @returns {{field:string, optionId?:string, date?:string, reason:string}[]}
 */
export function planMutations(decision, target) {
  if (decision.kind !== 'flow') return [];
  const plan = [];
  const wantOption = PROJECT.fields.status.options[decision.status];
  if (!wantOption) throw new Error(`内部错误: 未知状态档 "${decision.status}"`);

  if (target.statusName !== decision.status) {
    plan.push({ field: 'status', optionId: wantOption, reason: `Status: ${target.statusName ?? '(空)'} → ${decision.status}` });
  }
  if (decision.initStartDate && !target.startDate) {
    plan.push({ field: 'startDate', date: new Date().toISOString().slice(0, 10), reason: 'Start Date: (空) → 今日（PR opened 初始化）' });
  }
  return plan;
}

// ─────────────────────────────────── GraphQL（薄 IO 层）───────────────────────────────────

const GQL_STATUS_QUERY = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){issue(number:$number){number title projectItems(first:50){nodes{id project{id}}}}}}`;
const GQL_ITEM_QUERY = `query($itemId:ID!){node(id:$itemId){... on ProjectV2Item{fieldValues(first:50){nodes{... on ProjectV2ItemFieldDateValue{date field{... on ProjectV2FieldCommon{id}}} ... on ProjectV2ItemFieldSingleSelectValue{name field{... on ProjectV2FieldCommon{id}}}}}}}}`;
const GQL_PR_BODY_QUERY = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){number body headRepository{nameWithOwner} headRepositoryOwner{login}}}}`;
const GQL_SET_SINGLE_SELECT = `mutation($projectId:ID!,$itemId:ID!,$fieldId:ID!,$optionId:String!){updateProjectV2ItemFieldValue(input:{projectId:$projectId,itemId:$itemId,fieldId:$fieldId,value:{singleSelectOptionId:$optionId}}){projectV2Item{id}}}`;
const GQL_SET_DATE = `mutation($projectId:ID!,$itemId:ID!,$fieldId:ID!,$date:Date!){updateProjectV2ItemFieldValue(input:{projectId:$projectId,itemId:$itemId,fieldId:$fieldId,value:{date:$date}}){projectV2Item{id}}}`;

async function gql(token, query, variables) {
  const resp = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'synova-issue-lifecycle' },
    body: JSON.stringify({ query, variables }),
  });
  const text = await resp.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(`GraphQL 响应非 JSON（HTTP ${resp.status}）: ${text.slice(0, 300)}`);
  }
  if (json.errors && json.errors.length > 0) {
    const msg = json.errors.map((e) => e.message).join('; ');
    // 单点可读化：GITHUB_TOKEN 无 Projects 权限是本设计最可能的失败
    const hint = /Resource not accessible|insufficient|forbidden/i.test(msg)
      ? '（提示：Projects (V2) 写操作需要 PAT；GITHUB_TOKEN 为 repo-scoped 不可用）'
      : '';
    throw new Error(`GraphQL 错误: ${msg}${hint}`);
  }
  if (!resp.ok) throw new Error(`GraphQL HTTP ${resp.status}: ${text.slice(0, 300)}`);
  return json.data;
}

async function resolveTarget(token, owner, repo, issueNumber) {
  const d = await gql(token, GQL_STATUS_QUERY, { owner, name: repo, number: issueNumber });
  const issue = d?.repository?.issue;
  if (!issue) return null;                       // issue 不存在（或跨仓）
  const item = (issue.projectItems?.nodes || []).find((n) => n?.project?.id === PROJECT.nodeId);
  if (!item) return { issueNumber, title: issue.title, itemId: null, statusName: null, startDate: null };
  const iv = await gql(token, GQL_ITEM_QUERY, { itemId: item.id });
  let statusName = null;
  let startDate = null;
  for (const fv of iv?.node?.fieldValues?.nodes || []) {
    if (fv?.field?.id === PROJECT.fields.status.id) statusName = fv.name ?? null;
    if (fv?.field?.id === PROJECT.fields.startDate.id) startDate = fv.date ?? null;
  }
  return { issueNumber, title: issue.title, itemId: item.id, statusName, startDate };
}

async function fetchPrBody(token, owner, repo, prNumber) {
  const d = await gql(token, GQL_PR_BODY_QUERY, { owner, name: repo, number: prNumber });
  const pr = d?.repository?.pullRequest;
  if (!pr) throw new Error(`PR #${prNumber} 不存在（${owner}/${repo}）`);
  return typeof pr.body === 'string' ? pr.body : '';
}

// ─────────────────────────────────── 输出与摘要 ───────────────────────────────────

function emit(line) {
  process.stdout.write(`${line}\n`);
}

function writeSummary(lines) {
  const p = process.env.GITHUB_STEP_SUMMARY;
  if (!p) return;
  try {
    fs.appendFileSync(p, `${lines.join('\n')}\n`);
  } catch (err) {
    // 摘要写失败不影响流转结论；但仍显式告警（不静默）
    emit(`WARN: GITHUB_STEP_SUMMARY 写入失败: ${err.message}`);
  }
}

function appendMutationLog(file, lines) {
  if (!file) return;
  fs.appendFileSync(file, `${lines.join('\n')}\n`);
}

// ─────────────────────────────────── CLI / main ───────────────────────────────────

function parseArgs(argv) {
  const out = { event: '', payload: '', dryRun: false, repo: '', tokenEnv: '', json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--json') out.json = true;
    else if (a === '--event') out.event = argv[++i] ?? '';
    else if (a === '--payload') out.payload = argv[++i] ?? '';
    else if (a === '--repo') out.repo = argv[++i] ?? '';
    else if (a === '--token-env') out.tokenEnv = argv[++i] ?? '';
    else throw new Error(`未知参数: ${a}`);
  }
  return out;
}

function readPayload(spec) {
  const p = spec || process.env.GITHUB_EVENT_PATH || '';
  if (!p) throw new Error('无 payload：请给 --payload 或设 GITHUB_EVENT_PATH');
  const raw = p === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(p, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`payload 不是合法 JSON（${p}）: ${err.message}`);
  }
}

function pickToken(tokenEnv) {
  const names = tokenEnv ? [tokenEnv] : ['ISSUE_LIFECYCLE_TOKEN', 'GH_TOKEN'];
  for (const n of names) {
    const v = process.env[n];
    if (v && v.trim()) return { name: n, value: v.trim() };
  }
  return null;
}

const HELP = `lifecycle.mjs — Issue/PR 状态自动流转（D1124，非门禁）
用法: node .github/issue-management/lifecycle.mjs [--event <name>] [--payload <file|->] [--dry-run] [--repo o/n] [--token-env VAR] [--json]
环境: GITHUB_EVENT_NAME / GITHUB_EVENT_PATH / GITHUB_REPOSITORY / ISSUE_LIFECYCLE_TOKEN / GH_TOKEN / GITHUB_STEP_SUMMARY
退出: 0=已应用或无事可做  1=真错误  2=显式降级（fork PR 等平台性跳过）`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    emit(HELP);
    return EXIT.OK;
  }

  const eventName = args.event || process.env.GITHUB_EVENT_NAME || '';
  const payload = readPayload(args.payload);
  const repoFull = args.repo || process.env.GITHUB_REPOSITORY || '';
  const [owner, repo] = repoFull.includes('/') ? repoFull.split('/') : ['', ''];

  const decision = decide(eventName, payload);
  emit(`事件: ${eventName || '(空)'}${payload?.action ? ` / action=${payload.action}` : ''}`);
  emit(`决策: ${decision.kind.toUpperCase()} — ${decision.reason}`);
  emit(`引用 issue: ${decision.issues.length > 0 ? decision.issues.map((n) => `#${n}`).join(', ') : '(无)'}`);

  // ── 降级①：fork PR 无 secrets（平台性，非配置错误）──
  const facts = prFacts(payload);
  if (facts.isFork) {
    emit('DEGRADED: fork PR — GitHub 不向 pull_request(fork) 传递 secrets，无法写 Project；跳过（非错误）');
    writeSummary([`### Issue Lifecycle — DEGRADED`, `fork PR（#${facts.number}）：secrets 不传递，按平台规则跳过。`]);
    return EXIT.DEGRADED;
  }

  // 离线注入缝（仅测试/离线证明）：SYNO_LIFECYCLE_MUTATION_LOG 给定时进入 offline 模式——
  //   跳 token、跳 network，item 现值由 SYNO_LIFECYCLE_TARGETS 注入。用于机械证明
  //   "某事件产生了 N 处 mutation"，且测试零网络零凭据（ctrl-tower-change 模式 5）。
  const mutationLog = process.env.SYNO_LIFECYCLE_MUTATION_LOG || '';
  const offline = Boolean(mutationLog);
  let injectedTargets = {};
  if (offline) {
    const raw = process.env.SYNO_LIFECYCLE_TARGETS || '{}';
    try {
      injectedTargets = JSON.parse(raw);
    } catch (err) {
      emit(`ERROR: SYNO_LIFECYCLE_TARGETS 不是合法 JSON: ${err.message}`);
      emit('LIFECYCLE: ERROR');
      return EXIT.ERROR;
    }
  }

  if (decision.kind === 'noop') {
    emit('计划: (空) — 零 mutation');
    emit('LIFECYCLE: NOOP');
    writeSummary([`### Issue Lifecycle — NOOP`, `事件 \`${eventName}/${payload?.action ?? '-'}\``, `原因：${decision.reason}`, 'mutation 数：0']);
    return EXIT.OK;
  }

  // ── workflow_dispatch 手动纠偏：需先取 PR body 再解析引用 issue ──
  if (decision.manual) {
    if (args.dryRun) {
      emit(`计划(dry-run): 需先读 PR #${decision.issues[0]} 的 body 再解析引用 issue`);
      emit('LIFECYCLE: NOOP');
      return EXIT.OK;
    }
    let body;
    if (offline) {
      body = process.env.SYNO_LIFECYCLE_PR_BODY;
      if (typeof body !== 'string') {
        emit('ERROR: offline 模式下手动纠偏需 SYNO_LIFECYCLE_PR_BODY 注入 PR body');
        emit('LIFECYCLE: ERROR');
        return EXIT.ERROR;
      }
      emit('提示: offline 模式 — 手动纠偏的 PR body 由 SYNO_LIFECYCLE_PR_BODY 注入');
    } else {
      const t = pickToken(args.tokenEnv);
      if (!t) {
        emit(`ERROR: 手动纠偏需要 token（env ${args.tokenEnv || 'ISSUE_LIFECYCLE_TOKEN'} 未设置）`);
        emit('LIFECYCLE: ERROR');
        return EXIT.ERROR;
      }
      body = await fetchPrBody(t.value, owner, repo, decision.issues[0]);
    }
    decision.issues = parseIssueRefs(body);
    emit(`手动纠偏引用 issue（取自 PR body）: ${decision.issues.length > 0 ? decision.issues.map((n) => `#${n}`).join(', ') : '(无)'}`);
  }

  if (decision.issues.length === 0) {
    emit('计划: (空) — PR 未引用任何 issue（零 mutation）');
    emit('LIFECYCLE: NOOP');
    writeSummary([`### Issue Lifecycle — NOOP`, `事件 \`${eventName}/${payload?.action ?? '-'}\``, 'PR body 未引用 issue，mutation 数：0']);
    return EXIT.OK;
  }

  // ── dry-run / 注入缝：只打印计划，零网络 ──
  if (args.dryRun) {
    for (const n of decision.issues) {
      emit(`计划(dry-run): issue #${n} → Status=${decision.status}${decision.initStartDate ? ' + Start Date 初始化' : ''} (需联网核对当前值)${args.json ? ' [json]' : ''}`);
    }
    emit('LIFECYCLE: NOOP');
    return EXIT.OK;
  }

  const token = offline ? { name: '(offline-injected)', value: '' } : pickToken(args.tokenEnv);
  if (!token) {
    emit(`ERROR: 写 Project 需要 token；环境变量 ${args.tokenEnv || 'ISSUE_LIFECYCLE_TOKEN'} 未设置。`);
    emit('提示: GITHUB_TOKEN 为 repo-scoped，**无法**写 Projects (V2)；需配 fine-grained PAT（组织权限 Projects: Read and write）。');
    emit('LIFECYCLE: ERROR');
    writeSummary(['### Issue Lifecycle — ERROR', `缺少 ${args.tokenEnv || 'ISSUE_LIFECYCLE_TOKEN'}，无法写 Project #${PROJECT.number}。`]);
    return EXIT.ERROR;
  }

  let applied = 0;
  let skipped = 0;
  const summary = [`### Issue Lifecycle — ${eventName}/${payload?.action ?? '-'}`, `目标状态：**${decision.status}**`];

  for (const n of decision.issues) {
    const injected = offline ? injectedTargets[String(n)] : undefined;
    const target = offline
      ? (injected === undefined
          ? null
          : { issueNumber: n, title: injected.title ?? null, itemId: injected.itemId ?? null, statusName: injected.statusName ?? null, startDate: injected.startDate ?? null })
      : await resolveTarget(token.value, owner, repo, n);
    if (!target) {
      emit(`跳过 #${n}: 该编号不是本仓 issue`);
      skipped += 1;
      continue;
    }
    if (!target.itemId) {
      emit(`跳过 #${n}: 不在 Project #${PROJECT.number} 中（不擅自添加条目；如需纳管请在 Project 面板加入）`);
      skipped += 1;
      continue;
    }
    const plan = planMutations(decision, target);
    if (plan.length === 0) {
      emit(`#${n}: 已是 ${decision.status}${target.startDate ? ` / Start Date=${target.startDate}` : ''} — 无需变更`);
      continue;
    }
    for (const step of plan) {
      emit(`#${n}: ${step.reason}`);
      if (mutationLog) {
        appendMutationLog(mutationLog, [`issue=${n} field=${step.field} value=${step.optionId || step.date}`]);
        applied += 1;
        continue;
      }
      if (step.field === 'status') {
        await gql(token.value, GQL_SET_SINGLE_SELECT, { projectId: PROJECT.nodeId, itemId: target.itemId, fieldId: PROJECT.fields.status.id, optionId: step.optionId });
      } else {
        await gql(token.value, GQL_SET_DATE, { projectId: PROJECT.nodeId, itemId: target.itemId, fieldId: PROJECT.fields.startDate.id, date: step.date });
      }
      applied += 1;
    }
    summary.push(`- #${n} ${target.title ?? ''} → ${decision.status}`);
  }

  emit(`结果: 应用 ${applied} 处 / 跳过 ${skipped} 处`);
  emit(`LIFECYCLE: ${applied > 0 ? `APPLIED(${applied})` : 'NOOP'}`);
  summary.push(`应用 mutation：${applied}；跳过：${skipped}（token 来源：\`${token.name}\`）`);
  writeSummary(summary);
  return EXIT.OK;
}

// 仅作为脚本执行时跑 main；被 import 时只导出纯函数（可测）
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  main()
    .then((code) => { process.exitCode = code; })
    .catch((err) => {
      // 不空吞：打印完整原因 + 提示（铁律 24/31）
      emit(`ERROR: ${err.message}`);
      if (process.env.GITHUB_ACTIONS) emit(`::error::${err.message.replace(/\n/g, ' ')}`);
      emit('LIFECYCLE: ERROR');
      process.exitCode = EXIT.ERROR;
    });
}
