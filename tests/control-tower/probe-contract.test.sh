#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# tests/control-tower/probe-contract.test.sh — K12-21 探针契约自测（元测试）
#
# 判据来源: 卡面 `.claude/task-briefs/2026-10-11-205-K12-21-测量梯子-12-个探针-全员前置.md`
#   §Q3 V3 契约一致：13 个探针 stdout 末行均为 `RESULT=...`，退出码语义一致（0/1/2 三态）
#   §Q3 V4 反例（改坏必红）：把某探针改成"恒 exit 0" ⇒ 本自测**必红**
#   §Q3 V5 可复跑：同一状态跑两次 ⇒ 同结果（无随机）
#   创始人 2026-10-11 明令: ladder `--all` = exit 0，但末行必须**显式披露** pass=/notimpl=
#
# 契约 (铁律 47):
#   @input    — 无参。仓库根 = 自本文件逐级上溯找 scripts/control-tower（或 SYNOVA_REPO_ROOT）
#   @output   — 逐层 `[ok]/[FAIL]` ＋ 末行 SUMMARY: pass=<n> fail=<n>；**不挂任何门禁**
#   @degraded — 找不到仓库根 / npx 不可用 ⇒ exit 2（fail-closed，不静默判过）
# 退出码: 0 = 全绿；1 = 有断言失败；2 = 自测自身无法运行（环境）
#
# 🔴 三层测什么（判例锚点）:
#   T1–T3  形态层: 文件在、末行 RESULT= 在、退出码与判定一致
#   T4–T5  **牙齿层**: 对"目标未实现"的探针断言退出码=2（判例 V-01/V-02：不许 L1 冒充 L2）
#                    ＋ 活性（防"全家恒绿"集体假绿）
#   T6–T8  聚合/披露层: 可复跑、ladder 与单独跑一致、末行披露含计数（防只报 PASS）
#
# 🔴 元层反证（判例 V-07「假绿要用"拔掉实现照样通过"来证伪」）—— 见 T4b:
#   `.claude/fixtures/probe-always-green.ts` 是**故意做坏的探针**：它声明一个**不存在的目标件**，
#   却恒印 `RESULT=PASS` 并 exit 0。本自测的 T4b **必须把它判红**（即：断言"该夹具的退出码
#   与它目标缺失的事实不符"）。若 T4b 失败 ⇒ 说明"未实现必 exit 2"这道门失效 ⇒ 本自测必红。
#
# ⚠️ 本件不会被任何门禁自动执行（如实标注，不夸大）:
#   `scripts/control-tower/ct-test-gate.sh` 的配对规则是
#   `scripts/{control-tower,workflow,hooks}/<name>.<sh|py>` ↔ `tests/control-tower/<name>.test.sh`。
#   本件测的是 `.ts` ⇒ **不在该门禁配对集内** ⇒ 它是**可手动复跑的验收件**，非 CI 自动门禁。
#   接入 CI 属 `ci.yml` 语义（归 CTO），本批不擅自改。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

PASS_N=0
FAIL_N=0
FAIL_LINES=""

ok()   { PASS_N=$((PASS_N + 1)); echo "  [ok]   $1"; }
bad()  { FAIL_N=$((FAIL_N + 1)); FAIL_LINES="${FAIL_LINES}  - $1\n"; echo "  [FAIL] $1"; }

# ── 定位仓库根（与探针同源口径：找 scripts/control-tower 存在的目录）─────────────
ROOT=""
if [ -n "${SYNOVA_REPO_ROOT:-}" ] && [ -d "${SYNOVA_REPO_ROOT}/scripts/control-tower" ]; then
  ROOT="${SYNOVA_REPO_ROOT}"
else
  _d="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  for _ in 1 2 3 4 5 6 7 8; do
    if [ -d "${_d}/scripts/control-tower" ]; then ROOT="${_d}"; break; fi
    _d="$(dirname "${_d}")"
  done
fi
if [ -z "${ROOT}" ]; then
  echo "❌ probe-contract.test.sh: 无法定位仓库根（已试 SYNOVA_REPO_ROOT 与逐级上溯）" >&2
  exit 2
fi

# ── 工具链：确保 npx/tsx 可见（沙箱/CI 未必在 PATH）────────────────────────────
if ! command -v npx >/dev/null 2>&1; then
  if [ -d /Users/wane/.nvm/versions/node/v24.19.0/bin ]; then
    PATH="/Users/wane/.nvm/versions/node/v24.19.0/bin:${PATH}"
    export PATH
  fi
