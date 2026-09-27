# T126：删镜像 + 收敛残留（T55.3 后续）

基于 `origin/main` = `779fef5e`（#443 已合）。

## 背景（设计文档 §43.4 / §44.6）

T55.3（diff 执行器，#438）落地后，**镜像残留**要删：

- **§43.4-2**：删镜像——`layerInfo.visible`、`hiddenIds` 并入 `intent`（`visible:false`）。
- **§44.6 / §49.1**：`hiddenIds` 并入 `intent`（`visible:false`）或 `hiddenLayerIds`——与 intent 双源，T126 删镜像时一并。
- **§22-9.1 不变量**：只有用户意图/作者默认快照决定成员关系；派生维度只许抑制、永不许授权。

## 任务（先核后删）

1. **核清镜像现状**：`layerInfo.visible` 和 `hiddenIds` 目前谁写谁读（`ui/*`、`manager.ts`、`apply.ts`、`persistence.ts`）——列出完整读写面。
2. **并入 intent**：把两处镜像并入 `intent`（`visible`）单一事实源——「用户意图决定成员关系」。
3. **收敛残留**：`LayerInfo.visible/opacity/onToggle` 若不再需要（意图泄漏进底座，§44.6 说「下放给控件层」），从 substrate 契约（`type.ts`）移走或改为 intent 投影。
4. **闸**：成员关系只有 intent + 作者默认快照决定（§40.5 不变量）；派生维度只许抑制不授权。补测试钉住。

## 边界

- 只动 `core/layer/**` + `LayerControl/**` 的相关读写面。
- **不碰** #485（T188）/ #483（T181）在飞面（`ui/index.ts`、`state.ts`、`ui/style/**`）——先核交集。
- 行为变化仅限「镜像字段并入 intent」，需 CHANGELOG。
- Rule 24 自审进 PR body。
- 合并只由用户。

## 汇报

先回 ≤12 行：① 镜像现状读写面清单（`visible`/`hiddenIds` 谁写谁读）② 并入 intent 的方案 ③ `LayerInfo` 字段移走清单 ④ 与 #485/#483 交集。等 "go"。