# squad-lead 挂载失败真因：agent-team 跨层重复定义

状态: implemented
日期: 2026-10-18

## 一句话

`agent-team` 同时定义在 profile（cordis.patch.yml:112）和预设里 ⇒ **同名插件 id 跨层重复 ⇒ 挂载失败**。
移除预设里的 `agent-team`（保留 `tool-agent-team`/`ui-agent-team`），服务本体由 profile 提供。

## 问题

创始人 2026-10-18 多次报「专职小队预设加载失败」。
先前误判为 YAML 结构损坏（确实也坏过并已重建），但重建后**仍加载失败**。
实测：预设插件 id ∩ profile 插件 id = **`agent-team`**（唯一交集）⇒ 跨层重复。

## 决定

三处（bundles / 产品仓 docs / user_root）删除 `agent-team` 块；保留 `tool-agent-team`（工具）与 `ui-agent-team`（UI）。
全量扫描：其他 40+ 预设**均无跨层重复**。
显示名/描述同步为「🎽 L2 实施小队队长」。

## 依据

`profile/cordis.patch.yml:112` `- id: agent-team`（maxMembers 16 / maxTasks 512）；
预设里 `- id: agent-team`（重复）。

## 生效时点

本 commit 起；bundle 类需重启 DSH。