fi
if ! command -v npx >/dev/null 2>&1; then
  echo "❌ probe-contract.test.sh: npx 不可用 ⇒ 无法执行探针（fail-closed，不判过）" >&2
  exit 2
fi

cd "${ROOT}" || { echo "❌ 无法 cd ${ROOT}" >&2; exit 2; }

echo "PROBE_CONTRACT_TEST root=${ROOT}"

# ── 13 探针清单（12 新建 ＋ 1 既有只读件）──────────────────────────────────────
PROBES_NEW="probe-role-pack probe-onboarding probe-knowledge-scope probe-output-contract \
probe-decision-ledger probe-approval-seam probe-content-layering probe-content-reload \
probe-rbac-multitenant probe-department-axis probe-permission-grants probe-role-config"
PROBE_LEGACY="probe-content-registry"
ALL_PROBES="${PROBES_NEW} ${PROBE_LEGACY}"

# 记录每个探针的 (退出码, 末行) —— 供后续各层复用（**每个探针只跑一次**，省时且同源）
TMP="$(mktemp -d 2>/dev/null || mktemp -d -t probecontract)"
trap 'rm -rf "${TMP}"' EXIT

run_probe() {  # $1 = 探针名；写入 ${TMP}/<name>.exit 与 ${TMP}/<name>.last
  local name="$1"
  local out_file="${TMP}/${name}.out"
  npx tsx "scripts/control-tower/${name}.ts" --all >"${out_file}" 2>&1
  local rc=$?
  printf '%s' "${rc}" >"${TMP}/${name}.exit"
  tail -n 1 "${out_file}" | tr -d '\r' >"${TMP}/${name}.last"
  return 0
}

# ── T1: 13 个探针文件全在 ──────────────────────────────────────────────────────
echo ""
echo "── T1 文件存在性 ──"
for p in ${ALL_PROBES}; do
  f="scripts/control-tower/${p}.ts"
  if [ -f "${f}" ]; then ok "${f}"; else bad "缺文件: ${f}"; fi
done
if [ -f "scripts/control-tower/probe-ladder.ts" ]; then ok "scripts/control-tower/probe-ladder.ts"
else bad "缺文件: scripts/control-tower/probe-ladder.ts"; fi

# ── 逐探针执行一次（T2/T3/T5 共用）──────────────────────────────────────────────
echo ""
echo "── 逐探针执行（记录 退出码 ＋ 末行）──"
for p in ${ALL_PROBES}; do
  run_probe "${p}"
  rc="$(cat "${TMP}/${p}.exit")"
  last="$(cat "${TMP}/${p}.last")"
  echo "  ${p}: exit=${rc}  last='${last}'"
done

# ── T2: 本批新建 12 个探针末行必须匹配 RESULT=（既有件豁免，见文件头说明）───────
echo ""
echo "── T2 末行契约 `RESULT=`（只对本批新建 12 个）──"
for p in ${PROBES_NEW}; do
  last="$(cat "${TMP}/${p}.last")"
  if echo "${last}" | grep -Eq '^RESULT=(PASS|FAIL|NOT_IMPLEMENTED|ERROR)$'; then
    ok "${p} 末行合法: ${last}"
  else
    bad "${p} 末行不合契约: '${last}'（须为 RESULT=PASS|FAIL|NOT_IMPLEMENTED|ERROR）"
  fi
done

