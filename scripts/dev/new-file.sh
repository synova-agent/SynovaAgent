#!/bin/bash
# D313 M5 / D732 UTF-8 强制: Windows 控制台/子进程统一 UTF-8（跨平台硬要求，禁删）
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# new-file.sh — L0 脚手架：生成「实现件 ＋ 配对测试件」，头注只写三段真契约
#
# 设计哲学（一句）: **把「新文件头注」的成本压到零** —— 骨架（路径/日期/作者/配对测试）由脚本填，
#   人只填三段契约的内容；头注里**不许留 TBD 占位**（占位 = 假契约 = 让兜底闸失去意义）。
#
# 契约（铁律 47）:
#   @input  --kind component|module（必填）
#           --name <PascalCase|kebab>（必填；component ⇒ PascalCase，module ⇒ kebab-case）
#           [--root <dir>]（实现件落点，默认 <repo>/src）
#           [--force]（目标已存在时覆盖；缺省拒绝，**不静默覆盖**）
#           [--help]
#           注入缝（测试必需，生产有默认值）:
#             SYNO_TEMPLATE_DIR   模板目录（默认 <repo>/templates/code）
#             SYNO_SCAFFOLD_REPO  仓库根（默认脚本自身所在仓根；只影响「测试件是否镜像到 tests/」与默认 root）
#             SYNO_AUTHOR         作者串（默认 `git config user.name`，取不到 ⇒ unknown）
#   @output stdout：逐件 `+ <path>`（实现件、测试件）＋ 末行 `NEW-FILE: created=<n> root=<dir>`
#   @exit   三态（scripts/control-tower/AGENTS.md 既有约定）:
#             0 = 生成成功
#             1 = **输入不合规**（kind 非法 / 名字与 kind 语法不符 / 目标已存在）—— 改参数即可重试
#             2 = **本脚本自身失败**（模板缺失或不可读 / 目录不可创建 / 写失败）—— fail-closed，
#                 绝不与「生成成功」混同（禁把"写不进去"当成"没生成"）
#   @degraded 不适用：本脚本无网络、无远程依赖；任何前置取不到 ⇒ exit 2 并点名缺什么（不静默降级）
#
# 生成物规则（判据可机器复核，见 tests/control-tower/new-file.test.sh）:
#   · 头注 ≤12 行，且必含 `@input` / `@output` / `@degraded` **三段**（#1101 判据 G7）
#   · 文件一律 **LF**（渲染走 printf，不经 CRLF 中转）—— 模板本体若被编辑器写成 CRLF 亦在此归一
#   · 配对测试件：实现件落在 <repo>/src/** ⇒ 镜像到 <repo>/tests/**（仓内约定 + pre-commit 组 2b
#     的机械映射 `src/x.ts → tests/x.test.ts`）；落在仓外（demo/临时目录）⇒ 与实现件同目录
#
# 与门禁的关系（禁读成"生成即等于通过"）:
#   本生成器只保证**三段契约齐 + 配对测试件在 + 头注 ≤12 行**；它**不**替你做接线。
#   pre-commit 组 4 仍要求「新 export 在 src/ 有非测试引用」——生成件默认无人调用，属于**待接线**，
#   由作者补消费点（这是脚手架的正常状态，不是本脚本的缺陷）。
#
# 已知限制:
#   1. 首期只有两类模板（component/module）；再加类别 = 加一份模板 + 在 build_case_block() 里加分支。
#   2. component 模板刻意**不引 JSX/React**（零运行时绑定，任意环境可编译/可测）；
#      要用 JSX 请在实现件里自行 import 并改返回类型 —— 契约三段随之更新（别留旧描述）。
#   3. 只判「生成」，不判业务正确性：@input/@output/@degraded 的内容是**真值声明**，
#      由作者填写/后续修改；生成器给的是可编译、可测、无 TBD 的最小实现。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"
REPO="${SYNO_SCAFFOLD_REPO:-$SCRIPT_REPO}"
# 模板默认取**脚本自身所在仓**（不是注入的 REPO）：注入缝只改「落点/镜像判定」，
# 不得顺带把模板目录也指走 —— 否则测试注入假仓根后连模板都找不到（实测 rc=2）。
TEMPLATE_DIR="${SYNO_TEMPLATE_DIR:-$SCRIPT_REPO/templates/code}"
TODAY="$(date +%Y-%m-%d)"

AUTHOR="${SYNO_AUTHOR:-}"
if [ -z "$AUTHOR" ]; then
  AUTHOR="$(git config user.name 2>/dev/null || true)"  # swallow-ok: 取不到作者只影响头注署名（回退 unknown），不改判定
  [ -z "$AUTHOR" ] && AUTHOR="unknown"
fi

KIND=""
NAME=""
ROOT_ARG=""
FORCE=0

