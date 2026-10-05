# Synova CTO 健康仪表盘（第③面）

> 打开即真相。生成: 2026-09-26 05:25:49 | 数据源指纹: b7d83388f276

<!-- CTO-HEALTH:AUTO:START -->
## CTO 健康仪表盘（第③面）— 自动区
> 生成: 2026-09-26 05:25:45 | 数据源: bypass.log / pre-commit-failures.log / AUDIT-FINDINGS-LEDGER

**总体判定: 🔴 红 — 24h 内有绕过 (detected-bypass), 防线被击穿, 升级创始人**

### 一、门禁执行（bypass.log 全历史）

| 事件 | 全量 | 24h 内 |
|------|:---:|:---:|
| COMMITTED（正常提交） | 1482 | 108 |
| BLOCKED（被门禁拒绝） | 168 | 4 |
| DEGRADED（降级放行） | 52 | 0 |
| TIMEOUT（超时） | 3 | 0 |
| **detected-bypass（真绕过）** | **22** | **2** |

近 7 天事件: 2026-09-20:28 | 2026-09-21:5 | 2026-09-22:19 | 2026-09-23:35 | 2026-09-24:66 | 2026-09-25:97 | 2026-09-26:43

**绕过历史（全部）** — 集中在 07-26~28（旧 marker 时代），此后零绕过：
- `2026-07-26T18:34:35Z` no-precommit-marker
- `2026-07-26T19:11:26Z` no-precommit-marker
- `2026-07-26T19:20:27Z` no-precommit-marker
- `2026-07-27T21:54:30Z` no-precommit-marker
- `2026-07-28T14:59:07Z` no-precommit-marker
- `2026-08-22T07:59:08Z` head-mismatch marker=eff66bf8513adb435545cbabd373a5fd14efc409 parent=214ac7f27d0cd00b2f8380f7c60ae720dfe4121c
- `2026-08-24T07:37:00Z` no-precommit-marker
- `2026-08-24T07:54:06Z` no-precommit-marker
- `2026-08-25T12:21:35Z` no-precommit-marker
- `2026-08-29T19:33:16Z` head-mismatch marker=020443b663efba3a9052a0650860c10b56b5ad60 parent=9b2e7cff32310e18e89ae3c67580d84a993b6e79
- `2026-09-04T16:01:40Z` head-mismatch marker=14d0d4c3c1f0a75ed5e7c6bfa13b4ac2ab185c85 parent=a352f67893fb454eebccbd768a740553a715673a
- `2026-09-05T19:35:31Z` head-mismatch marker=68e3acdbc5326758f0e064ab017bc45dc9091dcc parent=cf24a250474e156c2d6ec93bf725c51b99a41a24
- `2026-09-08T15:23:41Z` no-precommit-marker
- `2026-09-08T15:20:28Z` head-mismatch marker=a1604eee99a810486c2a521f10b253c5c60bc504 parent=95e1c9fa5b192cb2bae1c35cf505dc8cc353eb2f
- `2026-09-10T02:24:35Z` head-mismatch marker=c30d1b2091f8d18a51fb77033eea29c17dd1c90e parent=b6794022404819dc986bd7a2a2a261f8267943cc
- `2026-09-17T07:29:03Z` head-mismatch marker=6d1f262eed072710df7e135600be58af24a63573 parent=0f59e514838568f35cb2516eec79d40e5e0c1c33
- `2026-09-17T07:29:03Z` head-mismatch marker=6d1f262eed072710df7e135600be58af24a63573 parent=aa6fa444e7c669e3a9c17e3187c32a5319025a3a
- `2026-09-17T16:50:51Z` head-mismatch marker=a94c42472c589588b9996e591c25c1f2b4c828de parent=50d8a3d9453a5bedf93ebe846be6f5e86221dbaa
- `2026-09-17T16:50:51Z` head-mismatch marker=a94c42472c589588b9996e591c25c1f2b4c828de parent=50d8a3d9453a5bedf93ebe846be6f5e86221dbaa
- `2026-09-24T20:21:11Z` head-mismatch marker=114e129e7ae2d9888d3c9a719391de8c39a756c1 parent=da6a42f4150393c225ff6303541cf9a4e55964b2
- `2026-09-25T05:05:54Z` head-mismatch marker=0fd44b7689c1a8870a8bc7a4394e53120061bf4b parent=519edadf83642b517b415cce52927a02b120b865
- `2026-09-25T00:56:43Z` head-mismatch marker=ce5b13b96c9b0b5b40ff065da7f1361bd6996a72 parent=2b38d1779aa31caf553ef481eb6f2e5479a3199c