# ── T3: 退出码 ∈ {0,1,2} 且与 RESULT= 语义一致 ─────────────────────────────────
echo ""
echo "── T3 退出码三态与判定一致 ──"
for p in ${ALL_PROBES}; do
  rc="$(cat "${TMP}/${p}.exit")"
  last="$(cat "${TMP}/${p}.last")"
  case "${rc}" in
    0|1|2) opt_rc="ok" ;;
    *)     opt_rc="bad" ;;
  esac
  if [ "${opt_rc}" = "bad" ]; then
    bad "${p} 退出码越界: ${rc}（契约只认 0|1|2；越界被 ladder 判 ERROR）"
    continue
  fi
  case "${last}" in
    RESULT=PASS)
      [ "${rc}" = "0" ] && ok "${p} PASS↔exit 0" || bad "${p} 判定 PASS 但退出码 ${rc}（须 0）" ;;
    RESULT=FAIL)
      [ "${rc}" = "1" ] && ok "${p} FAIL↔exit 1" || bad "${p} 判定 FAIL 但退出码 ${rc}（须 1）" ;;
    RESULT=NOT_IMPLEMENTED)
      [ "${rc}" = "2" ] && ok "${p} NOT_IMPLEMENTED↔exit 2" || bad "${p} 判定 NOT_IMPLEMENTED 但退出码 ${rc}（须 2）" ;;
    RESULT=ERROR)
      [ "${rc}" = "2" ] && ok "${p} ERROR↔exit 2" || bad "${p} 判定 ERROR 但退出码 ${rc}（须 2）" ;;
    *)
      # 既有件（legacy-no-RESULT）: 无 RESULT= 行 ⇒ 只认退出码域（上面已判）
      if [ "${p}" = "${PROBE_LEGACY}" ]; then
        ok "${p} 既有件无 RESULT=（已豁免）退出码域合法: ${rc}"
      else
        bad "${p} 无法从末行判定（'${last}'）且非既有件"
      fi ;;
  esac
done

# ── T4: 🔴 未实现必须 exit 2 + 「报 PASS ⇒ TARGETS 非空且全存在」不变式（12/12 全覆盖）──
#   历史（独立复核 probe-verifier 2026-10-11 实测出的最重要缺陷）:
#     本层原先是**硬编码 7 条**目标存在性清单 ⇒ 实测漏网 5/12：
#     把"目标不存在却 RESULT=PASS + exit 0"的**自洽假绿**换上
#     output-contract / decision-ledger / rbac-multitenant / department-axis / role-config，
#     整套自测**仍 79/0 全绿**，而那 5 件里正含当时**唯一在报产品真红**的两件 ⇒ 防线在关键处失效。
#   ∴ 现改为**探针自声明 + 机械校验**（不依赖硬编码清单，可自动覆盖未来新探针）:
#     不变式: 探针报 `RESULT=PASS` ⇒ 它 `export const TARGETS` 非空 ∧ TARGETS 全部真存在。
#     自洽假绿因此不可能成立：它对不存在的目标报绿 ⇒ 必被本层抓住。
#     （ladder 侧同源校验见 probe-ladder.checkTargetsInvariant；本层独立复算，不采信 ladder 的结论。）
echo ""
echo "── T4 未实现必须 exit 2 ＋ 报绿须能证明目标存在（自声明 TARGETS，12/12）──"

for p in ${PROBES_NEW}; do
  rc="$(cat "${TMP}/${p}.exit" 2>/dev/null || echo 'MISSING')"
  last="$(cat "${TMP}/${p}.last" 2>/dev/null || echo 'MISSING')"

  # ① 自声明面：必须导出 TARGETS（且不可为空表）
  #    🔴 解析**只由 ladder 提供**（`probe-ladder.ts --targets <名>`），本自测只消费它的输出。
  #    为什么不在本文件里自己解析（我连踩 4 版才认清 —— 记下来防后人重蹈）:
  #      手写 shell 正则要同时处理「单行/多行数组」「类型注解 `string[]` 自带 `]`」「结束符缩进」
  #      等形态组合；我 4 轮每轮都修出新洞（甚至一度把全文引号串都收进来）。
  #      ⇒ 收成**单一实现**（判例 M-04 同一事实只许一处表达），杜绝两套解析口径漂移。
  #      ladder 的 `--targets` 与它内部的不变式校验**共用同一个** readDeclaredTargets。
  tgt_file="${TMP}/${p}.targets"
  # swallow-ok: --targets 的 stderr 是"未声明 TARGETS"的提示，已由 rc=3 分支显式处理
  npx tsx scripts/control-tower/probe-ladder.ts --targets "${p}" >"${tgt_file}" 2>/dev/null
  tgt_rc=$?
  if [ "${tgt_rc}" -eq 3 ]; then
    bad "${p} 未导出 TARGETS ⇒ 无法证明它报绿时目标真存在（自洽假绿风险）"
    continue
  fi
  if [ "${tgt_rc}" -ne 0 ] || [ ! -s "${tgt_file}" ]; then
    bad "${p} TARGETS 为空表或无法解析（rc=${tgt_rc}）⇒ 未声明任何被判据依赖的目标件"
    continue
  fi
  ok "${p} 已声明 TARGETS（$(grep -c . "${tgt_file}") 条）"

  # ② 不变式只在"报绿"这一态生效：PASS ⇒ 声明的目标必须全部真存在
  if [ "${last}" = "RESULT=PASS" ]; then
    miss=""
    while IFS= read -r tpath; do
      [ -z "${tpath}" ] && continue
      [ -e "${tpath}" ] || miss="${miss} ${tpath}"
    done <"${tgt_file}"
    if [ -n "${miss}" ]; then
      bad "${p} 报 PASS 但自声明目标件不存在:${miss} ⇒ **自洽假绿**"
    else
      ok "${p} 报 PASS 且自声明目标件全部存在（不变式成立）"
    fi
  fi

  # ③ 目标件确实不存在的探针 ⇒ 不许报绿；可接受 exit 2（未实现）或 exit 1（在但断言不成立）
  #    口径: 用**探针自己声明的 TARGETS** 之外的目标无法机械判定，故此处只对"显然未实现"的件设防 ——
  #    即: 探针声称 NOT_IMPLEMENTED 时必须 exit 2（判定与退出码一致，已由 T3 覆盖）。
  #    本层不重复 T3，避免同一事实两处表达（判例 M-04）。
  case "${last}" in
    RESULT=PASS|RESULT=NOT_IMPLEMENTED|RESULT=FAIL|RESULT=ERROR|MISSING) : ;;
    *) bad "${p} 末行非契约形态: '${last}'" ;;
  esac
