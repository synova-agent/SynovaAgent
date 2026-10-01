"""Tests for D320 — gen-task-board.py (L2 单元, 临时 repo 隔离)

权威: SYNOVA-IMPL-D320 仪表盘 git 化生成器 (2026-08-08) §4 测试要求
  red→green 5 用例 (≥5 断言, 正常/降级/边界/幂等/保留):
    1. 临时 repo 构造 2 个 D# 提交 → 输出含 D#/提交哈希/推送状态
    2. MANUAL 区原样保留 (marker 间内容)
    3. 幂等: 两次运行输出一致 (diff 空, mtime 不变)
    4. CI 缺失 → degraded 标注 (不假 0/假绿)
    5. 空 git 历史 → 空任务表 + 不异常

测试隔离: 临时目录 (tempfile.mkdtemp) + git init; gh 用 runner 注入假数据,
不依赖网络。SUT 经 importlib 加载 (与 dashboard-alignment.test.py 同风格)。
"""
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

# ─── SUT: 加载 gen-task-board.py (D320) ───
_SUT = os.path.join(
    os.path.dirname(__file__), "..", "..", "scripts", "control-tower", "gen-task-board.py",
)
_spec = importlib.util.spec_from_file_location("gen_task_board", os.path.abspath(_SUT))
_gtb = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_gtb)

AUTO_START = _gtb.AUTO_START
AUTO_END = _gtb.AUTO_END
MANUAL_START = _gtb.MANUAL_START
MANUAL_END = _gtb.MANUAL_END


def _git(repo: Path, *args: str) -> subprocess.CompletedProcess:
    """在临时 repo 内执行 git 命令 (隔离)"""
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30,
    )


def make_repo() -> Path:
    """构造临时 git repo (main 分支 + 本地身份)"""
    tmp = Path(tempfile.mkdtemp(prefix="gtb-test-"))
    r = _git(tmp, "init", "-b", "main")
    assert r.returncode == 0, r.stderr
    _git(tmp, "config", "user.email", "test@synova.local")
    _git(tmp, "config", "user.name", "Test Runner")
    return tmp


def commit_file(repo: Path, name: str, msg: str) -> str:
    """提交一个文件, 返回 commit hash"""
    p = repo / name
    p.write_text("content of %s\n" % name, encoding="utf-8")
    _git(repo, "add", name)
    r = _git(repo, "commit", "-m", msg)
    assert r.returncode == 0, r.stderr
    return _git(repo, "rev-parse", "HEAD").stdout.strip()


def fake_runner_ok(payload: dict) -> object:
    """构造返回假 gh JSON 的 runner"""
    def runner(cmd, **kwargs):  # noqa: ANN001
        del kwargs
        return subprocess.CompletedProcess(
            cmd, 0, stdout=json.dumps(payload, ensure_ascii=False), stderr="")
    return runner


def fake_runner_fail() -> object:
    """构造模拟 gh 二进制缺失/失败的 runner (raise FileNotFoundError)"""
    def runner(cmd, **kwargs):  # noqa: ANN001
        del cmd, kwargs
        raise FileNotFoundError("gh: command not found")
    return runner


