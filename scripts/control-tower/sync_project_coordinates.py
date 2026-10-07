#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
sync_project_coordinates.py — D1196 (#991/#1212 修复): Issue 坐标系同步（薄壳脚本）

背景: 2026-10-07 合并的 project-coordinates.yml 首跑即 startup failure（push 事件 0 秒无 job）
  ⇒ 判定为 workflow 内联复杂逻辑（含中文 output 键/多段 heredoc）不被 GitHub 接受。
  本卡把逻辑全部移入本脚本（DSH 式：workflow 只做胶水），workflow 侧只剩 checkout + 一条 run。

契约（铁律 47）:
  @input  env: PROJECT_TOKEN（缺 ⇒ 跳过且 exit 0，卡 #991 明令「未配 token 跳过且不红」）
               ISSUE_NUMBER（issue 号）; ISSUE_BODY（issue 正文，可为空）
          argv: --from-body <file>（离线注入缝：从文件读正文，单测用；不触网）
               --dry-run（只解析并打印将写入的字段，不调 API）
  @output stdout: 解析结果 + 每字段写入结果；缺字段 warning 点名（不猜值）
  @exit   0 = 成功或「无 token 跳过」（两者都不应使 workflow 红）
          2 = 检查自身失败（python 依赖缺失/参数错误/API 失败且非 token 问题）——fail-closed
  @degraded 无: API 失败一律 exit 2（不静默），唯一放行路径是「无 token」且显式打印 notice

坐标系字段（7→3 缩水前的现行 7 字段，POST_FIELDS）:
  执行态 / 施工批次 / 服务承重件 / 总闸 / 命名空间 / 验证级别 / 阻塞源
"""
import json
import os
import re
import subprocess
import sys

FIELDS = ["执行态", "施工批次", "服务承重件", "总闸", "命名空间", "验证级别", "阻塞源"]
ORG = os.environ.get("SYNO_ORG", "synova-agent")
PROJECT_NUMBER = int(os.environ.get("SYNO_PROJECT_NUMBER", "1"))


def parse_coords(body: str) -> dict:
    """从 issue 正文解析【坐标系】块的字段值。返回 {字段: 值}（缺失字段不出现）。"""
    m = re.search(r"【坐标系】(.*?)(?:\n\s*\n|\Z)", body or "", re.S)
    if not m:
        return {}
    got = {}
    for line in m.group(1).splitlines():
        mm = re.match(r"\s*(" + "|".join(map(re.escape, FIELDS)) + r")\s*[:：]\s*(\S.*)", line)
        if mm:
            got[mm.group(1)] = mm.group(2).strip().split()[0].rstrip("｜|")
    return got


def q_field_by_name() -> str:
    """D1216: 按字段名查 field id 的查询（D1210 修复后唯一来源）。

    提取为独立函数的目的：让夹具能**直接构造**该 query 并断言括号平衡 ——
    2026-10-07 的事故（5 个 `{` 只 4 个 `}`）正是因为没有可调用的构造点，
    静态 grep 与运行期用例都抓不到。
    """
    return ("query($org:String!,$num:Int!,$name:String!){organization(login:$org){"
            "projectV2(number:$num){field(name:$name){... on ProjectV2Field{id}}}}}")


def assert_query_balanced(q: str) -> None:
    """契约定理：query 字面量括号必须平衡（不平衡 ⇒ GraphQL 解析失败 ⇒ 每轮 CI 必红）。"""
    if q.count("{") != q.count("}"):
        raise ValueError(f"GraphQL query 括号不平衡: {{={q.count('{')} }}={q.count('}')}")


def gh_graphql(query: str, **vars_):
    """调用 gh api graphql。失败抛 RuntimeError（调用方 fail-closed）。

    D1207: 前置检查 gh 可用 + 认证态（GH_TOKEN/GITHUB_TOKEN）——否则错误信息会指向
    GraphQL 语法，实际根因是「未认证」，排障成本极高（2026-10-07 全仓红事故即此）。
    """
    if not (os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")):
        raise RuntimeError("gh 认证缺失: 需 GH_TOKEN 或 GITHUB_TOKEN（仅设 PROJECT_TOKEN 不足以让 gh 认证）")
    args = ["gh", "api", "graphql", "-f", f"query={query}"]
    for k, v in vars_.items():
        args += (["-F", f"{k}={v}"] if isinstance(v, int) else ["-f", f"{k}={v}"])
    p = subprocess.run(args, capture_output=True, text=True, timeout=60)
    if p.returncode != 0:
        raise RuntimeError(f"gh graphql 失败: {p.stderr.strip()[:300]}")
    return json.loads(p.stdout or "{}")


def main(argv):
    from_body = None
    dry = False
    i = 0
    while i < len(argv):
        if argv[i] == "--from-body":
            i += 1
            from_body = argv[i]
        elif argv[i] == "--dry-run":
            dry = True
        else:
            print(f"❌ 未知参数 {argv[i]}", file=sys.stderr)
            return 2
        i += 1

    if from_body:
        with open(from_body, encoding="utf-8") as f:
            body = f.read()
        number = os.environ.get("ISSUE_NUMBER", "0")
    else:
        body = os.environ.get("ISSUE_BODY", "")
        number = os.environ.get("ISSUE_NUMBER", "")

    coords = parse_coords(body)
    missing = [f for f in FIELDS if f not in coords]
    print(f"issue=#{number or '?'} 解析={len(coords)}/{len(FIELDS)} 字段"
          + (f" 缺={('、'.join(missing))}" if missing else " 全齐"))
    if missing:
        print(f"::warning title=project-coordinates::坐标系块缺字段: {'、'.join(missing)}（只写已有字段）")

    if not coords:
        print("::notice title=project-coordinates::正文无【坐标系】块——无字段可写（不红）")
        return 0

    token = os.environ.get("PROJECT_TOKEN", "")
    if not token:
        print("::notice title=project-coordinates::PROJECT_TOKEN 未配置——跳过挂板/灌坐标（不红；配置由创始人裁，卡 #991）")
        return 0
    if dry:
        print("dry-run: 将写入 " + json.dumps(coords, ensure_ascii=False))
        return 0
    try:
        q_proj = ("query($org:String!,$num:Int!){organization(login:$org){projectV2(number:$num){"
                  "id items(first:100){nodes{id content{... on Issue{number}}}}}}}")
        data = gh_graphql(q_proj, org=ORG, num=PROJECT_NUMBER)
        proj = data["data"]["organization"]["projectV2"]
        pid, items = proj["id"], proj["items"]["nodes"]
        item_id = next((n["id"] for n in items if (n.get("content") or {}).get("number") == int(number or 0)), None)
        if not item_id:
            m_add = ("mutation($pid:ID!,$cid:ID!){addProjectV2ItemById(input:{projectId:$pid,contentId:$cid})"
                     "{item{id}}}")
            issue_id = gh_graphql("query($org:String!,$num:Int!){organization(login:$org){"
                                  "repository(name:\"SynovaAgent\"){issue(number:$num){id}}}}",
                                  org=ORG, num=int(number))["data"]["organization"]["repository"]["issue"]["id"]
            item_id = gh_graphql(m_add, pid=pid, cid=issue_id)["data"]["addProjectV2ItemById"]["item"]["id"]
            print(f"  ✓ 已挂板 item={item_id[:12]}…")
        for name, val in coords.items():
            # D1216 修复: ① 原串 5 个 `{` 只 4 个 `}` ⇒ GraphQL 解析失败
            #   (`Expected NAME, actual: (none) at [1,124]`)，CI 每轮必红；
            #   ② 改用查询变量传字段名（不再字符串插值）⇒ 规避引号/非 ASCII 转义面。
            q_f = q_field_by_name()
            assert_query_balanced(q_f)
            try:
                fid = gh_graphql(q_f, org=ORG, num=PROJECT_NUMBER, name=name)[
                    "data"]["organization"]["projectV2"]["field"]["id"]
            except (KeyError, TypeError):
                print(f"  ⚠ 字段 {name} 不存在于 Project#{PROJECT_NUMBER}（跳过）")
                continue
            m_up = ("mutation($pid:ID!,$iid:ID!,$fid:ID!,$val:String!){"
                    "updateProjectV2ItemFieldValue(input:{projectId:$pid,itemId:$iid,fieldId:$fid,"
                    "value:{text:$val}}){projectV2Item{id}}}")
            # D1216: 字段类型不匹配（如单选字段收到 text 值）属**看板配置面**，
            # 不是脚本缺陷 ⇒ 只告警不红，避免把每个 issue 事件都染成 CI 红基线。
            try:
                gh_graphql(m_up, pid=pid, iid=item_id, fid=fid, val=val)
                print(f"  ✓ {name} = {val}")
            except RuntimeError as e:
                # D1216 收窄（verifier R1/P3）: 只吞「看板配置面」类错误（字段类型不匹配/节点不存在），
                # 其余（API 故障/权限失效/传输失败）re-raise ⇒ 交顶层 fail-closed（exit 2）。
                if not re.search(r"does not accept|Cannot coerce|Could not resolve to a node", str(e)):
                    raise
                print(f"::warning title=project-coordinates::字段 {name} 写入失败（看板配置面，非脚本缺陷）: {e}")
        print("✅ 坐标系同步完成")
        return 0
    except Exception as e:  # noqa: BLE001 — 顶层统一 fail-closed（exit 2，不静默）
        print(f"❌ 同步失败: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