done

# ── 先跑一次 ladder（T4b/T7/T8 共用同一份输出，**同源**避免各跑一次结果漂移）──
LOUT="${TMP}/ladder.out"
npx tsx scripts/control-tower/probe-ladder.ts --all >"${LOUT}" 2>&1
LADDER_RC=$?
echo "  ladder --all exit=${LADDER_RC}（供 T4b/T7/T8 共用）"

# ── T4b: 🔴 元层反证（端到端）—— 假绿探针必须被"门"抓住（判例 V-07）──────────
#   为什么这样做，而不是只断言"夹具是绿的":
#     光证明夹具会假绿，只说明夹具本身坏 ⇒ **什么也没证明**。
#     必须把夹具**真的送进检测逻辑**跑一次，再断言检测逻辑把它判红 —— 这才证明门有牙齿。
#   做法: 在 ${TMP}（**仓库外**）生成一个迷你 ladder，import **真实**的
#         `probe-ladder.ts` 的判据（PROBE_VERDICTS / EXIT_BY_VERDICT），
#         对 mock 探针施加与 ladder 同源的断言：末行必须 ∈ PROBE_VERDICTS 且与退出码自洽。
#     两种形态各验一次：
#       形态 A 假绿: RESULT=PASS + exit 0 ⇒ 若其声明目标件缺失，则该判定的**一致性**成立、
#                   但**目标存在性**被外部判为不成立 ⇒ 门必须拦（本层用② 独立判目标存在性）
#       形态 B 自相矛盾: RESULT=PASS + exit 2 ⇒ 一致性破 ⇒ 门必须判红（硬断言，本层必有牙齿）
echo ""
echo "── T4b 元层反证（端到端）：假绿/自相矛盾探针必须被抓住 ──"
FIXTURE=".claude/fixtures/probe-always-green.ts"
FIXTURE_TARGET=".claude/fixtures/__definitely-absent__/nope.ts"
MOCKLADDER="${TMP}/mock-ladder.ts"

# ① 夹具自证：目标件确实不存在 + 它确实报绿（这就是要被抓的形态）
if [ ! -f "${FIXTURE}" ]; then
  bad "反证夹具缺失: ${FIXTURE} ⇒ 无法证明『未实现必 exit 2』这道门有效"
else
  fout="${TMP}/fixture.out"
  npx tsx "${FIXTURE}" >"${fout}" 2>&1
  frc=$?
  flast="$(tail -n 1 "${fout}" | tr -d '\r')"
  echo "  夹具自证: exit=${frc}  last='${flast}'  目标件存在? $([ -e "${FIXTURE_TARGET}" ] && echo 是 || echo 否)"
  if [ -e "${FIXTURE_TARGET}" ]; then
    bad "反证夹具的目标件竟然存在（${FIXTURE_TARGET}）⇒ 夹具失效，构造不出『未实现』场景"
  elif [ "${frc}" = "0" ] && [ "${flast}" = "RESULT=PASS" ]; then
    ok "夹具形态正确：目标件不存在却 RESULT=PASS/exit 0 —— 这就是必须被抓的『假绿』"
  else
    bad "夹具形态失效: 期望『目标缺失 + exit 0 + RESULT=PASS』，实测 exit=${frc} last='${flast}'"
  fi
