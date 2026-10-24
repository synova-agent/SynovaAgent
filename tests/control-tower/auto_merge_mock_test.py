#!/usr/bin/env python3
"""auto_merge_mock_test.py — #954 行为回归网（线程 mock Gitea，覆盖分页与改名绕过）

被测：scripts/control-tower/auto-merge.sh
接缝：SYNO_AUTO_MERGE_FORCE_CAN=1（跳过四条件）＋ SYNO_GITEA_BASE（API 基址）
判据：受保护路径在第 2 页 或 藏在 previous_filename ⇒ 必须 SKIP 且不发 merge
"""
import json, os, subprocess, sys, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SCRIPT = os.path.join(ROOT, "scripts", "control-tower", "auto-merge.sh")
MERGES = []

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _j(self, obj):
        raw = json.dumps(obj).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw))); self.end_headers(); self.wfile.write(raw)
    def do_GET(self):
        if "/files" in self.path:
            pr = self.path.split("/pulls/")[1].split("/")[0]
            page = int(self.path.split("page=")[1].split("&")[0]) if "page=" in self.path else 1
            if pr == "999":   # 分页：受保护在第 2 页（第 56 位）
                if page == 1: body = [{"filename": "docs/f%02d.md" % i} for i in range(50)]
                elif page == 2:
                    body = [{"filename": "docs/f%02d.md" % (50 + i)} for i in range(9)]
                    body.append({"filename": "scripts/control-tower/ledger-sync.sh"})
                else: body = []
            else:             # 改名：filename 安全，previous_filename 受保护
                body = [{"filename": "docs/moved.md",
                         "previous_filename": "scripts/control-tower/ledger-sync.sh"}]
            return self._j(body)
        page = int(self.path.split("page=")[1].split("&")[0]) if "page=" in self.path else 1
        if page > 1:
            return self._j([])
        return self._j([{"number": 999, "head": {"sha": "deadbeef"}, "base": {"ref": "main"}, "draft": False}])
    def do_POST(self):
        MERGES.append(self.path)
        self.send_response(200); self.send_header("Content-Length", "2"); self.end_headers(); self.wfile.write(b"{}")

def run(pr):
    srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
    t = threading.Thread(target=srv.serve_forever, daemon=True); t.start()
    base = "http://127.0.0.1:%d/api/v1/repos/synova-agent/SynovaAgent" % srv.server_port
    env = dict(os.environ, GITEA_TOKEN="fake", SYNO_GITEA_BASE=base, SYNO_AUTO_MERGE_FORCE_CAN="1")
    r = subprocess.run(["bash", SCRIPT, "--apply"], capture_output=True, text=True, env=env, timeout=120)
    srv.shutdown()
    return r

fails = []
def chk(cond, msg):
    print(("  ✅ " if cond else "  ❌ ") + msg)
    if not cond: fails.append(msg)

print("── A. 分页：受保护在第 2 页（第 56 位，复刻 Gitea 单页上限 50）⇒ 必须 SKIP 且不 merge ──")
r = run(999)
chk(("触受保护路径" in r.stdout), "第 2 页受保护路径被拦（分页生效）")
assert "触受保护路径" in r.stdout, "分页 fail-open：第 2 页受保护路径未被拦"
chk(len(MERGES) == 0, "未执行 merge")
assert len(MERGES) == 0, "分页场景竟执行了 merge"
chk(r.returncode == 0, "退出码 0（SKIP 不是错误）")

print("── B. 改名绕过：filename 安全 + previous_filename 受保护 ⇒ 必须 SKIP ──")
MERGES.clear()
r2 = run(998)
chk(("触受保护路径" in r2.stdout), "改名绕过被拦（previous_filename 生效）")
assert "触受保护路径" in r2.stdout, "改名绕过 fail-open"
chk(len(MERGES) == 0, "未执行 merge")
assert len(MERGES) == 0, "改名场景竟执行了 merge"

sys.exit(1 if fails else 0)
