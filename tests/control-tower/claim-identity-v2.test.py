#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tests/control-tower/claim-identity-v2.test.py — D-C 标识归一 R3 三场景夹具 + 变异体反例
（K3 2026-10-07 变更前预审 R3/R5：**无夹具不合并**）

覆盖矩阵（铁律 48 三路径；K3 指定 a/b/c 三场景 + 变异体）

  a. **新 claim 生效** —— `.claude/claims/<issue>.yaml`（writeset + done 两字段）
     a1 claim_store 解析（writeset/done/flag 三态 exit）
     a2 brief_parser claim 分支（parse_q2/parse_done/parse_criteria/parse_layer 单源）
     a3 resolver（`SYNO_CLAIM_V2=1`）按暂存文件命中返回 claim 路径
     a4 D708 merge_writeset_gate 走 S0:claim.writeset 声明源 → pass
     a5 check-verifiable-done 在 claim 上绿

  b. **旧 D# 只读、不劫持**（K3 预审 §③ 双口径污染；R4 防劫持守卫）
     b1 分支名带旧 D#（feat/D999-legacy）+ 新 claim 并存 → 取 claim（**D# 链未执行**）
     b2 resolver：分支 D# 锚点 brief 存在 + claim 存在 → claim 胜（修复前 D# 锚点劫持）
     b3 无 claim 的纯 legacy D# 路径 → 逐字节旧行为（零回归）

  c. **声明缺失 fail-closed**（K3 预审 §③ 末段：旧锚点退役、新锚点未接的中间态）
     c1 `SYNO_CLAIM_V2=1` + 暂存非空 + 无任何声明 → check-verifiable-done **exit 1**
     c2 同输入但开关关 → exit 0（**回滚 = 关开关**，K3 R2）
     c3 claim 畸形 → merge_writeset_gate **exit 2**（fail-closed，不等于通过）
     c4 done 条目缺 `verify:` → claim_store **exit 2**

  d. **变异体反例（改坏即红）** —— 对「生产脚本的副本」注入缺陷，断言副本的判定与生产
     **必须不同**（即：把守卫删掉，夹具就会红）。这是"夹具真判别"的证明，不是自证。
     d1 删 resolver 防劫持守卫 → 双口径劫持复现
     d2 删 claim_store 空 writeset 校验 → 空声明被静默接受
     d3 删 claim_store 未知键校验 → typo（write_set）被静默丢字段
     d4 删 gate 的 claim 分支 → S0 声明源消失（对账锚点消失）

隔离: 全部在 mktemp 临时仓/临时目录，零网络、零真实仓库写入。
运行: python3 tests/control-tower/claim-identity-v2.test.py   （exit 0 = 全绿）
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
CT = REPO_ROOT / "scripts" / "control-tower"
CLAIM_STORE = CT / "claim_store.py"
BRIEF_PARSER = CT / "brief_parser.py"
GATE = CT / "merge_writeset_gate.py"
RESOLVER = REPO_ROOT / "scripts" / "workflow" / "resolve-commit-brief.sh"
VERIFIABLE_DONE = REPO_ROOT / "scripts" / "check-verifiable-done.sh"

CLAIM_BODY = """writeset:
  - scripts/a.sh
  - scripts/b.sh
done:
  - verify: bash tests/control-tower/claim-identity-v2.test.py
note: 夹具样例声明
"""