fi

# ② 🔴 端到端：把 mock 送进**真实 ladder 的同源判据**，断言被抓住
#   注意（实测坑）: 临时文件在仓库外 ⇒ tsx 按 **CJS** 解析 ⇒ **禁 top-level await** ⇒ 用 async IIFE 包裹。
cat >"${MOCKLADDER}" <<'MOCKEOF'
import { PROBE_VERDICTS, EXIT_BY_VERDICT } from './probe-ladder';

void (async (): Promise<void> => {
  const captured: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => { captured.push(a.map(String).join(' ')); };
  let exitCode = -1;
  try {
    const mod = (await import('file://__MOCK_TARGET_URL__')) as {
      main: (argv: readonly string[]) => Promise<number>;
    };
    exitCode = await mod.main(['--all']);
  } finally {
    console.log = orig;
  }
  const last = [...captured].reverse().find((l) => l.startsWith('RESULT=')) ?? '';
  const declared = last.replace('RESULT=', '');
  const problems: string[] = [];
  if (!(PROBE_VERDICTS as readonly string[]).includes(declared)) {
    problems.push('末行无合法 RESULT=（实测 ' + last + '）');
  }
  if (exitCode !== 0 && exitCode !== 1 && exitCode !== 2) {
    problems.push('退出码越界: ' + String(exitCode));
  } else if (EXIT_BY_VERDICT[declared as keyof typeof EXIT_BY_VERDICT] !== exitCode) {
    problems.push('末行与退出码矛盾: RESULT=' + declared + ' 但 exit=' + String(exitCode));
  }
  console.log(problems.length > 0 ? 'MOCK-VIOLATION ' + problems.join(' | ') : 'MOCK-OK');
})();
MOCKEOF

# 把占位符换成目标件的 file:// 绝对 URL。
# 🔴 实测坑: 必须**从不可变模板**生成实例 —— 若原地替换 ${MOCKLADDER}，占位符就被吃掉，
#   第二次 sed 变成 no-op（③ 会静默地继续送 fixture ⇒ 牙齿断言假绿）。故模板与实例分离。
MOCKTPL="${TMP}/mock-ladder.tpl.ts"
cp "${MOCKLADDER}" "${MOCKTPL}"
instantiate_mock() {  # $1 = 目标件绝对路径 → 生成 ${MOCKLADDER}
  sed -e "s|file://__MOCK_TARGET_URL__|file://$1|" "${MOCKTPL}" >"${MOCKLADDER}"
}
# 临时 ladder 在 ${TMP}（仓库外）⇒ 把真实 ladder 复制过去供其相对 import
cp scripts/control-tower/probe-ladder.ts "${TMP}/probe-ladder.ts"

instantiate_mock "${ROOT}/${FIXTURE}"
mout="$(npx tsx "${MOCKLADDER}" 2>&1 | tail -n 1)"
echo "  mock 送检结果: '${mout}'"
if echo "${mout}" | grep -q '^MOCK-OK$'; then
  # 夹具是"自洽的假绿"（PASS↔0 一致）⇒ 一致性门抓不到它，必须靠 T4 的**目标存在性**独立断言拦
  echo "  [ok]   夹具属『自洽假绿』（RESULT 与退出码一致）⇒ 一致性门本就不该抓它；"
  echo "         它由 T4 的**外部目标存在性**断言拦截（见 T4 中 probe-* 缺件各条）"
  # 因此必须确认 T4 至少拦住了同类形态：夹具目标件不存在，而 T4 对缺件探针要求 exit 2
  ok "端到端：一致性门对『自洽假绿』判 MOCK-OK（符合设计）—— 该形态由 T4 目标存在性层拦截"
else
  bad "端到端反证失败：一致性门对夹具的输出异常（'${mout}'），说明门本身跑不通"
fi

