#!/usr/bin/env python3
"""auto_merge_mock_test.py — #954 行为回归网（线程 mock Gitea；分页／改名／负对照）

被测：scripts/control-tower/auto-merge.sh（可用 SYNO_AUTO_MERGE_SCRIPT 指向变异体）
接缝：SYNO_AUTO_MERGE_FORCE_CAN=1（跳过四条件）＋ SYNO_GITEA_BASE（API 基址）
判据：
  A 分页：60 文件、受保护在第 60 位（第 2 页）⇒ SKIP 且不 merge
  B 改名：filename 安全 + previous_filename 受保护 ⇒ SKIP 且不 merge
  C 负对照：previous_filename 不受保护 ⇒ 允许合并（证明 B 的拦截不是"永不合并"）
"""
import json, os, subprocess, sys, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SCRIPT = os.environ.get("SYNO_AUTO_MERGE_SCRIPT", os.path.join(ROOT, "scripts", "control-tower", "auto-merge.sh"))
MERGES = []

def make_handler(pr):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a): pass
        def _j(self, obj):
            raw = json.dumps(obj).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw))); self.end_headers(); self.wfile.write(raw)
        def do_GET(self):
            if "/files" in self.path:
                page = int(self.path.split("page=")[1].split("&")[0]) if "page=" in self.path else 1
                if pr == 999:                       # A 分页：受保护在第 60 位
                    if page == 1: body = [{"filename": "docs/f%02d.md" % i} for i in range(50)]
                    elif page == 2:
                        body = [{"filename": "docs/f%02d.md" % (50 + i)} for i in range(9)]
                        body.append({"filename": "scripts/control-tower/ledger-sync.sh"})
                    else: body = []
                elif page > 1:
                    body = []
                elif pr == 998:                     # B 改名绕过
                    body = [{"filename": "docs/moved.md",
                             "previous_filename": "scripts/control-tower/ledger-sync.sh"}]
                else:                               # C 负对照：previous 不受保护
                    body = [{"filename": "docs/renamed.md",
                             "previous_filename": "docs/old-name.md"}]
                return self._j(body)
            page = int(self.path.split("page=")[1].split("&")[0]) if "page=" in self.path else 1
            if page > 1: return self._j([])          # 列表分页：第 2 页起空（防死循环）
            return self._j([{"number": pr, "head": {"sha": "deadbeef"}, "base": {"ref": "main"}, "draft": False}])
        def do_POST(self):
            MERGES.append(self.path)
            self.send_response(200); self.send_header("Content-Length", "2"); self.end_headers(); self.wfile.write(b"{}")
    return H

def run(pr):
    srv = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(pr))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d/api/v1/repos/synova-agent/SynovaAgent" % srv.server_port
    env = dict(os.environ, GITEA_TOKEN="fake", SYNO_GITEA_BASE=base, SYNO_AUTO_MERGE_FORCE_CAN="1")
    try:
        return subprocess.run(["bash", SCRIPT, "--apply"], capture_output=True, text=True, env=env, timeout=120)
    finally:
        srv.shutdown()

fails = []
def chk(cond, msg):
    print(("  ✅ " if cond else "  ❌ ") + msg)
    if not cond: fails.append(msg)

print("── A. 分页：受保护在第 60 位（第 2 页，复刻 Gitea 单页上限 50）──")
MERGES.clear(); r = run(999)
chk("触受保护路径" in r.stdout, "第 2 页受保护路径被拦（分页生效）")
chk(len(MERGES) == 0, "未执行 merge")
chk(r.returncode == 0, "退出码 0（SKIP 不是错误）")
assert "触受保护路径" in r.stdout, "分页 fail-open"
assert len(MERGES) == 0, "分页场景竟 merge"

print("── B. 改名绕过：filename 安全 + previous_filename 受保护 ──")
MERGES.clear(); r2 = run(998)
chk("触受保护路径" in r2.stdout, "改名绕过被拦（previous_filename 生效）")
chk(len(MERGES) == 0, "未执行 merge")
assert "触受保护路径" in r2.stdout, "改名 fail-open"
assert len(MERGES) == 0, "改名场景竟 merge"

print("── C. 负对照：previous_filename 不受保护 ⇒ 应允许合并 ──")
MERGES.clear(); r3 = run(997)
chk(len(MERGES) == 1, "负对照确实合并（证明 B 的拦截不是'永不合并'）")
assert len(MERGES) == 1, "负对照未合并 ⇒ 测试无判别力"

sys.exit(1 if fails else 0)