usage() {
  sed -n '8,34p' "${BASH_SOURCE[0]}" | sed -e 's/^# \{0,1\}//'
}

die() { # $1=exit code $2=消息
  printf '❌ %s\n' "$2" >&2
  exit "$1"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --kind)
      [ $# -ge 2 ] || die 1 "--kind 需要参数（component|module）"
      KIND="$2"; shift 2 ;;
    --name)
      [ $# -ge 2 ] || die 1 "--name 需要参数（<PascalCase|kebab>）"
      NAME="$2"; shift 2 ;;
    --root)
      [ $# -ge 2 ] || die 1 "--root 需要参数（<dir>）"
      ROOT_ARG="$2"; shift 2 ;;
    --force)
      FORCE=1; shift ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      die 1 "未知参数: $1（见 --help）" ;;
  esac
done

# ── ① 输入校验（不合规 ⇒ exit 1，可修正）──
[ -n "$KIND" ] || die 1 "缺 --kind（component|module）"
[ -n "$NAME" ] || die 1 "缺 --name（component⇒PascalCase，module⇒kebab-case）"
case "$KIND" in
  component)
    [[ "$NAME" =~ ^[A-Z][A-Za-z0-9]*$ ]] \
      || die 1 "--kind component 的 --name 必须是 PascalCase（实测 '$NAME'）"
    FILE_BASE="$NAME"; IDENT="$NAME"; IMPL_EXT="tsx"; TMPL_IMPL="component.tsx.tmpl" ;;
  module)
    [[ "$NAME" =~ ^[a-z][a-z0-9]*(-[a-z0-9]+)*$ ]] \
      || die 1 "--kind module 的 --name 必须是 kebab-case（实测 '$NAME'）"
    FILE_BASE="$NAME"; IMPL_EXT="ts"; TMPL_IMPL="module.ts.tmpl"
    # kebab → PascalCase（只用 tr，不用 bash 4 的 ${var^}，macOS bash 3.2 亦可用）
    IDENT=""
    _rest="$NAME"
    while [ -n "$_rest" ]; do
      _part="${_rest%%-*}"
      if [ "$_part" = "$_rest" ]; then _rest=""; else _rest="${_rest#*-}"; fi
      IDENT="${IDENT}$(printf '%s' "${_part:0:1}" | tr 'a-z' 'A-Z')${_part:1}"
    done ;;
  *)
    die 1 "--kind 只接受 component|module（实测 '$KIND'）" ;;
esac

# ── ② 模板可用性（缺模板 = 本脚本自身失败 ⇒ exit 2，fail-closed）──
TMPL_IMPL_PATH="$TEMPLATE_DIR/$TMPL_IMPL"
TMPL_TEST_PATH="$TEMPLATE_DIR/test.tmpl"
for _t in "$TMPL_IMPL_PATH" "$TMPL_TEST_PATH"; do
  [ -f "$_t" ] && [ -r "$_t" ] || die 2 "模板缺失或不可读: $_t（检查 -- 见 SYNO_TEMPLATE_DIR / 仓库 templates/code/）"
done

# ── ③ 落点解析（实现件目录 + 配对测试件目录）──
ROOT_DIR="${ROOT_ARG:-$REPO/src}"
mkdir -p "$ROOT_DIR" || die 2 "无法创建实现件目录: $ROOT_DIR"
IMPL_ABS="$(cd "$ROOT_DIR" && pwd)" || die 2 "无法进入实现件目录: $ROOT_DIR"
IMPL_PATH="$IMPL_ABS/${FILE_BASE}.${IMPL_EXT}"

# 配对测试件落点：<repo>/src/** ⇒ 镜像到 <repo>/tests/**（组 2b 机械映射）；
#                   仓外目录 ⇒ 同目录（demo/临时目录没有 tests/ 载体）。
REPO_ABS="$(cd "$REPO" 2>/dev/null && pwd || printf '%s' "$REPO")"
case "$IMPL_ABS/" in
  "$REPO_ABS/src/")
    TEST_DIR="$REPO_ABS/tests" ;;
  "$REPO_ABS/src/"*/)
    _sub="${IMPL_ABS#"$REPO_ABS/src/"}"; TEST_DIR="$REPO_ABS/tests/$_sub" ;;
  *)
    TEST_DIR="$IMPL_ABS" ;;
esac
mkdir -p "$TEST_DIR" || die 2 "无法创建配对测试目录: $TEST_DIR"
TEST_ABS="$(cd "$TEST_DIR" && pwd)" || die 2 "无法进入配对测试目录: $TEST_DIR"
TEST_PATH="$TEST_ABS/${FILE_BASE}.test.ts"

# 测试件的 import 路径（相对、无扩展名；仓内两条路径都在 REPO 下 ⇒ 纯 bash 归一）
if [ "$TEST_ABS" = "$IMPL_ABS" ]; then
  IMPORT_PATH="./${FILE_BASE}"