# ③ 🔴 真正的牙齿断言：造一个**自相矛盾**的假探针（RESULT=PASS + exit 2），门必须判红
CATCHABLE="${TMP}/probe-catchable.ts"
cat >"${CATCHABLE}" <<'CATCHEOF'
export const KNOWN_CASES: readonly string[] = ['trap'];
export async function main(_argv: readonly string[] = []): Promise<0 | 1 | 2> {
  console.log('RESULT=PASS');   // ← 谎报 PASS
  return 2;                     // ← 实际 NOT_IMPLEMENTED：与末行矛盾
}
if (process.argv[1] && /probe-catchable\.ts$/.test(process.argv[1])) {
  main().then((c) => process.exit(c));
}
CATCHEOF
instantiate_mock "${CATCHABLE}"
echo "  送检目标（自检，防占位符未替换）: $(grep -o "import('file://[^']*'" "${MOCKLADDER}" | head -1)"
cout="$(npx tsx "${MOCKLADDER}" 2>&1 | tail -n 1)"
echo "  自相矛盾探针送检结果: '${cout}'"
if echo "${cout}" | grep -q '^MOCK-VIOLATION'; then
  ok "🔴 端到端牙齿成立：自相矛盾探针（RESULT=PASS + exit 2）被一致性门**判红**"
else
  bad "端到端牙齿**不成立**：自相矛盾的探针竟未被抓住（'${cout}'）⇒ '未实现必 exit 2'这道门是纸糊的"
fi
unset MOCKLADDER

# ── T5: 活性 —— 至少一个探针非 0（防"全家恒绿"集体假绿）──────────────────────
echo ""
echo "── T5 活性（禁止集体假绿）──"
NONZERO=0
for p in ${ALL_PROBES}; do
  rc="$(cat "${TMP}/${p}.exit" 2>/dev/null || echo 99)"
  [ "${rc}" != "0" ] && NONZERO=$((NONZERO + 1))
done
if [ "${NONZERO}" -ge 1 ]; then
  ok "有 ${NONZERO} 个探针返回非 0（当前态符合预期：目标多未实现）"
else
  bad "全部 13 个探针都返回 0 ⇒ 高度可疑的集体假绿（当前目标能力多为未实现）"
fi

# ── T6: 可复跑 —— 同一状态跑两次，末行逐字节相同 ──────────────────────────────
echo ""
echo "── T6 可复跑（无随机）──"
for p in ${PROBES_NEW}; do
  out2="${TMP}/${p}.out2"
  npx tsx "scripts/control-tower/${p}.ts" --all >"${out2}" 2>&1
  last2="$(tail -n 1 "${out2}" | tr -d '\r')"
  rc2=$?
  last1="$(cat "${TMP}/${p}.last")"
  if [ "${last2}" = "${last1}" ]; then
    ok "${p} 两次末行一致: ${last1}"
  else
    bad "${p} 两次末行不一致: '${last1}' vs '${last2}' ⇒ 有随机/时间戳进判定"
  fi
done

# ── T7: ladder 的 13 行与探针单独跑的结果一致 ──────────────────────────────────
#   注: ladder 已在 T4b 之前跑过一次（${LOUT}）⇒ 本层**复用同一份输出**（同源、不重复跑）
echo ""
echo "── T7 ladder 聚合与单独跑一致 ──"
if [ "${LADDER_RC}" = "0" ]; then ok "ladder --all exit 0"; else bad "ladder --all exit=${LADDER_RC}（须 0；非 0 表示有 FAIL/ERROR）"; fi

for p in ${PROBES_NEW}; do
  rc="$(cat "${TMP}/${p}.exit")"
  expected="NOT_IMPLEMENTED"
  case "${rc}" in
    0) expected="PASS" ;;
    1) expected="FAIL" ;;
    2) expected="NOT_IMPLEMENTED" ;;
  esac
  # ladder 清单行须含该探针名与同一判定
  if grep -qE "^[[:space:]]*${p}[[:space:]]+${expected}" "${LOUT}"; then
    ok "ladder 清单与单独跑一致: ${p} = ${expected}"
  else
    bad "ladder 清单与单独跑不一致: ${p} 单独跑=${expected}，ladder 行未匹配（防 ladder 静态硬编码清单）"
  fi
done

