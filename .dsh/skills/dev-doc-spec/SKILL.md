---
name: dev-doc-spec
description: 活规格撰写v3（并入4件）：9 问前置＋9节必填＋3条件＋派单与开工令＋6字段brief附录＋编码 session 指令。读者＝零上下文小队。触发：L1交批次给squad-lead／跨层／新子系统。
whenToUse: 写dev doc、派单件、开工令、task brief、编码指令时加载；L1动笔前必读。
---

# dev-doc-spec—活规格撰写（v3）

🔴唯一判据：零上下文小队只读本doc，不提问就能开工并自证完成。动笔前先跑9问（§0），产物＝前八节；不跑就写＝抄格式。

## 0 · 9 问前置（原pre-plan-thinking，顺序不可跳）
每问留证据才动笔；答不出⇒补调研/缩范围；仍答不出⇒§7写「未决：<问题>，需<谁>回答」。证据输出落盘（不放/tmp）＋引路径。
①问题（谁/场景/不做怎样）证据＝原话·日志·数据；只喊「明显bug」＝不算⇒§1
②现状（怎么跑/谁调用/波及谁）证据＝grep调用链＋跑一遍输出＋file:line⇒§3
③现成的？<能力>|grep命令|命中N|复用/扩展/确需新建(为何不能复用)；必查清单见§2§6；「应该没有」＝不算⇒§6
④最小改动（必须改vs不必要，后者划掉YAGNI；顺手重构不同批）⇒§2
⑤最危险假设（1–3个先实测；「我觉得没人调用」必须grep）⇒§3＋§7
⑥失败路径（先写反例「改坏X⇒必红」＋命令＋期望；只写正常路径＝没判据）⇒§4
⑦边界（逐条列路径，必含scripts/audit/**）⇒§1
⑧可观测（哪条命令/数字证明；「应该没问题」＝不算）⇒§4
⑨拆步（2–3步＋验证点＋回滚；一次500行不可回滚）⇒封面＋§8

## 1 · 封面：四行开场包（放最顶部）
```
① 批次名：<例：P4-A 类第 1 条>
② 写集（逐文件，L1 划，L2 不得扩）：- <path>（改什么）
③ 判据（含「改坏必红」）：命令 <…> 期望 <…>；反例 <改坏 X ⇒ 必红，命令＋期望输出>
④ 域守则指针（必须显式 read）：<path/AGENTS.md>
```
front-matter：id／status（流程定，禁自宣）／北星（供K3）／批次规模。

## 2 · 9 节必填（逐节非空，缺节退回）
§1 做什么：目标一句＋可观测结果；非目标逐条列路径（L2不许碰），必含scripts/audit/**。
§2 在哪做：🔴给file:line（改哪一行/函数）'- <path>:<line> — <改什么>'；写集逐文件、两两不重叠、机器块对齐scripts/control-tower/brief_parser.py；新建标<新建>＋父目录。
§3 凭什么做：每条前提-<前提> | <命令> | <原始输出摘要>；禁「我认为」；不成立⇒停退回L1。
§4 怎么算做完：正常（命令＋期望）/降级（触发条件＋degraded:）/🔴反例（改坏什么⇒必红）——没有反例＝没判据；DS逐条可核验。
§5 怎么跑：git fetch gitea→git worktree add .synova-wt-<批次>-$(date +%m%d) -B ct/<批次> gitea/local-main；依赖；运行＋端口（PORT=18790，3000被Gitea占）；环境（node版本；长任务用后台job）；证据落盘<路径>（不放/tmp）；自检一条「环境对」命令。
§6 有什么基础（禁重复建设）：逐条<能力>|grep命令|命中N|复用/扩展/确需新建(为何不能复用)；必查scripts/control-tower/（136件）/doc-system·workflow·integration/skill/既有约定。🔴四个必须复用：三态退出码（0/1/2，2=环境失败）/@降级＋SYNO_GATE_DEGRADED_LOG/UTF-8强制（D732）/判别力自检。确需新建未说明⇒退回。
§7 前置与红线：-<前置> | 判据 | 未满足则停；禁碰scripts/audit/**（K3）/禁改别人写集/禁git stash/不在主树写码。
§8 交什么：回执三信号（判据通过率/例外清单/在飞数）；R2 ≤10行（批次名｜写集｜自验结论｜证据｜未决项）；证据存<路径>，禁手写数字；🔴不判「通过」：只给自验结论/可提请独立复核/退回。
§9 出生证G1–G6（缺一⇒L1不收；判据只引docs/authority/quality-standard-g1g6.md）：G1可达生产调用点file:line＋WIRING｜G2不静默失败可见化＋三态实测｜G3有判据用例＋改坏两态输出｜G4边界入参校验＋timeout/signal｜G5状态三探针｜G6一致三门禁汇总＋未登记清单。

## 3 · 条件节（不适用显式写「不适用」）
C1契约（接口/脚本/新模块）：输入/输出/降级/错误码（铁律47）｜C2边界值：空/单元素/恰临界/超限/零/负值｜C3失效条件（新规则/门禁/契约）：何时可撤——无失效条件的规则不许进仓库。

## 4 · 启用＋独立性
启用（任一）：①交squad-lead：待办≥2件或单件>300行/>5文件（硬要求）②跨层③新子系统/新产品线④超预算（>12文件或>2天）；不满足⇒写进包守则/派单件。
独立性：撰写者不得实现该规格；规格先落main可读，L2不得引用未落main路径。

## 5 · 验收（写完自检）
```bash
bash scripts/workflow/check-brief-parseable.sh <brief>
bash scripts/control-tower/pre-dispatch-check.sh <规格件>
bash scripts/workflow/check-dev-doc-write-set.sh
```
④代码标准按dsh-code-standards（8项＋4必复用），缺则L1不收。

## 6 · 派单与开工令（原line-fork-dispatch）
派/不派：派＝机械重复/需长上下文多轮/与CTO异域；不派＝只CTO能裁（判据/优先级/跨线冲突）/动红线件（施工项登记.ts，CTO自做或书面授权代笔）/一句话能说清。派谁：按「面」命名（K3面⇒K3专线；一专线＝一面≠一任务）；跨面⇒一次性任务组；续用＝上轮已验收＋复用其工具（复用>重建）；新开＝已收口归档/方法论不同/上轮上下文已满。
派单件七段（落handbook派单件/）：抬头（派出方/执行方/日期/裁定号；🔴基准＝gitea/local-main＋as_of sha＋重锚git ls-remote gitea refs/heads/local-main＋「不要核main」）｜一人话｜二做法｜三判据（命令＋期望；可复跑；三态0/1/2）｜四停止条件（计划外的红/冲突/越范围/动红线⇒不自决）｜五边界＋工具坑（gh 403走Gitea API；中文路径-c core.quotepath=false）｜六回执（head sha＋CI/逐项/原始输出/未核处/红线自检）｜七状态。
开工令（同回复给出，创始人转发）：〇拉任务书（Mac http://127.0.0.1:3000/synova/synova-handbook.git，Win换192.168.1.7）｜一身份边界（分叉专线产出＝结论件落批次收口/_分叉/；不派工/不改卡/不改门禁/不落产品仓；带「未经主线核」＋as_of）｜二–四是什么/要做的/判据＋停止｜五边界＋通道（禁--no-verify/--force；开工先git fetch核远端local-main）｜六首交付＝方案骨架停下等放行（纯机械件免停）｜七回执。
边界红线：❌不改根件AGENTS.md（除明确授权）｜❌不动docs/synova/coordination/施工项登记.ts｜❌不碰scripts/audit/**｜❌不改ci.yml job name｜❌不动MAX_FILES｜通道D334（git merge gitea/<branch>，不改hash、bypass不裂）/D331（.claude/bypass.log追加<ISO> | COMMITTED | pre-commit PASS (<理由>) | HASH=<完整sha>）｜🔴严禁--no-verify；严禁--force（只用--force-with-lease）。

## 7 · 6 字段brief附录（原brief-compose；机检仍由pre-commit组6守）
载体：#932起认领件走.claude/claims/<issue>.yaml（writeset＋done，裁310/326）；6字段仅适用legacy brief；在clone内写（主工作区禁写码；clone 5步见git-sync-pr）。
格式：① 6 个 ## 标题冒号紧跟Q编号（## Q0:非全角）：Q0/Q1/Q2/Q3/架构层/Done标准② #CRITERIA: A 必填③ Q2 include每文件一行 '- <路径>' ④ Q2 exclude每行-不改<路径>、第一token带扩展名（❌ -不改src/任何文件；✅ -不改tests/control-tower/test-session-registry.py）⑤架构层写##架构层:基础设施或L1-L5 ⑥ Done ≥1 条 bash 物理可验⑦禁<!--模板残留⑧ Q2路径避全角括号紧贴。
Q2口径（#1308）：✅裸路径- scripts/control-tower/brief_parser.py（动词前缀/说明/行号可留）；❌反引号/尾随说明/通配符*.sh/全角／⇒认领恒0；自检python3 scripts/control-tower/brief_parser.py --q2-include<brief>，stderr Q2-PARSE-WARN:即不可匹配。
矛盾/收尾：include与exclude不得同文件（D314）；暂存前确认在include里；.claude/current-brief写完整名；无扩展名运行时件（bypass.log）不进exclude；排除项＝承诺不改，暂存绝不能出现。
验证链：bash scripts/check-plan-integrity.sh→bash scripts/workflow/check-brief-parseable.sh<brief>→bash scripts/pre-commit-check.sh（D317：parseable过≠门禁全过）。交前五步：ls .claude/claims/*.yaml|wc -l＝1（否则merge-writeset-gate exit 2）／grep -c '<具体文件路径'<brief>＝0／「做什么」每行[ -e ]真（说明移段末）／「不做什么」带扩展名／git diff --name-only origin/main...HEAD全覆盖（易漏bypass.log·brief·task-state·Note）。commit message必带任务号（未声明＝认领解析失败；不一致＝疑似并行劫持；均exit 1）；brief禁追加「原brief全文」（G12b）。

## 8 · 编码 session 指令（原dev-doc-delivery）
🔴三件套：spec＋task-state回填＋编码指令，缺一＝交付不完整。模板与七段：.synova/skills/dev-doc-spec/template/编码指令模板.md（七段：任务文档表/执行要求/硬约束/复核清单/审计提示/「开始吧。」/模板要点）。
硬约束：基线核验git fetch --all && git pull --ff-only＋重核spec行号（M7/D524）；写集git diff --name-only与spec一致；诚实 RED ⏸/❌＋理由（禁伪造绿）；evidence可独立重跑；不碰scripts/audit/**；最高水平（as any=0 铁律 38／契约JSDoc 47／降级24+31／测试非空壳48）；复核含接线grep、39·46、verify、vitest、pre-commit禁--no-verify、禁git stash。
落盘docs/synova/coordination/编码指令-<任务>-<YYYYMMDD>.md；汇报给全文＋路径。

## 9 · 红线·状态不得自宣
status:由流程定（proposed→K3＋CTO收件闸→implemented），撰写者不得自宣；未过审计写implemented＝违规；凭据可查，禁只写「创始人批准」。
交稿前置：写完≠交付，必须过.synova/skills/devdoc-gate-a/SKILL.md六镜头评审，未过不许开L2。
