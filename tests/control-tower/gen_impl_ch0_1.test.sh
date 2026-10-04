#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# gen_impl_ch0_1.test.sh — U7/CT-40 配对测试
#   配对对象: scripts/workflow/gen_impl_ch0_1.py（D1063 / CN-01 改写保留）
#
# 覆盖矩阵（铁律 48 三路径 + 接线）:
#   正常 — 源码断言: 完整名 + 部分名 双零命中；中性占位符在场
#        — POSIX 执行: mktemp 隔离 cwd 连跑两遍 → 产出逐字节一致；产出内双零命中
#   降级 — 非 POSIX(Windows bash): 显式打印原因后跳过执行段（可见，非静默 fail-open）
#        — python3 不可用: 同上显式降级
#   边界 — 生成器缺失 → 立即失败；未产出文件 → 失败
#   接线 — 生成器位于 scripts/workflow/ 且 basename 符合 U7 配对约定
#
# 防「测试自身成为新泄露面」: 待查串一律用**八进制转义**在运行时构造，
#   本文件源码内零明文（bash 3.2+ 支持 printf 八进制转义）。
#
# 平台说明（为何执行段要分流）: 生成器 OUT 硬编码 Windows 绝对路径且脚本内无 mkdir，
#   在 POSIX 上会落成一个含反斜杠的普通文件名（可跑、可比较），在 Windows 上则依赖 D: 盘存在。
# ═══════════════════════════════════════════════════════════════
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GEN="$REPO/scripts/workflow/gen_impl_ch0_1.py"
PLACEHOLDER='示例企业A'

PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

# 八进制转义构造待查串（源码零明文）
NAME_FULL="$(printf '\345\223\207\345\221\242\345\256\235\350\264\235')"
NAME_PART="$(printf '\345\223\207\345\221\242')"

TMPS=""
cleanup() { [ -n "$TMPS" ] && rm -rf $TMPS; }
trap cleanup EXIT

# 统计匹配行数（grep -c 无匹配时输出 0 且 exit 1 —— 不加 `|| echo 0`，避免 "0\n0" 双行）
count_in() { grep -c "$2" "$1" 2>/dev/null | tr -d '\n\r'; }

hash_of() { python3 -c 'import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$1" 2>/dev/null; }

echo "=== gen_impl_ch0_1.py 生成器配对测试（D1063 / CN-01）==="

# ── 边界: 生成器存在 ──
if [ -f "$GEN" ]; then
  ok "边界: 生成器存在于 scripts/workflow/"
else
  no "边界: 生成器缺失 → $GEN"
  echo ""
  echo "  结果: PASS=$PASS FAIL=$FAIL"
  echo "❌ 1 项失败（无法继续）"
  exit 1
fi

# ── 接线: 路径符合 U7 配对约定 ──
if [ "$(basename "$GEN")" = "gen_impl_ch0_1.py" ]; then
  ok "接线: basename 符合 U7 配对约定（scripts/workflow/<name>.py ↔ tests/control-tower/<name>.test.sh）"
else
  no "接线: basename 不符 U7 约定"
fi

# ── 正常 1: 源码内完整名零命中 ──
C_FULL=$(count_in "$GEN" "$NAME_FULL"); C_FULL=${C_FULL:-0}
if [ "$C_FULL" = "0" ]; then ok "正常: 源码内完整名零命中"; else no "正常: 源码残留完整名 ${C_FULL} 行"; fi

# ── 正常 2: 源码内部分名零命中（4 字滑窗门禁抓不到的 2 字前缀，本测试单独兜住）──
C_PART=$(count_in "$GEN" "$NAME_PART"); C_PART=${C_PART:-0}
if [ "$C_PART" = "0" ]; then ok "正常: 源码内部分名零命中"; else no "正常: 源码残留部分名 ${C_PART} 行"; fi

# ── 正常 3: 中性占位符在场（证明不是「删空」而是「换成占位」）──
C_PH=$(count_in "$GEN" "$PLACEHOLDER"); C_PH=${C_PH:-0}
if [ "$C_PH" -ge 1 ]; then ok "正常: 中性占位符在场（${C_PH} 行）"; else no "正常: 源码未见中性占位符"; fi

# ── 执行段（平台分流，降级一律显式可见）──
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    echo "  ℹ️  平台判定: $(uname -s)（Windows bash）"
    echo "  ℹ️  生成器 OUT 为 Windows 绝对路径（脚本内零 mkdir）⇒ 本平台跳过执行段，仅保留上方结构断言。"
    echo "  ℹ️  显式降级（非静默 fail-open）；执行段在 POSIX 平台强制生效。"
    ;;
  *)
    if ! command -v python3 >/dev/null 2>&1; then
      echo "  ℹ️  python3 不可用 ⇒ 跳过执行段（显式降级，非静默）"
    else
      T1=$(mktemp -d); TMPS="$TMPS $T1"
      T2=$(mktemp -d); TMPS="$TMPS $T2"

      ( cd "$T1" && python3 "$GEN" >/dev/null 2>&1 ); RC1=$?
      ( cd "$T2" && python3 "$GEN" >/dev/null 2>&1 ); RC2=$?
      if [ "$RC1" -eq 0 ] && [ "$RC2" -eq 0 ]; then
        ok "执行: 两跑均 exit 0"
      else
        no "执行: 生成器退出码 rc1=$RC1 rc2=$RC2"
      fi

      F1=$(find "$T1" -type f | head -1)
      F2=$(find "$T2" -type f | head -1)
      if [ -n "$F1" ] && [ -n "$F2" ]; then
        ok "执行: 两跑均产出文件"
        H1=$(hash_of "$F1"); H2=$(hash_of "$F2")
        if [ -n "$H1" ] && [ "$H1" = "$H2" ]; then
          ok "执行: 两跑产出逐字节一致（稳定，sha256=${H1}）"
        else
          no "执行: 两跑产出不一致（h1=$H1 h2=$H2）"
        fi
        G_FULL=$(count_in "$F1" "$NAME_FULL"); G_FULL=${G_FULL:-0}
        G_PART=$(count_in "$F1" "$NAME_PART"); G_PART=${G_PART:-0}
        if [ "$G_FULL" = "0" ] && [ "$G_PART" = "0" ]; then
          ok "执行: 产出内完整名+部分名双零命中"
        else
          no "执行: 产出内残留（完整名=${G_FULL} 部分名=${G_PART}）"
        fi
      else
        no "执行: 未产出文件（F1=${F1:-空} F2=${F2:-空}）"
      fi
    fi
    ;;
esac

echo ""
echo "  结果: PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" -eq 0 ]; then
  echo "✅ 全部通过"
  exit 0
else
  echo "❌ $FAIL 项失败"
  exit 1
fi