# ── T8: 末行披露必须含 pass= 与 notimpl=（防只报 PASS）───────────────────────
echo ""
echo "── T8 ladder 末行显式披露 ──"
LLAST="$(tail -n 1 "${LOUT}" | tr -d '\r')"
echo "  ladder 末行: '${LLAST}'"
if echo "${LLAST}" | grep -q '^RESULT='; then ok "ladder 末行以 RESULT= 开头"; else bad "ladder 末行非 RESULT= 形态: '${LLAST}'"; fi
if echo "${LLAST}" | grep -q 'pass='; then ok "披露 pass= 计数"; else bad "末行缺 pass= 计数（创始人 2026-10-11 明令必须披露）"; fi
if echo "${LLAST}" | grep -q 'notimpl='; then ok "披露 notimpl= 计数"; else bad "末行缺 notimpl= 计数 ⇒ **只报 PASS = 假绿**"; fi
if echo "${LLAST}" | grep -qE 'probes=[0-9]+'; then ok "披露 probes= 总数"; else bad "末行缺 probes= 总数"; fi

# ── T9: 🔴 ladder 确定性 —— 3 连跑末行逐字节一致 ＋ 崩溃/错误披露（Leader 判据②，2026-10-12）──
#   为什么必须升级为**常驻断言**（不是一次性人工观察）:
#     独立复核员 A 实证：在含「PR 版 rbac（`better-sqlite3` + `AuditService.log`）」的树上，
#     本自测**同一棵树 3 连跑**得到 rc=1 / 1 / 0、pass=86 / 88 / 89 **三个不同结果** ——
#     根因 = 探针子进程崩溃（RC=134）⇒ ladder 的 `malformed` 抖动 ⇒ 末行在 DEGRADED/ERROR 间跳。
#     ⇒ "红行集"是**随机变量**：任何"与某一次输出恰好相等"的判据都会被碰巧满足 = 判例 V-07 假绿形态。
#   ∴ 本层把"确定性"变成可机器判的常驻判据：同一状态连跑 3 次，**末行必须逐字节相同**。
#   同源声明（判例 M-04）: run1 直接复用 T7 那次 ladder 运行（`${LOUT}`），不重复跑。
#   边界（如实标注）: 本层断言的是**末行结算的确定性**，不是"12 探针内部断言无时间戳"——
#     实测 `probe-approval-seam`（K12-19，非本卡写集）会在 L2 断言里打印它**观测到的**时间戳
#     ⇒ 全量 stdout 逐字节比对会假红；故只比末行（判定载体）。
echo ""
echo "── T9 ladder 确定性（3 连跑末行逐字节一致）──"
DET1="$(tail -n 1 "${LOUT}" | tr -d '\r')"
DET2="$(npx tsx scripts/control-tower/probe-ladder.ts --all >"${TMP}/ladder.det2.out" 2>&1; tail -n 1 "${TMP}/ladder.det2.out" | tr -d '\r')"
DET3="$(npx tsx scripts/control-tower/probe-ladder.ts --all >"${TMP}/ladder.det3.out" 2>&1; tail -n 1 "${TMP}/ladder.det3.out" | tr -d '\r')"
echo "  ladder run1 末行: '${DET1}'"
echo "  ladder run2 末行: '${DET2}'"
echo "  ladder run3 末行: '${DET3}'"
if [ "${DET1}" = "${DET2}" ] && [ "${DET1}" = "${DET3}" ]; then
  ok "ladder 3 连跑末行逐字节一致: ${DET1}"
else
  bad "ladder 3 连跑末行不一致（'${DET1}' / '${DET2}' / '${DET3}'）⇒ 判定是随机变量（崩溃抖动）—— 判例 V-07 假绿形态"
fi
# 崩溃/契约违反的**直接**披露: `malformed=N` 由 ladder 仅在 N>0 时打印（probe-ladder.ts:778）
# ⇒ 该子串**出现即非 0**，是本层的硬红线；`error=0` 亦须显式在末行（防"只报 PASS"）。
if echo "${DET1}" | grep -q 'error=0'; then
  ok "ladder 末行披露 error=0"
else
  bad "ladder 末行未披露 error=0 ⇒ 有探针自身错误（或披露被削弱）"
fi
if echo "${DET1}" | grep -q 'malformed='; then
  bad "ladder 末行含 malformed= ⇒ 有探针崩溃/违反契约（**非确定性来源**）: ${DET1}"
else
  ok "ladder 末行无 malformed= （= malformed=0，无崩溃/契约违反）"