def _run(cmd, cwd=None, env=None, stdin=None):
    e = dict(os.environ)
    e.pop("SYNO_CLAIM_V2", None)
    e.pop("SYNO_CLAIM_DIR", None)
    e.pop("SYNO_ISSUE_HINT", None)
    if env:
        e.update(env)
    p = subprocess.run(cmd, cwd=cwd, env=e, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", input=stdin, timeout=120)
    return p.returncode, (p.stdout or ""), (p.stderr or "")


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="claimv2-"))
        self.repo = self.tmp / "repo"
        self.repo.mkdir()
        subprocess.run(["git", "init", "-q", str(self.repo)], check=True, capture_output=True)
        for k, v in (("user.email", "t@t"), ("user.name", "t")):
            subprocess.run(["git", "-C", str(self.repo), "config", k, v], check=True,
                           capture_output=True)
        (self.repo / ".claude" / "claims").mkdir(parents=True)
        (self.repo / ".claude" / "task-briefs").mkdir(parents=True)
        (self.repo / "scripts" / "workflow").mkdir(parents=True)
        (self.repo / "scripts" / "control-tower").mkdir(parents=True)
        # 把生产工具链**按原位**复制进临时仓 —— resolver 用 BASH_SOURCE 相对定位
        # brief_parser/claim_store，check-verifiable-done 用 git root 定位 resolver。
        self.tool_resolver = self.repo / "scripts" / "workflow" / "resolve-commit-brief.sh"
        self.tool_claim = self.repo / "scripts" / "control-tower" / "claim_store.py"
        self.tool_parser = self.repo / "scripts" / "control-tower" / "brief_parser.py"
        for src, dst in ((RESOLVER, self.tool_resolver), (CLAIM_STORE, self.tool_claim),
                         (BRIEF_PARSER, self.tool_parser)):
            shutil.copy2(src, dst)
            # 副本必须与生产**逐字节一致** —— 否则夹具测的是别的东西（防"夹具空转"）
            self.assertEqual(src.read_bytes(), dst.read_bytes(), f"工具链副本漂移: {src}")
        (self.repo / "scripts" / "a.sh").write_text("echo a\n", encoding="utf-8")
        (self.repo / "scripts" / "b.sh").write_text("echo b\n", encoding="utf-8")
        (self.repo / "docs").mkdir()
        (self.repo / "docs" / "other.md").write_text("x\n", encoding="utf-8")
        self.commit_all("chore: fixture base")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    # ── 夹具工具 ──
    def write_claim(self, issue, body=CLAIM_BODY):
        p = self.repo / ".claude" / "claims" / f"{issue}.yaml"
        p.write_text(body, encoding="utf-8")
        return p

    def stage_edit(self, rel="scripts/a.sh", text="echo changed\n"):
        """改动一个**在 claim writeset 内**的文件（使变更集非空且可对账）。"""
        p = self.repo / rel
        p.write_text(text, encoding="utf-8")
        return p

    def commit_all(self, msg="chore(#1234): fixture"):
        subprocess.run(["git", "-C", str(self.repo), "add", "-A"], check=True, capture_output=True)
        subprocess.run(["git", "-C", str(self.repo), "commit", "-q", "-m", msg],
                       check=True, capture_output=True)

    def commit_count(self):
        out = subprocess.run(["git", "-C", str(self.repo), "rev-list", "--count", "HEAD"],
                             check=True, capture_output=True, text=True).stdout
        return int(out.strip())

    def gate(self, branch, extra=None, env=None, tool=None):
        cmd = [sys.executable, str(tool or GATE), "--repo-root", str(self.repo),
               "--base", "HEAD~1", "--head", "HEAD", "--branch", branch, "--json"]
        cmd.extend(extra or [])
        rc, out, err = _run(cmd, env=env)
        try:
            obj = json.loads(out.strip().splitlines()[-1]) if out.strip() else {}
        except (ValueError, IndexError):
            obj = {"_raw": out, "_err": err}
        return rc, obj

    def resolve(self, staged, env=None, tool=None):
        return _run(["bash", str(tool or self.tool_resolver), staged],
                    cwd=str(self.repo), env=env)

    def check_done(self, env=None):
        return _run(["bash", str(VERIFIABLE_DONE)], cwd=str(self.repo), env=env)