else
  _rel_impl="${IMPL_ABS#"$REPO_ABS"/}"
  _rel_test="${TEST_ABS#"$REPO_ABS"/}"
  _up=""
  _saved_ifs="$IFS"; IFS='/'
  for _seg in $_rel_test; do [ -n "$_seg" ] && _up="${_up}../"; done
  IFS="$_saved_ifs"
  IMPORT_PATH="${_up}${_rel_impl}/${FILE_BASE}"
fi

# ── ④ 覆盖保护（默认不覆盖；--force 才写）──
if [ "$FORCE" -ne 1 ]; then
  for _p in "$IMPL_PATH" "$TEST_PATH"; do
    [ -e "$_p" ] && die 1 "目标已存在，拒绝覆盖: $_p（确要覆盖请加 --force）"
  done
fi

# ── ⑤ kind 专属断言块（单模板约束下的分工：模板管骨架，本函数管三路径断言）──
build_case_block() {
  case "$KIND" in
    component)
      cat <<'TS'
test('{{NAME}}: 正常路径（@output 渲染文本）', () => {
  expect(typeof {{NAME}}).toBe('function');
  expect({{NAME}}({})).toBe('{{NAME}}');
});

test('{{NAME}}: 边界（重复调用结果稳定、无副作用）', () => {
  const first = {{NAME}}({});
  const second = {{NAME}}({});
  expect(second).toBe(first);
});

test('{{NAME}}: @degraded 不适用（返回值是字符串，无降级通道）', () => {
  expect(typeof {{NAME}}({})).toBe('string');
});
TS
      ;;
    module)
      cat <<'TS'
test('{{NAME}}: 正常路径（@output 规范值）', () => {
  expect({{IDENT}}('  a  ')).toEqual({ value: 'a', degraded: false });
});

test('{{NAME}}: 降级路径（@degraded：全空白 ⇒ value 空 + degraded true）', () => {
  expect({{IDENT}}('   ')).toEqual({ value: '', degraded: true });
});

test('{{NAME}}: 边界（空串不抛异常、按降级处理）', () => {
  expect(() => {{IDENT}}('')).not.toThrow();
  expect({{IDENT}}('').degraded).toBe(true);
});
TS
      ;;
  esac
}
CASE_BLOCK="$(build_case_block)"

# ── ⑥ 渲染：占位符替换 + **LF 强制**（逐行拼装后 printf 落盘，不经 CRLF 中转）──
render() { # $1 = 模板路径；stdout = 渲染结果（恒 LF）
  local tmpl="$1" line out=""
  # {{CASE_BLOCK}} 必须**先**替换：其内容自身还含 {{NAME}}/{{IDENT}}，随后一并替换。
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line//\{\{CASE_BLOCK\}\}/$CASE_BLOCK}"
    line="${line//\{\{NAME\}\}/$FILE_BASE}"
    line="${line//\{\{IDENT\}\}/$IDENT}"
    line="${line//\{\{DATE\}\}/$TODAY}"
    line="${line//\{\{AUTHOR\}\}/$AUTHOR}"
    line="${line//\{\{IMPORT\}\}/$IMPORT_PATH}"
    out="${out}${line}"$'\n'
  done < <(tr -d '\r' < "$tmpl")   # tr -d '\r' = 模板本体 CRLF 归一（生成件恒 LF）
  printf '%s' "$out"
}

IMPL_BODY="$(render "$TMPL_IMPL_PATH")" || die 2 "渲染失败: $TMPL_IMPL_PATH"
TEST_BODY="$(render "$TMPL_TEST_PATH")" || die 2 "渲染失败: $TMPL_TEST_PATH"
[ -n "$IMPL_BODY" ] || die 2 "渲染结果为空: $TMPL_IMPL_PATH"
[ -n "$TEST_BODY" ] || die 2 "渲染结果为空: $TMPL_TEST_PATH"

# 🔴 落盘用 `printf '%s\n'`：命令替换 `$(render …)` 会**剥掉尾部换行**，
#   若按 `printf '%s'` 写，生成件末尾就少一个 LF（实测：cat 与下一行粘在一起）。
printf '%s\n' "$IMPL_BODY" > "$IMPL_PATH" || die 2 "写实现件失败: $IMPL_PATH"
printf '%s\n' "$TEST_BODY" > "$TEST_PATH" || die 2 "写测试件失败: $TEST_PATH"

# ── ⑦ 报告（逐件 + 末行机器可读汇总）──
printf '+ %s\n' "$IMPL_PATH"
printf '+ %s\n' "$TEST_PATH"
printf 'NEW-FILE: created=2 root=%s\n' "$IMPL_ABS"
exit 0
