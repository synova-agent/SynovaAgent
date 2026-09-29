# CT3 证据 — L-CR：`.gitattributes:23` 裸 CR 清除（零逻辑变更）

> 成员: gate-fix ｜ 任务: task-3 ｜ 分支: `fix/ct-win-gitattributes-20260927`
> 工作树: `/Users/wane/SynovaAgent/.synova-wt-ct-win`（唯一写入点；主树零写入）
> 被改文件（1）: `.gitattributes`
> md5: 改前 `ba3212e9e79b2eab676bf24644426bc0`（1935 字节） → 改后 `654f19923d66d249669652eb76d1ab8a`（1934 字节）
> 所有数字/输出均为命令原始输出，未手写。

---

## 一、前提复核（队长前提冻结的再实测——全部成立）

```
$ file .gitattributes
.gitattributes: Unicode text, UTF-8 text, with CR, LF line terminators

$ python3 -c "（字节级统计）"
CR 总字节数 = 1
LF 总字节数 = 32
CR 在行尾(CRLF)个数 = 0
裸 CR(非 CRLF)个数 = 1
第 23 行 第 28 列 有裸 CR；行内容(CR 显示为 <CR>): # CRLF 导致 bash 全线 "<CR>: command not found"（双平台 CI 必备）
$ wc -l .gitattributes
      32 .gitattributes
```

⇒ 与前提冻结完全一致：**第 23 行、第 28 列、行中（非行尾）、全文件仅 1 个裸 CR、32 行**。

---

## 二、卡面五条判据（逐条原始输出）

### 判据① 改前：`perl -ne 'print "$.:$_\n" if /\r/'` 必须输出该行

**（a）卡面原命令原样输出**（TERM 会把 CR 渲染成回车，故同时给 (b) 的显式渲染）：

```
$ perl -ne 'print "$.:$_\n" if /\r/' .gitattributes
23:# CRLF 导致 bash 全线 ": command not found"（双平台 CI 必备）
```

**（b）`cat -v` 显式渲染**（`^M` = CR，位置在双引号之后、冒号之前 —— 与"第 28 列、行中"吻合）：

```
$ git show HEAD:.gitattributes | perl -ne 'print "$.:$_"' | sed -n '23p' | cat -v
23:# CRLF M-eM-/M-<M-hM-^GM-4 bash M-eM-^EM-(M-gM-:M-? "^M: command not found"M-oM-<M-^HM-eM-^OM-^LM-eM-^EM-(M-gM-:M-? CI M-eM-?M-^EM-eM-$M-^GM-oM-<M-^I
```

**（c）字节级定位**（可核，非目测）：

```
$ git show HEAD:.gitattributes | python3 -c "（字节定位）"
裸 CR 在字节 offset 1473（1-based 1474）；删前总字节 1935
CR 上下文 24 字节: b'ash \xe5\x85\xa8\xe7\xba\xbf "\r: command n'
```

### 判据② 改后：同一命令必须**零输出**

```
$ perl -ne 'print "$.:$_\n" if /\r/' .gitattributes
（零输出）
$ perl -ne 'print "$.:$_"' .gitattributes | grep -c $'\r'
0
```

### 判据③ `git diff --stat`

```
$ git diff --stat
 .gitattributes | 2 +-
 1 file changed, 1 insertion(+), 1 deletion(-)
```

### 判据④ `git diff --numstat` 增删对称（证明只动 1 行）

```
$ git diff --numstat
1	1	.gitattributes
```

### 判据⑤ 权限位不得变化（`git diff --summary` 无 mode change）

```
$ git diff --summary
（无输出）
```

补充：`git diff` 的 `index` 行 `a68f3c8e..19a444f8 100644` —— 前后同为 `100644`。

---

## 三、零逻辑变更的**字节级**证明（比 --stat 更强）

```
$ python3 -c "（逐字节对照 git HEAD 版本）"
改前 1935 字节 / 改后 1934 字节 → 差 1 字节
去掉所有 CR 后是否逐字节相等: True
差异区窗口 old: b'\xe7\xba\xbf "\r: comm'
差异区窗口 new: b'\xe7\xba\xbf ": comma'
唯一差异 = 删除 1 个 \r: True
```

```
$ git diff -- .gitattributes | cat -v | sed -n '5,8p'
-# CRLF M-eM-/M-<M-hM-^GM-4 bash M-eM-^EM-(M-gM-:M-? "^M: command not found"M-oM-<M-^HM-eM-^EM-(M-gM-:M-? CI M-eM-?M-^EM-eM-$M-^GM-oM-<M-^I
+# CRLF M-eM-/M-<M-hM-^GM-4 bash M-eM-^EM-(M-gM-:M-? ": command not found"M-oM-<M-^HM-eM-^EM-(M-gM-:M-? CI M-eM-?M-^EM-eM-$M-^GM-oM-<M-^I
```

⇒ diff 只有这一行；该行唯一变化是删掉 1 个 `\r`；**未重排/未转换行尾/未动其它任何行**。

---

## 四、保留项复核（禁动项）

`.claude/bypass.log merge=union`（D457 / CT-47 在用）**原封未动**：

```
$ grep -n 'bypass.log' .gitattributes
8:# CT-47 / D457: bypass.log append-only 证据日志 — merge=union 自动保留双方
9:# 背景: 每个 session 的 synova-commit 都往 bypass.log 追加一行证据，多 PR 并发合并时
14:.claude/bypass.log merge=union
18:#       冲突（Win 实测 6+ 次）。与 bypass.log（D457）同型：每行含唯一符号+行号不会重复，
```

---

## 五、域归属（独立 win 域 PR 的理由）

`.gitattributes` 归属 **win** 域（owner=win），本批其余文件（`scripts/control-tower/**`、
`tests/control-tower/**`）全是 **mac** 域 ⇒ 混在一起会触发 D734 跨域判红。
故本卡独立成 **win 域 PR**（分支 `fix/ct-win-gitattributes-20260927`，与 mac 域分支分开）。

---

## 六、自验结论

- 判据①（改前必须输出第 23 行）：**成立**（原命令 + `cat -v` + 字节级定位三份原始输出）。
- 判据②（改后必须零输出）：**成立**。
- 判据③（`1 file changed, 1 insertion(+), 1 deletion(-)`）：**成立**。
- 判据④（numstat 增删对称 `1 1`）：**成立**。
- 判据⑤（无 mode change）：**成立**（`--summary` 零输出 + index 行前后同为 `100644`）。
- 附加：字节级证明"唯一差异 = 删除 1 个 `\r`"，其余 1934 字节逐字节相同。
- 禁动项 `.claude/bypass.log merge=union` 完好。

**自验结论: 可提请独立审计**（不构成审计通过；审计权归 K3，合并闸归 CTO）。

---

## 七、遗留清单（不属本卡 / 未做）

1. 本卡**只删 1 个字节**，不做任何 CRLF 全局归一（其它文件是否存在同类裸 CR 不在本卡写集；
   如需全仓扫描应另立卡）。
2. `.gitattributes` 的规则语义（`*.sh text eol=lf` 等）零改动。
3. 本分支另含 task-6（CT-LM2，`/private/tmp/wt-ci` 工作树清理）—— 证据前缀 `CT3-LM2-`，
   与 win 域同批但不同交付。