# ══════════════════════════════════════════════════════════════════════════════
# a. 新 claim 生效
# ══════════════════════════════════════════════════════════════════════════════
class TestA_NewClaimTakesEffect(Base):

    def test_a1_claim_store_parses_two_fields(self):
        self.write_claim(1234)
        rc, out, _ = _run([sys.executable, str(CLAIM_STORE), "--root", str(self.repo),
                           "--show", "#1234"], env={"SYNO_CLAIM_DIR": str(self.repo / ".claude" / "claims")})
        self.assertEqual(rc, 0, out)
        d = json.loads(out)
        self.assertEqual(d["issue"], "1234")
        self.assertEqual(d["writeset"], ["scripts/a.sh", "scripts/b.sh"])
        self.assertEqual(len(d["done"]), 1)
        # done 项契约: `verify:` 前缀在解析时剥离，值 = 可跑命令本体（供 brief_parser
        # parse_done 重新渲染成 `- [x] verify: <cmd>` —— 单一事实源）
        self.assertTrue(d["done"][0]["verify"].startswith("bash "), d["done"])
        self.assertNotIn("verify:", d["done"][0]["verify"])

    def test_a1b_flag_defaults_off(self):
        rc, out, _ = _run([sys.executable, str(CLAIM_STORE), "--flag"])
        self.assertEqual(rc, 0)
        self.assertEqual(out.strip(), "off", "SYNO_CLAIM_V2 必须默认关（K3 R2 回滚语义）")

    def test_a2_brief_parser_single_source(self):
        p = self.write_claim(1234)
        rc, out, _ = _run([sys.executable, str(BRIEF_PARSER), "--all", str(p)])
        self.assertEqual(rc, 0, out)
        d = json.loads(out)
        self.assertTrue(d["parseable"])
        self.assertEqual(d["q2_include"], ["scripts/a.sh", "scripts/b.sh"])
        self.assertEqual(d["q2_exclude"], [])
        self.assertEqual(d["done_count"], 1)
        self.assertTrue(all("verify:" in x for x in d["done"]), d["done"])

    def test_a3_resolver_returns_claim_when_flag_on(self):
        self.write_claim(1234)
        rc, out, _ = self.resolve("scripts/a.sh", env={"SYNO_CLAIM_V2": "1"})
        self.assertEqual(rc, 0, f"flag on 应解析出 claim；stderr={out}")
        self.assertTrue(out.strip().endswith("1234.yaml"), out)

    def test_a4_gate_uses_claim_as_declaration_source(self):
        self.write_claim(1234)
        self.stage_edit()
        self.commit_all()
        rc, obj = self.gate("feat/1234-identity")
        self.assertEqual(rc, 0, obj)
        src = obj.get("sources", {})
        self.assertTrue(str(src.get("claim", "")).endswith("1234.yaml"), src)
        labels = {e["source"] for e in obj.get("declared", [])}
        self.assertIn("S0:claim.writeset", labels, obj.get("declared"))
        self.assertEqual(obj.get("task_id_source"), "claim",
                         "claim 生效时 D# 链必须未执行")

    def test_a5_verifiable_done_green_on_claim(self):
        self.write_claim(1234)
        self.stage_edit()
        subprocess.run(["git", "-C", str(self.repo), "add", "-A"], check=True, capture_output=True)
        rc, out, err = self.check_done(env={"SYNO_CLAIM_V2": "1"})
        self.assertEqual(rc, 0, out + err)
        self.assertIn("全部有 verify", out)