### 二、门禁拒绝（pre-commit-failures.log）

- 累计拒绝: **3** 次 | 最近: 2026-09-25
- 阈值: >10 次/24h → 门禁过激警告（健康审计项）

### 三、M 模式复发（AUDIT-FINDINGS-LEDGER §二）

| 模式 | 名称 | 首次 | 再次 |
|------|------|------|------|
| M1 | **fail-open 静默失效**（检查未执行==检查通过） | D328 P1-1 | D329 P2-5（`\|\| true`） |
| M2 | **声称 vs 事实**（doc/报告 overclaim） | D328 P1-2 | D329 P2-1（task_id）、Mac ba653c3（零引用声称） |
| M4 | **执行证据链断裂**（bypass.log） | D328 P1-3 | D329 P1-2（第二次） |
| M5 | **环境依赖门禁**（python3/broken shim） | D328 P1-1 | D329 P2-5 |

> ⚠️ 复发 = 同类错误第二次出现 = 防线系统性失效，按红线升级创始人。

### 四、CT 改进队列（台账 §三）

- ✅ 已完成 7 · 🔄 进行中 35 · ⏳ 未排 7

### 五、任务状态汇总（task-state/，D382）

| 任务 | 状态 | spec | impl | audit | FIX |
|------|------|:---:|:---:|:---:|------|
| D1007 | impl_done | ✅ | ✅ | — |  |
| D356 | audited | ✅ | ✅ | CONDITIONAL_PASS |  |
| D379 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D383 | audited | — | ✅ | CONDITIONAL_PASS | D384 |
| D384 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D385 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D386 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D387 | audited | ✅ | ✅ | CONDITIONAL_PASS | CT-P1-1 |
| D389 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D390 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D391 | audited | — | ✅ | CONDITIONAL_PASS | D402 |
| D392 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D393 | audited | — | ✅ | PASS | D399 |
| D394 | audited | ✅ | ✅ | CONDITIONAL_PASS |  |
| D395 | audited | ✅ | ✅ | CONDITIONAL_PASS | D406 |
| D396 | audited | ✅ | ✅ | PASS |  |
| D397 | audited | — | — | CONDITIONAL_PASS |  |
| D398 | audited | — | — | CONDITIONAL_PASS |  |
| D399 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D400 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D401 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D402 | audited | ✅ | ✅ | CONDITIONAL_PASS |  |
| D403 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D404 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D405 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D406 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D407 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D408 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D409 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D410 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D411 | impl_done | — | ✅ | — | zombie-cancelled |
| D412 | audited | — | ✅ | PASS |  |
| D413 | audited | — | ✅ | PASS |  |
| D414 | audited | — | ✅ | PASS |  |
| D415 | audited | — | ✅ | PASS |  |
| D416 | impl_done | — | ✅ | — |  |
| D417 | impl_done | — | ✅ | — |  |
| D419 | audited | — | ✅ | PASS |  |
| D428 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D429 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D430 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D439 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D440 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D441 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D442 | audited | — | ✅ | PASS | D453 |
| D443 | audited | — | ✅ | PASS |  |
| D444 | audited | — | ✅ | PASS |  |
| D445 | audited | ✅ | ✅ | PASS |  |
| D446 | audited | — | ✅ | PASS |  |
| D447 | audited | — | — | PASS |  |
| D448 | audited | — | — | PASS |  |
| D449 | audited | — | — | PASS |  |
| D450 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D451 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D452 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D453 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D454 | audited | — | ✅ | PASS |  |
| D455 | audited | — | ✅ | PASS |  |
| D456 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D457 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D458 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D459 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D460 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D461 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D462 | audited | — | ✅ | PASS |  |
| D463 | audited | — | ✅ | PASS |  |
| D464 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D465 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D466 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D467 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D468 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D472 | audited | ✅ | ✅ | CONDITIONAL_PASS |  |
| D473 | audited | ✅ | ✅ | CONDITIONAL_PASS |  |
| D474 | audited | ✅ | ✅ | CONDITIONAL_PASS |  |
| D483 | audited | ✅ | ✅ | CONDITIONAL_PASS |  |
| D484 | audited | ✅ | ✅ | CONDITIONAL_PASS |  |
| D485 | impl_done | ✅ | ✅ | — |  |
| D486 | audited | ✅ | ✅ | CONDITIONAL_PASS |  |
| D487 | audited | ✅ | ✅ | CONDITIONAL_PASS |  |
| D488 | impl_done | ✅ | ✅ | — |  |
| D489 | audited | ✅ | ✅ | CONDITIONAL_PASS |  |
| D490 | impl_done | ✅ | ✅ | — |  |
| D491 | impl_done | ✅ | ✅ | — |  |
| D492 | impl_done | ✅ | ✅ | — |  |
| D500 | audited | ✅ | ✅ | CONDITIONAL_PASS |  |
| D501 | audited | ✅ | ✅ | CONDITIONAL_PASS |  |
| D502 | audited | ✅ | ✅ | CONDITIONAL_PASS |  |
| D503 | audited | ✅ | ✅ | CONDITIONAL_PASS |  |
| D504 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D505 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D507 | impl_done | — | ✅ | — | superseded-by-D539-D540 |
| D508 | audited | ✅ | ✅ | CONDITIONAL_PASS |  |
| D509 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D510 | impl_done | — | ✅ | — | D514 |
| D511 | impl_done | — | ✅ | — | zombie-cancelled |
| D512 | impl_done | — | ✅ | — | zombie-cancelled |
| D513 | audited | ✅ | ✅ | CONDITIONAL_PASS |  |
| D514 | impl_done | — | ✅ | — |  |
| D515 | audited | ✅ | ✅ | CONDITIONAL_PASS | D516 |
| D516 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D517 | audited | ✅ | ✅ | CONDITIONAL_PASS |  |
| D518 | audited | ✅ | ✅ | CONDITIONAL_PASS |  |
| D519 | audited | ✅ | ✅ | CONDITIONAL_PASS |  |
| D520 | audited | ✅ | ✅ | CONDITIONAL_PASS |  |
| D521 | audited | ✅ | ✅ | CONDITIONAL_PASS |  |
| D522 | audited | ✅ | ✅ | CONDITIONAL_PASS |  |
| D523 | audited | ✅ | ✅ | CONDITIONAL_PASS |  |
| D524 | audited | ✅ | ✅ | CONDITIONAL_PASS | D518 |
| D525 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D526 | audited | — | — | CONDITIONAL_PASS |  |
| D527 | audited | ✅ | ✅ | PASS |  |
| D528 | audited | ✅ | ✅ | PASS |  |
| D529 | impl_done | — | ✅ | — | superseded-by-D517 |
| D530 | impl_done | — | ✅ | — |  |
| D531 | impl_done | — | ✅ | — |  |
| D532 | impl_done | — | ✅ | — |  |
| D533 | impl_done | ✅ | ✅ | — |  |
| D534 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D535 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D536 | impl_done | ✅ | ✅ | — |  |
| D537 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D538 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D539 | impl_done | ✅ | ✅ | — |  |
| D540 | audited | ✅ | ✅ | CONDITIONAL_PASS |  |
| D541 | audited | — | ✅ | CONDITIONAL_PASS | FIX-D541 |
| D542 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D543 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D544 | audited | — | ✅ | CONDITIONAL_PASS | FIX-D544 |
| D545 | impl_done | — | ✅ | — | renumber-to-D546 |
| D546 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D547 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D548 | claimed | — | — | — |  |
| D549 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D550 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D551 | audited | ✅ | ✅ | CONDITIONAL_PASS |  |
| D552 | impl_done | — | ✅ | — |  |
| D553 | impl_done | — | ✅ | — |  |
| D554 | impl_done | — | ✅ | — |  |
| D555 | impl_done | — | ✅ | — |  |
| D556 | audited | ✅ | ✅ | CONDITIONAL_PASS |  |
| D557 | impl_done | — | ✅ | — |  |
| D558 | audited | — | ✅ | PASS |  |
| D558 | impl_done | — | ✅ | — |  |
| D560 | audited | — | ✅ | PASS |  |
| D561 | audited | — | ✅ | PASS |  |
| D562 | impl_done | — | ✅ | — |  |
| D563 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D564 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D565 | impl_done | — | ✅ | — |  |
| D566 | claimed | — | — | — |  |
| D567 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D568 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D569 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D570 | impl_done | — | ✅ | — |  |
| D571 | impl_done | — | ✅ | — |  |
| D572 | audited | — | ✅ | CONDITIONAL_PASS | D578 |
| D575 | audited | ✅ | ✅ | CONDITIONAL_PASS |  |
| D576 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D577 | audited | ✅ | ✅ | CONDITIONAL_PASS |  |
| D578 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D579 | audited | ✅ | ✅ | PASS |  |
| D580 | audited | ✅ | ✅ | PASS |  |
| D581 | audited | — | ✅ | PASS |  |
| D582 | audited | — | ✅ | PASS |  |
| D583 | impl_done | — | ✅ | — |  |
| D584 | impl_done | — | ✅ | — |  |
| D586 | audited | ✅ | ✅ | CONDITIONAL_PASS |  |
| D587 | audited | ✅ | ✅ | CONDITIONAL_PASS |  |
| D588 | audited | ✅ | ✅ | CONDITIONAL_PASS | D597 |
| D589 | impl_done | — | ✅ | — |  |
| D590 | audited | ✅ | ✅ | CONDITIONAL_PASS |  |
| D591 | audited | ✅ | ✅ | CONDITIONAL_PASS |  |
| D592 | audited | ✅ | ✅ | PASS |  |
| D593 | audited | ✅ | ✅ | CONDITIONAL_PASS | fix/d593-restore |
| D594 | impl_done | ✅ | ✅ | — |  |
| D595 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D596 | claimed | — | — | — |  |
| D597 | impl_done | — | ✅ | — |  |
| D598 | spec_done | ✅ | — | — |  |
| D599 | spec_done | ✅ | — | — |  |
| D600 | spec_done | ✅ | — | — |  |
| D601 | claimed | — | — | — |  |
| D602 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D603 | impl_done | — | ✅ | — |  |
| D651 | impl_done | ✅ | ✅ | — |  |
| D660 | impl_done | — | ✅ | — |  |
| D661 | impl_done | — | ✅ | — |  |
| D663 | impl_done | — | ✅ | — |  |
| D664 | audited | — | ✅ | PASS |  |
| D665 | impl_done | ✅ | ✅ | — |  |
| D705 | impl_done | — | ✅ | — |  |
| D706 | audited | — | ✅ | PASS |  |
| D707 | audited | — | ✅ | PASS |  |
| D708 | audited | — | ✅ | PASS |  |
| D709 | impl_done | — | ✅ | — |  |
| D710 | impl_done | — | ✅ | — |  |
| D711 | impl_done | — | ✅ | — |  |
| D712 | impl_done | — | ✅ | — |  |
| D713 | impl_done | — | ✅ | — |  |
| D714 | impl_done | — | ✅ | — |  |
| D715 | audited | — | ✅ | PASS |  |
| D716 | impl_done | ✅ | ✅ | — |  |
| D717 | impl_done | — | ✅ | — |  |
| D718 | impl_done | — | ✅ | — |  |
| D719 | impl_done | — | ✅ | — |  |
| D720 | impl_done | — | ✅ | — |  |
| D721 | impl_done | — | ✅ | — |  |
| D725 | impl_done | ✅ | ✅ | — |  |
| D737 | impl_done | — | ✅ | — |  |
| D740 | impl_done | — | ✅ | — |  |
| D741 | impl_done | — | ✅ | — |  |
| D742 | claimed | — | — | — |  |
| D743 | claimed | — | — | — |  |
| D745 | claimed | — | — | — |  |
| D746 | claimed | — | — | — |  |
| D747 | impl_done | — | ✅ | — |  |
| D748 | impl_done | — | ✅ | — |  |
| D749 | impl_done | — | ✅ | — |  |
| D750 | impl_done | — | ✅ | — |  |
| D751 | impl_done | — | ✅ | — |  |
| D752 | impl_done | — | ✅ | — |  |
| D753 | claimed | — | — | — |  |
| D754 | impl_done | — | ✅ | — |  |
| D755 | impl_done | — | ✅ | — |  |
| D756 | impl_done | — | ✅ | — |  |
| D757 | impl_done | — | ✅ | — |  |
| D758 | impl_done | — | ✅ | — |  |
| D759 | impl_done | — | ✅ | — |  |
| D760 | claimed | — | — | — |  |
| D761 | claimed | — | — | — |  |
| D762 | claimed | — | — | — |  |
| D763 | claimed | — | — | — |  |
| D764 | claimed | — | — | — |  |
| D765 | claimed | — | — | — |  |
| D766 | claimed | — | — | — |  |
| D767 | claimed | — | — | — |  |
| D768 | claimed | — | — | — |  |
| D769 | claimed | — | — | — |  |
| D770 | impl_done | — | ✅ | — |  |
| D771 | impl_done | — | ✅ | — |  |
| D772 | impl_done | — | ✅ | — |  |
| D773 | impl_done | — | ✅ | — |  |
| D774 | impl_done | — | ✅ | — |  |
| D775 | claimed | — | — | — |  |
| D776 | claimed | — | — | — |  |
| D777 | impl_done | — | ✅ | — |  |
| D778 | impl_done | — | ✅ | — |  |
| D779 | impl_done | — | ✅ | — |  |
| D780 | impl_done | — | ✅ | — |  |
| D781 | claimed | — | — | — |  |
| D782 | impl_done | — | ✅ | — |  |
| D783 | claimed | — | — | — |  |
| D784 | claimed | — | — | — |  |
| D785 | claimed | — | — | — |  |
| D787 | impl_done | — | ✅ | — |  |
| D788 | impl_done | — | ✅ | — |  |
| D789 | impl_done | — | ✅ | — |  |
| D790 | impl_done | — | ✅ | — |  |
| D791 | impl_done | ✅ | ✅ | — |  |
| D792 | claimed | — | — | — |  |
| D793 | impl_done | — | ✅ | — |  |
| D794 | impl_done | — | ✅ | — |  |
| D795 | impl_done | — | ✅ | — |  |
| D796 | impl_done | — | ✅ | — |  |
| D797 | impl_done | — | ✅ | — |  |
| D798 | claimed | — | — | — |  |
| D799 | audited | — | — | PASS |  |
| D800 | claimed | — | — | — |  |
| D803 | impl_done | ✅ | ✅ | — |  |
| D806 | impl_done | — | ✅ | — |  |
| D808 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D809 | impl_done | — | ✅ | — |  |
| D810 | impl_done | — | ✅ | — |  |
| D811 | impl_done | — | ✅ | — |  |
| D812 | claimed | — | — | — |  |
| D813 | claimed | — | — | — |  |
| D814 | claimed | — | — | — |  |
| D815 | audited | — | ✅ | PASS |  |
| D816 | claimed | — | — | — |  |
| D817 | impl_done | — | ✅ | — |  |
| D818 | impl_done | — | ✅ | — |  |
| D819 | audited | — | ✅ | PASS |  |
| D820 | impl_done | — | ✅ | — |  |
| D821 | audited | — | ✅ | PASS |  |
| D822 | impl_done | — | ✅ | — |  |
| D823 | impl_done | — | ✅ | — |  |
| D824 | impl_done | — | ✅ | — |  |
| D825 | claimed | — | — | — |  |
| D826 | impl_done | — | ✅ | — |  |
| D827 | claimed | — | — | — |  |
| D828 | claimed | — | — | — |  |
| D829 | impl_done | — | ✅ | — |  |
| D830 | impl_done | — | ✅ | — |  |
| D831 | impl_done | — | ✅ | — |  |
| D832 | claimed | — | — | — |  |
| D833 | claimed | — | — | — |  |
| D834 | impl_done | — | ✅ | — |  |
| D835 | impl_done | — | ✅ | — |  |
| D836 | audited | — | ✅ | PASS |  |
| D837 | impl_done | — | ✅ | — |  |
| D838 | impl_done | — | ✅ | — |  |
| D839 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D840 | impl_done | — | ✅ | — |  |
| D841 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D842 | impl_done | — | ✅ | — |  |
| D843 | impl_done | — | ✅ | — |  |
| D845 | impl_done | — | ✅ | — |  |
| D846 | impl_done | — | ✅ | — |  |
| D847 | impl_done | — | ✅ | — |  |
| D848 | impl_done | — | ✅ | — |  |
| D849 | impl_done | — | ✅ | — |  |
| D850 | impl_done | — | ✅ | — |  |
| D852 | audited | — | ✅ | PASS |  |
| D853 | impl_done | — | ✅ | — |  |
| D854 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D855 | claimed | — | — | — |  |
| D856 | impl_done | — | ✅ | — |  |
| D857 | claimed | — | — | — |  |
| D858 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D860 | impl_done | — | ✅ | — |  |
| D861 | impl_done | — | ✅ | — |  |
| D862 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D863 | impl_done | — | ✅ | — |  |
| D864 | impl_done | — | ✅ | — |  |
| D865 | audited | — | ✅ | PASS |  |
| D866 | claimed | — | — | — |  |
| D867 | claimed | — | — | — |  |
| D868 | claimed | — | — | — |  |
| D869 | claimed | — | — | — |  |
| D870 | impl_done | — | ✅ | — |  |
| D911 | impl_done | — | ✅ | — |  |
| D912 | impl_done | — | ✅ | — |  |
| D913 | impl_done | — | ✅ | — |  |
| D914 | impl_done | — | ✅ | — |  |
| D915 | impl_done | — | ✅ | — |  |
| D916 | impl_done | — | ✅ | — |  |
| D917 | impl_done | — | ✅ | — |  |
| D918 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D919 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D920 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D921 | impl_done | — | ✅ | — |  |
| D922 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D923 | impl_done | — | ✅ | — |  |
| D924 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D925 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D926 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D928 | impl_done | — | ✅ | — |  |
| D930 | impl_done | — | ✅ | — |  |
| D931 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D933 | impl_done | ✅ | ✅ | — |  |
| D934 | impl_done | — | ✅ | — |  |
| D935 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D936 | audited | — | ✅ | CONDITIONAL_PASS |  |
| D937 | impl_done | — | ✅ | — |  |
| D938 | impl_done | — | ✅ | — |  |
| D939 | claimed | — | — | — |  |
| D940 | impl_done | — | ✅ | — |  |
| D941 | claimed | — | — | — |  |
| D942 | impl_done | — | ✅ | — |  |
| D943 | impl_done | — | ✅ | — |  |
| D945 | impl_done | — | ✅ | — |  |
| D954 | impl_done | — | ✅ | — |  |
| D955 | impl_done | — | ✅ | — |  |
| D956 | spec_done | ✅ | — | — |  |
| D962 | impl_done | ✅ | ✅ | — |  |
| D963 | impl_done | — | ✅ | — |  |
| D964 | impl_done | — | ✅ | — |  |
| D965 | impl_done | — | ✅ | — |  |
| D966 | impl_done | — | ✅ | — |  |
| D967 | claimed | — | — | — |  |
| D968 | claimed | — | — | — |  |
| CT-64 | claimed | — | — | — |  |