class TestGenTaskBoard(unittest.TestCase):
    """D320 生成器 — 5 组 red→green 用例"""

    # ════════════════════════════════════════════════════════════════
    # 用例 0: 品牌迁移显示层归一 (ClawOrg → Synova, 不改写 git 历史)
    # ════════════════════════════════════════════════════════════════

    def test_author_brand_normalization(self):
        """normalize_author/email: ClawOrg 变体 → Synova; 未命中原样返回"""
        self.assertEqual(_gtb.normalize_author("ClawOrg"), "Synova")
        self.assertEqual(_gtb.normalize_author("ClawOrg-Win"), "Synova-Win")
        self.assertEqual(_gtb.normalize_author("ClawOrg-Mac"), "Synova-Mac")
        self.assertEqual(_gtb.normalize_author("Synova"), "Synova")
        self.assertEqual(_gtb.normalize_author("Test Runner"), "Test Runner")
        self.assertEqual(_gtb.normalize_email("claworg@users.noreply.github.com"),
                         "synova@users.noreply.github.com")
        self.assertEqual(_gtb.normalize_email("wane@wanedeMacBook-Pro.local"),
                         "synova@users.noreply.github.com")
        self.assertEqual(_gtb.normalize_email("test@synova.local"),
                         "test@synova.local")

    def test_author_alias_masked_without_plaintext(self):
        """D1063/CN-01: 历史客户标识别名走**加盐哈希**通道归一，且明文不入库。

        断言设计（为什么不用真实别名）: 真实别名本身就是客户标识 ⇒ 把它写进测试文件
        等于把要清的东西再入库一次。故:
          ① 机制自证 — 注册一个**合成**别名，断言其经哈希通道被归一（行为等价旧明文 key）
          ② 结构自证 — 生产哈希表非空、key 全为 64 hex、value 为归一显示名
          ③ 反向自证 — 未登记别名**原样返回**（不臆改他人作者名）
        真实别名仍生效由验收时以实际值调用本函数复核（不落盘明文）。
        """
        synth = "SYNTHETIC-AUTHOR-ALIAS"
        self.assertEqual(_gtb.normalize_author(synth), synth)   # 未登记 → 原样
        with mock.patch.dict(_gtb._AUTHOR_ALIAS_MAP,
                             {_gtb._alias_digest(synth): "Synova-Mac"}):
            self.assertEqual(_gtb.normalize_author(synth), "Synova-Mac")
        self.assertGreaterEqual(len(_gtb._AUTHOR_ALIAS_MAP), 1, "生产别名哈希表不得为空")
        for digest, display in _gtb._AUTHOR_ALIAS_MAP.items():
            self.assertRegex(digest, r"^[0-9a-f]{64}$", "key 必须是加盐 SHA-256（64 hex）")
            self.assertTrue(display.startswith("Synova"), f"归一显示名异常: {display}")

    def test_author_normalized_in_git_log(self):
        """git_log_d 读取时对历史 ClawOrg author 做显示层归一 (email 同步)"""
        repo = make_repo()
        _git(repo, "config", "user.name", "ClawOrg")
        _git(repo, "config", "user.email", "claworg@users.noreply.github.com")
        commit_file(repo, "c.txt", "feat(D325): ClawOrg 身份提交")
        commits = _gtb.git_log_d(repo)
        self.assertEqual(len(commits), 1)
        self.assertEqual(commits[0]["author"], "Synova")
        self.assertEqual(commits[0]["email"], "synova@users.noreply.github.com")

    # ════════════════════════════════════════════════════════════════
    # 用例 1: D# 提取 + 推送状态 (正常路径)
    # ════════════════════════════════════════════════════════════════

    def test_commit_extraction_and_render(self):
        """2 个 D# 提交 → 输出含 D#/提交哈希/推送状态 (origin 缺失 → 未知)"""
        repo = make_repo()
        h1 = commit_file(repo, "a.txt", "fix(D321): 第一个 D 任务提交")
        h2 = commit_file(repo, "b.txt", "feat(D322): 第二个 D 任务提交")

        commits = _gtb.git_log_d(repo)
        self.assertEqual(len(commits), 2)
        self.assertEqual(commits[0]["d_ids"], ["D322"])
        self.assertEqual(commits[0]["short_hash"], h2[:7])
        self.assertEqual(commits[1]["d_ids"], ["D321"])
        self.assertIn("D321", commits[1]["subject"])

        # 无 origin → 推送状态 = 未知 (不假绿不假红)
        unpushed = _gtb.git_unpushed(repo, "main")
        self.assertIsNone(unpushed)
        tasks = _gtb.build_tasks([], {}, commits, unpushed, {})
        self.assertEqual(len(tasks), 2)
        self.assertIsNone(tasks[0]["pushed"])

        # 渲染后含 D#/短哈希/未知推送标记
        auto = _gtb.render_auto(tasks, [], [], {"runs": [], "degraded": None},
                                {"data": None, "degraded": "无审计数据"}, (0, 0), "cn")
        self.assertIn("D322", auto)
        self.assertIn(h2[:7], auto)
        self.assertIn("未知", auto)

    def test_push_state_with_origin(self):
        """origin 存在: 已推送 ✅ / 未推送 ❌ 精确区分"""
        repo = make_repo()
        bare = Path(tempfile.mkdtemp(prefix="gtb-bare-")) / "origin.git"
        r = subprocess.run(["git", "init", "--bare", str(bare)],
                           capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        _git(repo, "remote", "add", "origin", str(bare))
        h1 = commit_file(repo, "a.txt", "feat(D323): 已推送提交")
        _git(repo, "push", "-u", "origin", "main")
        h2 = commit_file(repo, "b.txt", "feat(D324): 未推送提交")

        unpushed = _gtb.git_unpushed(repo, "main")
        self.assertIsNotNone(unpushed)
        self.assertIn(h2, unpushed)
        self.assertNotIn(h1, unpushed)

        commits = _gtb.git_log_d(repo)
        tasks = _gtb.build_tasks([], {}, commits, unpushed, {})
        by_id = {t["d_id"]: t for t in tasks}
        self.assertTrue(by_id["D323"]["pushed"])
        self.assertFalse(by_id["D324"]["pushed"])

    # ════════════════════════════════════════════════════════════════
    # 用例 2: MANUAL 区原样保留 (只增不删)
    # ════════════════════════════════════════════════════════════════

    def test_manual_zone_preserved(self):
        """marker 间内容 (含特殊字符/表格) 逐字节保留"""
        manual_content = (
            "## 三、剩余缺口\n\n"
            "| # | 缺口 | 状态 |\n"
            "|---|------|------|\n"
            "| G1 | GA合同到期日UI | D239已加Constraints |\n\n"
            "> 事故恢复区（勿删）: 完整 v4.9 在 stash@{0}。中文标点、`代码`、emoji ✅🔴 全保留。\n"
        )
        legacy = (
            "# 旧标题\n\n" + AUTO_START + "\n(old auto)\n" + AUTO_END + "\n"
            + MANUAL_START + "\n" + manual_content + MANUAL_END + "\n"
        )
        extracted = _gtb.extract_manual(legacy)
        self.assertIsNotNone(extracted)
        self.assertEqual(extracted, manual_content)

        rendered = _gtb.render_dashboard("auto-zone\n", extracted, "cn")
        self.assertIn(manual_content, rendered)
        # 完整重跑: 二次提取仍逐字节一致
        self.assertEqual(_gtb.extract_manual(rendered), manual_content)

    def test_first_run_marker_insertion(self):
        """无 marker 的旧文件 → 首次运行整体迁入 MANUAL 区 (仅剥旧 frontmatter+标题)"""
        legacy = (
            "---\ntitle: \"旧版\"\nversion: v4.8\n---\n\n"
            "# Synova 项目仪表盘\n\n"
            "> 手工维护内容: 恢复区 + 待办表。\n\n"
            "| D# | 状态 |\n|----|------|\n| D311 | ✅ 9096993 |\n"
        )
        manual = _gtb.strip_legacy_header(legacy)
        self.assertNotIn("---", manual.split("\n")[0])
        self.assertNotIn("# Synova 项目仪表盘", manual)
        self.assertIn("> 手工维护内容", manual)
        self.assertIn("D311", manual)

        repo = make_repo()
        commit_file(repo, "x.txt", "feat(D325): 首跑提交")
        dash_dir = repo / "docs" / "synova"
        dash_dir.mkdir(parents=True)
        cn_path = dash_dir / "DASHBOARD-CN.md"
        cn_path.write_text(legacy, encoding="utf-8")
        commits = _gtb.git_log_d(repo)
        tasks = _gtb.build_tasks([], {}, commits, None, {})
        auto = _gtb.render_auto(tasks, [], [], {"runs": [], "degraded": None},
                                {"data": None, "degraded": "无审计数据"}, (0, 0), "cn")
        content = _gtb.render_dashboard(auto, _gtb.strip_legacy_header(legacy), "cn")
        self.assertIn(AUTO_START, content)
        self.assertIn(MANUAL_START, content)
        self.assertIn("手工维护内容", content)
        self.assertIn("D311", content)
        self.assertIn("D325", content)

    # ════════════════════════════════════════════════════════════════
    # 用例 3: 幂等 — 两次运行输出一致 + mtime 不变
    # ════════════════════════════════════════════════════════════════

    def test_idempotent_no_rewrite(self):
        """内容无变化 → 不写文件 (mtime 不变); 变化 → 写"""
        repo = make_repo()
        commit_file(repo, "x.txt", "feat(D326): 幂等提交")
        dash_dir = repo / "docs" / "synova"
        dash_dir.mkdir(parents=True)
        cn_path = dash_dir / "DASHBOARD-CN.md"

        def run_once():
            commits = _gtb.git_log_d(repo)
            tasks = _gtb.build_tasks([], {}, commits, None, {})
            auto = _gtb.render_auto(tasks, [], [], {"runs": [], "degraded": None},
                                    {"data": None, "degraded": "无审计数据"}, (0, 0), "cn")
            content = _gtb.render_dashboard(auto, "手动区\n", "cn")
            return _gtb.write_if_changed(cn_path, content)

        self.assertTrue(run_once())  # 首次写入
        self.assertTrue(cn_path.exists())
        content1 = cn_path.read_text(encoding="utf-8")
        mtime1 = cn_path.stat().st_mtime_ns
        self.assertFalse(run_once())  # 无变化 → 不写
        content2 = cn_path.read_text(encoding="utf-8")
        self.assertEqual(content1, content2)
        self.assertEqual(mtime1, cn_path.stat().st_mtime_ns)

        # 自动区变化 → 写
        content3 = content1.replace("D326", "D327")
        self.assertTrue(_gtb.write_if_changed(cn_path, content3))
        self.assertIn("D327", cn_path.read_text(encoding="utf-8"))

    # ════════════════════════════════════════════════════════════════
    # 用例 4: CI 缺失 → degraded 标注 (不假 0/假绿)
    # ════════════════════════════════════════════════════════════════

    def test_ci_degraded_when_gh_unavailable(self):
        """gh 二进制失败 → degraded 标注, 无假数据"""
        repo = make_repo()
        ci = _gtb.read_ci(repo, "main", 10, gh_bin="gh", runner=fake_runner_fail())
        self.assertEqual(ci["runs"], [])
        self.assertIsNotNone(ci["degraded"])
        self.assertIn("gh", ci["degraded"])

        auto = _gtb.render_auto([], [], [], ci,
                                {"data": None, "degraded": "无审计数据"}, (0, 0), "cn")
        self.assertIn("degraded", auto)
        self.assertIn("gh", auto)

    def test_ci_success_injected(self):
        """gh 可用 (注入假 JSON) → run 解析 + 渲染含工作流名"""
        repo = make_repo()
        payload = [
            {"workflowName": "ci", "status": "completed", "conclusion": "success",
             "headSha": "a" * 40, "displayTitle": "fix(D328): ci ok", "createdAt": "2026-08-08T10:00:00Z"},
            {"workflowName": "lint", "status": "completed", "conclusion": "failure",
             "headSha": "b" * 40, "displayTitle": "feat(D329): lint fail", "createdAt": "2026-08-08T11:00:00Z"},
        ]
        ci = _gtb.read_ci(repo, "main", 10, gh_bin="gh", runner=fake_runner_ok(payload))
        self.assertEqual(len(ci["runs"]), 2)
        self.assertIsNone(ci["degraded"])
        auto = _gtb.render_auto([], [], [], ci,
                                {"data": None, "degraded": "无审计数据"}, (0, 0), "cn")
        self.assertIn("ci", auto)
        self.assertIn("lint", auto)
        self.assertIn("success", auto)
        self.assertIn("failure", auto)

    # ════════════════════════════════════════════════════════════════
    # 用例 5: 空 git 历史 → 空任务表 + 不异常
    # ════════════════════════════════════════════════════════════════

    def test_empty_history_no_crash(self):
        """无提交/无文档 → 空任务表, 渲染不抛异常"""
        repo = make_repo()
        commits = _gtb.git_log_d(repo)
        self.assertEqual(commits, [])
        tasks = _gtb.build_tasks([], {}, commits, None, {})
        self.assertEqual(tasks, [])
        auto = _gtb.render_auto(tasks, [], [], {"runs": [], "degraded": "gh 不可用"},
                                {"data": None, "degraded": "无审计数据"}, (0, 0), "cn")
        self.assertIn(AUTO_START, auto)
        self.assertIn("D#", auto)
        self.assertIn("degraded", auto)
        # 空 dev docs / 空 override 均不崩
        self.assertEqual(_gtb.scan_dev_docs(repo / "docs"), [])
        self.assertEqual(_gtb.parse_override(repo / "override.yaml"), {})

    # ════════════════════════════════════════════════════════════════
    # 附加: override 手动薄层 + dev doc 头解析
    # ════════════════════════════════════════════════════════════════

    def test_override_applied(self):
        """override 优先级/blocked/backlog 并入任务表"""
        override_text = (
            "# D320 手动薄层 — 生成器只读\n"
            "priorities:\n"
            "  - D330: P0\n"
            "statuses:\n"
            "  - D330: 🔴 blocked\n"
            "blocked:\n"
            "  - D330: 等待创始人决策\n"
            "backlog:\n"
            "  - D331: git notes 独立任务 (D321)\n"
        )
        tmp = Path(tempfile.mkdtemp(prefix="gtb-ovr-"))
        ovr = tmp / "board-override.yaml"
        ovr.write_text(override_text, encoding="utf-8")
        data = _gtb.parse_override(ovr)
        self.assertEqual(data["priorities"], {"D330": "P0"})
        self.assertIn("D330", data["blocked"])
        self.assertEqual(len(data["backlog"]), 1)
        self.assertIn("D331", data["backlog"][0])

        tasks = _gtb.build_tasks([], {}, [], None, data)
        d330 = [t for t in tasks if t["d_id"] == "D330"]
        self.assertEqual(len(d330), 1)
        self.assertEqual(d330[0]["priority"], "P0")
        self.assertEqual(d330[0]["status"], "🔴 blocked")
        auto = _gtb.render_auto(tasks, [], [], {"runs": [], "degraded": None},
                                {"data": None, "degraded": "无审计数据"}, (0, 0), "cn")
        self.assertIn("D330", auto)
        self.assertIn("D331", auto)

    def test_dev_doc_header_parse(self):
        """dev doc 头部注释解析: 状态/日期/优先级"""
        header = (
            "<!--\n"
            "  SYNOVA-IMPL-D332: 测试任务\n"
            "  状态: dev doc | 2026-08-08 | 优先级 P1\n"
            "-->"
        )
        info = _gtb.parse_doc_header(header)
        self.assertEqual(info["status"], "dev doc")
        self.assertEqual(info["date"], "2026-08-08")
        self.assertEqual(info["priority"], "P1")
        self.assertEqual(_gtb.parse_doc_header("# 无注释头"), {})


if __name__ == "__main__":
    unittest.main()