# ══════════════════════════════════════════════════════════════════════════════
# b. 旧 D# 只读、不劫持
# ══════════════════════════════════════════════════════════════════════════════
class TestB_LegacyDidNoHijack(Base):

    def _legacy_brief(self, did):
        (self.repo / ".claude" / "task-briefs" / f"2026-10-07-{did}-legacy.md").write_text(
            "## Q2: 范围\n做什么:\n- scripts/a.sh\n\n## Done 标准:\n"
            "- [x] verify: bash tests/x.sh\n\n## 架构层: 基础设施\n#CRITERIA: A\n",
            encoding="utf-8")

    def test_b1_branch_with_legacy_did_does_not_hijack_claim(self):
        """分支名带旧 D# + 新 claim 并存 → claim 胜，D# 链不执行（K3 R4 裁决场景）。"""
        self.write_claim(1234)
        self.stage_edit()
        self.commit_all()
        subprocess.run(["git", "-C", str(self.repo), "checkout", "-q", "-b", "feat/D999-legacy"],
                       check=True, capture_output=True)
        rc, obj = self.gate("feat/D999-legacy", extra=["--issue", "1234"])
        self.assertEqual(rc, 0, obj)
        self.assertEqual(obj.get("issue"), "1234")
        self.assertEqual(obj.get("task_id_source"), "claim")
        self.assertIsNone(obj.get("task_id"), "D# 链不得被执行（否则=劫持）")
        self.assertEqual(obj.get("sources", {}).get("task_state"), None)

    def test_b2_resolver_prefers_claim_over_did_anchor(self):
        self.write_claim(1234)
        self._legacy_brief("D999")
        rc, out, _ = self.resolve("scripts/a.sh", env={"SYNO_CLAIM_V2": "1"})
        self.assertEqual(rc, 0, out)
        self.assertTrue(out.strip().endswith("1234.yaml"),
                        f"claim 必须胜过 D# 锚点 brief；实得 {out.strip()}")

    def test_b3_pure_legacy_path_unchanged(self):
        """无 claim 的纯 legacy D# 任务 → 旧行为（零回归）。"""
        self._legacy_brief("D999")
        rc, out, _ = self.resolve("scripts/a.sh")
        self.assertEqual(rc, 0, out)
        self.assertIn("D999", out, "纯 legacy 认领必须保持")


# ══════════════════════════════════════════════════════════════════════════════
# c. 声明缺失 fail-closed
# ══════════════════════════════════════════════════════════════════════════════
class TestC_FailClosed(Base):

    def test_c1_missing_declaration_blocks_when_flag_on(self):
        self.stage_edit()
        subprocess.run(["git", "-C", str(self.repo), "add", "-A"], check=True, capture_output=True)
        rc, out, _ = self.check_done(env={"SYNO_CLAIM_V2": "1"})
        self.assertEqual(rc, 1, "声明缺失必须 fail-closed（exit 1）而非静默跳过")
        self.assertIn("硬阻断", out)

    def test_c2_same_input_legacy_off_still_skips(self):
        """开关关 → 逐字节 legacy（K3 R2「回滚 = 关开关」）。"""
        self.stage_edit()
        subprocess.run(["git", "-C", str(self.repo), "add", "-A"], check=True, capture_output=True)
        rc, out, _ = self.check_done()
        self.assertEqual(rc, 0, out)
        self.assertIn("跳过", out)

    def test_c3_malformed_claim_gate_exit2(self):
        self.write_claim(1234, "writeset:\n  - scripts/a.sh\nwrite_set:\n  - typo\ndone:\n"
                               "  - verify: bash x.sh\n")
        self.stage_edit()
        self.commit_all()
        rc, obj = self.gate("feat/1234-x")
        self.assertEqual(rc, 2, f"畸形 claim 必须 exit 2（fail-closed），实得 {rc}: {obj}")
        self.assertEqual(obj.get("status"), "degraded")

    def test_c4_done_without_verify_exit2(self):
        self.write_claim(1234, "writeset:\n  - scripts/a.sh\ndone:\n  - 跑一下测试\n")
        rc, out, _ = _run([sys.executable, str(CLAIM_STORE), "--root", str(self.repo),
                           "--check", "1234"],
                          env={"SYNO_CLAIM_DIR": str(self.repo / ".claude" / "claims")})
        self.assertEqual(rc, 2, out)
        self.assertIn("claim-done-without-verify", out)

    def test_c5_empty_writeset_exit2(self):
        self.write_claim(1234, "writeset:\ndone:\n  - verify: bash x.sh\n")
        rc, out, _ = _run([sys.executable, str(CLAIM_STORE), "--root", str(self.repo),
                           "--check", "1234"],
                          env={"SYNO_CLAIM_DIR": str(self.repo / ".claude" / "claims")})
        self.assertEqual(rc, 2, out)
        self.assertIn("claim-empty-writeset", out)

    def test_c6_empty_done_exit2(self):
        self.write_claim(1234, "writeset:\n  - scripts/a.sh\ndone:\n")
        rc, out, _ = _run([sys.executable, str(CLAIM_STORE), "--root", str(self.repo),
                           "--check", "1234"],
                          env={"SYNO_CLAIM_DIR": str(self.repo / ".claude" / "claims")})
        self.assertEqual(rc, 2, out)
        self.assertIn("claim-empty-done", out)


