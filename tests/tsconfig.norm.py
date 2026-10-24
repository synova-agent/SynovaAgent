#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""tests/tsconfig.norm.py —— tsc 错误行的**工作区路径归一**（#840 E-4 · F4）

为什么是独立文件而不是 workflow 内联：归一正则含引号/反斜杠，内联到 YAML↔bash↔python 三层引号里
必然踩转义（实测：BSD sed 不支持非贪婪 `*?` ⇒ RE error；bash 内联 python 的 `[^\\"]` 被多压一层 ⇒
字符类变成"不含 s" ⇒ 匹配不到 `.synova-wt-*` 路径）。独立文件后规则只有一处，本机与 CI 同式。

用法: python3 tests/tsconfig.norm.py < in > out
"""
import re
import sys

# 把任意 `/Users/<...>/<repo>(/<worktree>)/` 前缀归一成仓库相对路径。
# 只剥到 `src|tests|packages|scripts|node_modules` 这一段之前（这些是 tsc 输出里会出现的根）。
PAT = re.compile(r"/Users/[^\"]*?/(?=(?:src|tests|packages|scripts|node_modules)/)")


def main() -> int:
    data = sys.stdin.read()
    sys.stdout.write(PAT.sub("", data))
    return 0


if __name__ == "__main__":
    sys.exit(main())