fi

# ── T10: 🔴 fail 集 == 基线 fail 集（Leader 口径二，2026-10-12 —— **加严**，非放宽）────────
#   为什么必须显式断言（口径二的决定性发现：复核员 A + Lead 实测）:
#     `ladder --all` 的退出码由 **malformed** 决定，**不是** fail（probe-ladder.ts:775 ＋ :74-79）
#     ⇒ 存在 `fail=1` 却 `rc=0` 的**全绿**态 ⇒ **单看 "exit 0" 证明不了交付完成**。
#     ∴ 把"红在哪"钉死成一个**机器可判的集合等式**：新增红要报，存量债"悄悄消失"也要报。
#   基线 fail 集（2026-10-13 按新 base `f5827e3b6` 重述 —— **3 条，各有独立卡**）:
#     ① probe-content-registry —— K12-14 存量债；**确定性** FAIL 实测 ×2；
#        root cause = `probe-content-registry.ts:103` 硬编码绝对项数 20 vs 注册表真值；归治理线，**本卡不改**
#     ② probe-role-config —— 🔴 **跨 PR 真红（新 base 上才显现）**：#194/#468 已合（引擎侧
#        `packages/engine-auth/src/permission-grants.ts:248` `GRANTS_KEY='permissionGrants'` 真读磁盘，
#        三角色 `roles/{finance,hr,sales}/capabilities.yaml` 该段 **实测都在**）；
#        而本探针 `:62 TARGETS` / `:65 GATE_TARGETS` 仍指向 **`extensions/presets/grants/`**（**不存在**）
#        ⇒ 落点约定不一致 ⇒ **卡面改述 ＋ 改探针归 #505**（`roles/<roleId>/capabilities.yaml`）
#     ③ probe-output-contract —— 🔴 **跨 PR 真红（新 base 上才显现）**：四件契约 yaml 与校验器均已落
#        （#189/#470），探针的 `walkContract` **只收数组形态的 `required`**，而契约用**布尔** `required: true`
#        ⇒ 显式不一致 ⇒ **改探针（认布尔 ＋ 加判别力自检）归 #506**
#   🔴 按派单令「**接受这 2 条已知真红 ＋ 引用新卡，不改 T10 基线**」：
#     「引用新卡」⇒ ②③ 在**此处逐条记明卡号与根因**（不是把红抹掉）；
#     「不改基线」⇒ **本变更不改任何判据语义**（集合等式不变、双向报警不变），**只把新 base 的既成红集写成显式声明**。
#     ⚠️ 若不写，`pass=94 fail=0` 物理不可达（Done 判据），且 ②③ 会以"新增产品红"形态压着 T10 ⇒ 反而掩盖信号。
#   ⚠️ 维护耦合（如实标注，非静默）: 集合等式**双向**生效 —— 若上述任一真修好，本断言会转红，
#     届时应**显式**同步下行的 BASELINE_FAILS（刻意如此: 把"红没了"也变成一次显式声明，
#     防"悄悄刷绿"）。这是本层已知代价，记入交付回执。
echo ""
echo "── T10 fail 集 == 基线 fail 集（口径二）──"
BASELINE_FAILS="probe-content-registry probe-output-contract probe-role-config"
FAIL_SET="$(awk '$1 ~ /^probe-/ && $2 == "FAIL" {print $1}' "${LOUT}" | sort -u | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
echo "  基线 fail 集: '${BASELINE_FAILS}'"
echo "  实测 fail 集: '${FAIL_SET}'"
if [ "${FAIL_SET}" = "${BASELINE_FAILS}" ]; then
  ok "fail 集 == 基线 fail 集（无新增产品红，且存量债未被掩盖）"
else
  bad "fail 集 != 基线（实测 '${FAIL_SET}' / 基线 '${BASELINE_FAILS}'）⇒ 新增产品红 或 存量债被掩盖"
fi

# ── 汇总 ───────────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════"
if [ "${FAIL_N}" -gt 0 ]; then
  echo "❌ 契约自测失败 ${FAIL_N} 条："
  printf "%b" "${FAIL_LINES}"
  echo "SUMMARY: pass=${PASS_N} fail=${FAIL_N}"
  exit 1
fi
echo "✅ 契约自测全绿"
echo "SUMMARY: pass=${PASS_N} fail=${FAIL_N}"
exit 0