# ══════════════════════════════════════════════════════════════════════════════
# d. 变异体反例（改坏即红）—— 副本必须与生产判定不同
# ══════════════════════════════════════════════════════════════════════════════
class TestD_Mutants(Base):
    """对生产脚本副本注入缺陷，断言**副本的行为与生产不同**。

    这是"夹具真判别"的证明：若夹具是纸老虎，删掉守卫后副本会与生产**一致**（测试红）。
    """

    def _mutate(self, src: Path, dst: Path, old: str, new: str):
        text = src.read_text(encoding="utf-8")
        self.assertIn(old, text, f"变异点位缺失（源码已漂移，夹具需同步）: {old!r}")
        dst.write_text(text.replace(old, new, 1), encoding="utf-8")
        self.assertNotEqual(src.read_bytes(), dst.read_bytes())
        return dst

    def test_d1_removing_hijack_guard_reproduces_hijack(self):
        """删 resolver 的 `-z "$CLAIM_FILE"` 守卫 → D# 锚点劫持复现。

        夹具构造（必须让守卫**成为唯一分叉点**，否则变异体与生产同判 = 纸老虎）:
          · 分支名同时含 issue 号与旧 D#（`feat/1234-D999-legacy`）
              → issue 身份=#1234（claim 存在 ⇒ 守卫生效）
              → D# 强锚点=D999（旧机制的回退目标）
          · 暂存文件 `scripts/c.sh` **不被任何 brief/claim 认领** → 认领计数为空
              → 必然走到末尾回退链（正是劫持发生的位点）
          · 一份旧日期 parseable brief（D999）+ 一份更新的 parseable brief
              → 去掉守卫时回退命中 D999；有守卫时落到日期回退（另一份）
          · 开关 OFF（守卫是"减法"，不随开关回退 —— 见 resolve-commit-brief.sh 头注释）
        副本放在 `<repo>/scripts/workflow/` —— resolver 用 BASH_SOURCE 相对定位
        brief_parser/claim_store，放错位置等于"骨折"而非"变异"。
        """
        mutant = self._mutate(
            self.tool_resolver, self.repo / "scripts" / "workflow" / "resolver-mutant.sh",
            'if [ -z "$CLAIM_FILE" ] && [ -n "$ANCHORED_STRONG_FILES" ] && [ -n "$PYBIN" ]; then',
            'if [ -n "$ANCHORED_STRONG_FILES" ] && [ -n "$PYBIN" ]; then')

        self.write_claim(1234)
        bf = self.repo / ".claude" / "task-briefs"
        bf.mkdir(parents=True, exist_ok=True)
        (bf / "2026-01-01-D999-legacy.md").write_text(
            "## Q2: 范围\n做什么:\n- docs/unrelated.md\n\n## 架构层: 基础设施\n#CRITERIA: A\n",
            encoding="utf-8")
        (bf / "2026-06-01-other.md").write_text(
            "## Q2: 范围\n做什么:\n- docs/another.md\n\n## 架构层: 基础设施\n#CRITERIA: A\n",
            encoding="utf-8")
        self.stage_edit()
        self.commit_all("chore: fixture")
        subprocess.run(["git", "-C", str(self.repo), "checkout", "-q", "-b",
                        "feat/1234-D999-legacy"], check=True, capture_output=True)
        (self.repo / "scripts" / "c.sh").write_text("echo c\n", encoding="utf-8")
        subprocess.run(["git", "-C", str(self.repo), "add", "scripts/c.sh"], check=True,
                       capture_output=True)

        rc_prod, out_prod, err_prod = self.resolve("scripts/c.sh")
        rc_mut, out_mut, err_mut = self.resolve("scripts/c.sh", tool=mutant)
        self.assertNotEqual(
            (rc_prod, out_prod.strip()), (rc_mut, out_mut.strip()),
            f"变异体必须与生产判定不同（否则夹具无法判别）: prod={out_prod.strip()!r} "
            f"mutant={out_mut.strip()!r} / prod_err={err_prod.strip()!r} mut_err={err_mut.strip()!r}")
        self.assertIn("D999", out_mut, "变异体应复现「旧 D# 锚点被选中」的劫持形态")
        self.assertNotIn("D999", out_prod, "生产不得回退到旧 D# 锚点（R4 防劫持守卫）")

    def test_d2_removing_empty_writeset_check_accepts_empty(self):
        mutant = self._mutate(
            self.tool_claim, self.repo / "scripts" / "control-tower" / "claim_store-mutant.py",
            '    if not isinstance(ws, list) or not ws:', '    if False:')
        self.write_claim(1234, "writeset:\ndone:\n  - verify: bash x.sh\n")
        env = {"SYNO_CLAIM_DIR": str(self.repo / ".claude" / "claims")}
        rc_prod, out_prod, _ = _run([sys.executable, str(CLAIM_STORE), "--root", str(self.repo),
                                     "--check", "1234"], env=env)
        rc_mut, out_mut, _ = _run([sys.executable, str(mutant), "--root", str(self.repo),
                                   "--check", "1234"], env=env)
        self.assertEqual(rc_prod, 2, out_prod)
        self.assertNotEqual(rc_prod, rc_mut, f"变异体应放行空 writeset: {out_mut}")

    def test_d3_removing_unknown_key_check_swallows_typo(self):
        mutant = self._mutate(
            self.tool_claim, self.repo / "scripts" / "control-tower" / "claim_store-mutant3.py",
            '            if key not in ALLOWED_KEYS:', '            if False:')
        self.write_claim(1234, "writeset:\n  - scripts/a.sh\nwrite_set:\n  - typo\ndone:\n"
                               "  - verify: bash x.sh\n")
        env = {"SYNO_CLAIM_DIR": str(self.repo / ".claude" / "claims")}
        rc_prod, out_prod, _ = _run([sys.executable, str(CLAIM_STORE), "--root", str(self.repo),
                                     "--check", "1234"], env=env)
        rc_mut, out_mut, _ = _run([sys.executable, str(mutant), "--root", str(self.repo),
                                   "--check", "1234"], env=env)
        self.assertEqual(rc_prod, 2, out_prod)
        self.assertNotEqual(rc_prod, rc_mut, f"变异体应静默吞掉 typo 键: {out_mut}")

    def test_d4_removing_gate_claim_branch_loses_anchor(self):
        mutant = self._mutate(
            GATE, self.repo / "scripts" / "control-tower" / "gate-mutant.py",
            "collect_declared(repo, ts, dd, bf, claim_path_found)",
            "collect_declared(repo, ts, dd, bf, None)")
        self.write_claim(1234)
        self.stage_edit()
        self.commit_all()
        rc_prod, obj_prod = self.gate("feat/1234-identity")
        rc_mut, obj_mut = self.gate("feat/1234-identity")
        # 生产: S0 声明源生效
        self.assertIn("S0:claim.writeset",
                      {e["source"] for e in obj_prod.get("declared", [])}, obj_prod)
        # 用变异体副本直接跑（--repo-root 指向同一仓，脚本路径换成副本）
        cmd = [sys.executable, str(mutant), "--repo-root", str(self.repo),
               "--base", "HEAD~1", "--head", "HEAD", "--branch", "feat/1234-identity", "--json"]
        _rc, out, _err = _run(cmd)
        obj_mut = json.loads(out.strip().splitlines()[-1])
        self.assertNotIn("S0:claim.writeset",
                         {e["source"] for e in obj_mut.get("declared", [])},
                         "变异体删掉 claim 分支后 S0 源必须消失（否则夹具无法判别）")
        self.assertIsNotNone(obj_prod.get("sources", {}).get("claim"),
                             "生产必须解析出 S0 claim 源")
        # 变异体把 claim 源置空后，声明源整体消失 → 对账锚点消失（这正是 R5 要防的）
        self.assertEqual([], obj_mut.get("declared", []),
                         f"变异体应失去全部声明源: {obj_mut.get('declared')}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