> 📦 历史任务（已折叠）: **197** 个（git log 全项目派生，非 task-state 登记；12 个有审计报告）
> 这些是 task-state 未登记、但 git 里确有提交的全项目任务（D5~D398 早期 + Win/Codex 侧），状态按 impl 派生。

### 六、CI 状态（CT-41①, GitHub API）

| Run | 结论 | 分支 | 标题 |
|-----|------|------|------|
| #4605 | 🔴 failure | feat/d962-2a-merge | chore: bypass COMMITTED 登记 (auto hook, D521) |
| #4604 | 🔴 failure | feat/d962-2a-merge | chore: bypass COMMITTED 登记 (auto hook, D521) |
| #631 | 🟢 success | main | pages build and deployment |
| #510 | 🟢 success | main | ci(D1014): N12 根治 — ci.yml 加 concurrency + push 触发 |
| #4603 | 🟡 pending | main | ci(D1014): N12 根治 — ci.yml 加 concurrency + push 触发 |
| #641 | 🟢 success | main | ci(D1014): N12 根治 — ci.yml 加 concurrency + push 触发 |
| #722 | 🟢 success | main | ci(D1014): N12 根治 — ci.yml 加 concurrency + push 触发 |
| #4602 | 🟡 pending | chore/d964-p4-archive-b2- | chore(D964-P4): 归档批次2 全量 50 份（单 PR 承载 · 省 5/6 CI） |

