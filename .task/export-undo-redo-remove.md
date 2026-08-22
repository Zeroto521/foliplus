# 删除 ExportControl 的撤销/重做快捷键

## 目标

移除导出组件(ExportControl)中对裁剪框调整记录的撤销(Ctrl+Z / Cmd+Z)与重做(Ctrl+Shift+Z / Cmd+Shift+Z)快捷键。裁剪框拖拽后的 undo 历史维护逻辑一并删除。

## 需要改动的文件

- `foliplus/js/ExportControl/manager.ts`
  - 删除成员字段 `undoStack: Rect[]`、`redoStack: Rect[]`
  - 删除构造函数中的 `this.undoStack = []` / `this.redoStack = []` 初始化
  - 删除方法 `pushUndoState()`、`undoCropBox()`、`redoCropBox()`
  - 从 `onMouseUp()` 移除 `this.pushUndoState()` 调用
  - 从 `onKeyDown()` 移除 Ctrl+Z 与 Ctrl+Shift+Z 的分支
- `foliplus/js/ExportControl/ui.ts`
  - 从 `showCropBox()` 移除 `mgr.pushUndoState()` 调用(约第 197 行)
- `foliplus/js/ExportControl/const.ts`
  - 删除 `CACHE = { UNDO_MAX: 20 }` 常量(及其注释),除非仍有其他地方引用
- `foliplus/ExportControl.py`
  - 从 `ExportControl.__init__` 的 docstring 中的 Shortcuts 表格移除 "Ctrl+Z / Cmd+Z" 与 "Ctrl+Shift+Z / Cmd+Shift+Z" 两行
- `map.html`
  - 这是 esbuild 打包产物,改动源文件后需重跑构建以更新。当前 workspace 已有 `esbuild bundling migration` 任务,本任务的构建步骤可与该任务协调或由本任务完成后单独重跑。

## 需要同步删除的测试

- `test/js/ExportControl/manager.test.ts`
  - 删除整个 `describe("ExportManager — undo/redo", ...)` 块
  - 删除 `describe("ExportManager — onKeyDown", ...)` 中 "Ctrl+Z calls undoCropBox" 与 "Ctrl+Shift+Z calls redoCropBox" 两个用例
  - `describe("ExportManager — mouse drag", ...)` 中 "onMouseUp resets drag state and pushes undo" 用例更新断言(不再检查 `undoStack.length`)
- `test/js/ExportControl/const.test.ts`
  - 删除 `describe("CACHE", ...)` 块(若 `CACHE` 常量被移除)

## 注意事项

- 用户意图是**删除快捷键**,而不是删除拖拽能力本身。拖拽、锁定、确认导出等交互保持不变。
- 删除后若 `undoStack`/`redoStack` 字段无任何消费者,应确认无其他文件(如 `renderer.ts`、`interaction.ts`)引用这些名称。
- 修改完成后运行:
  - `uv run vitest` 确认测试通过
  - 如有 esbuild 构建入口,运行对应构建命令验证 `map.html` 更新

## 完成标准

- manager.ts / ui.ts / const.ts / ExportControl.py 中不再有 undo/redo 快捷键相关代码
- 相关测试用例已同步更新或删除
- 测试套件通过
- (可选) 打包产物更新