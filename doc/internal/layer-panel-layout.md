# 行内浮层（row panel）的高度与裁切问题

状态：**未修复**，记录于滑杆原语重构期间（分支 `slider-primitive`）。
影响面：所有从图层行 ⋮ 菜单打开的浮层——样式面板（`foliplus-layer-style-panel`）和属性面板（`foliplus-layer-attrs-panel`）。

## 现象

样式面板锚定在图层行下方（`position:absolute; top:100%`），内容有 7 行左右（透明度、可见范围、标注、标注字段、颜色/字号、数字格式、标签避让）。
在 1280×720 的视口里实测面板高度只有 **207px**，而内容高度约 **270–330px**：第二行「可见范围」在首次打开时就落在可视区之外，必须先面板内滚动才能看到。

这不是滑杆本身的问题——滑杆只是让第二行变得重要（用户要同时看到两条滑杆）。面板本身的行为在滑杆改动之前就是这样。

## 相关代码

| 位置                                                                    | 作用                                                                                 |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `foliplus/css/common/panel.css:25` `.foliplus-panel.foliplus-row-panel` | `position:absolute; top:100%; max-height: var(--foliplus-panel-max-height)`（400px） |
| `foliplus/css/common/panel.css:137` `.foliplus-panel-content`           | `flex:1; overflow-y:auto` —— 内容超出时在面板内部滚动                                |
| `foliplus/js/core/leaflet/panel.ts:321` `createRowPanel`                | 面板外壳（header + content），不含高度计算                                           |
| `foliplus/js/LayerControl/ui/style/index.ts`                            | 把面板挂到行上（`item.appendChild(panel)`）                                          |
| `token.css` `--foliplus-panel-max-height: 400px`                        | 唯一的高度上限                                                                       |

## 待验证的假设（按可能性排序）

1. **祖先裁切**：面板挂在一个可滚动的列表容器里，祖先的 `overflow` 把绝对定位的子元素裁到了可视区，而不是让 `max-height` 生效。
   验证：比较 `panel.getBoundingClientRect().height` 与 `panel.scrollHeight`，再逐级检查祖先的 `overflow` / `contain`。
2. **没有视口感知**：`max-height` 是固定 400px，不考虑「面板底部到地图底边还有多少空间」。窗口矮时面板仍然按 400px 布局，再被外部裁掉。
3. **没有向上翻转**：`top:100%` 只向下展开。靠近视口底部的行打开面板时，没有「向上展开」的兜底。

## 候选修复

| 方案            | 做法                                                                                   | 代价                                                                   |
| --------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| A. 祖先放行     | 让列表容器对行面板 `overflow: visible`（或把面板挂到控制容器而非行）                   | 需要确认列表滚动仍正常；面板定位要重新算锚点                           |
| B. 视口感知高度 | 打开时测量锚点上下可用空间，写入 `--foliplus-row-panel-max-height`，内容超高时内部滚动 | 需要一次布局读取 + resize/scroll 重新计算；逻辑集中在 `createRowPanel` |
| C. 向上翻转     | 下方空间不足时改为 `bottom:100%`                                                       | 纯 CSS 类切换 + 测量；和 B 可以叠加                                    |

推荐：**B + C**，都收敛在 `createRowPanel` 一处，组件侧不改。A 只能解决「被裁掉」，解决不了「矮窗口里不够高」。

## 验收标准（修复时）

- 1280×720 下打开样式面板，「可见范围」首屏可见，无需滚动。
- 视口高度 500px 时面板不超出地图可视区，内容可滚动且滚动条可见。
- 靠近视口底部的行打开面板时，面板向上展开且完整可见。
- 上述三条用 Playwright 截图 + `getBoundingClientRect` 断言，不用肉眼。