### 九、worktree 收尾（2026-08-21 必修）

- 🔴 **174 个孤儿 worktree 有待收尾**（独有提交未合并进 main，可能是未收尾的交付）
  - /private/tmp/synova-wt-cto-ci (分支 refs/heads/chore/D1014-ci-concurrency, 12 个独有提交)
  - /private/tmp/synova-wt-cto-d1017 (分支 refs/heads/chore/D1017-windows-hang, 8 个独有提交)
  - /private/tmp/synova-wt-cto-stage0 (分支 refs/heads/chore/D1010-stage0-report, 10 个独有提交)
  - /private/tmp/synova-wt-squad-backlog (分支 refs/heads/chore/D1011-stage0-backlog-classification, 16 个独有提交)
  - /private/tmp/synova-wt-squad-checkstar (分支 refs/heads/chore/D1015-checkstar-caliber, 8 个独有提交)
  - /private/tmp/synova-wt-squad-ci (分支 refs/heads/chore/D1009-stage0-log-archive, 18 个独有提交)
  - /private/tmp/synova-wt-squad-hang (分支 refs/heads/chore/D1018-hang-triage, 2 个独有提交)
  - /private/tmp/synova-wt-squad-k3in (分支 refs/heads/chore/D1016-k3-input-repro, 4 个独有提交)
  - /private/tmp/synova-wt-squad-out (分支 refs/heads/chore/D1021-tests-output-evict, 2 个独有提交)
  - /private/tmp/synova-wt-squad-verify (分支 refs/heads/chore/D1012-stage0-selfverify, 34 个独有提交)

> 处理: 确认独有提交是否该合并（真交付）→ worktree-manager finish 或 merge 进 main；过时则删除。

> 红线提醒: 不碰 scripts/audit/；不写审计标准；禁止自我审计。
> 同类错误第二次出现 = 防线系统性失效，升级创始人。

<!-- CTO-HEALTH:AUTO:END -->
<!-- CTO-HEALTH:MANUAL:START -->
(CTO 备注区)
<!-- CTO-HEALTH:MANUAL:END -->
