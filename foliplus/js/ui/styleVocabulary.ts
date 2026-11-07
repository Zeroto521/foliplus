// ui/styleVocabulary — 样式着色的受控词表（locale key 单源）。
//
// 面板凡表达"着色来源"的文案必须引用这里的 key 常量，禁止内联串；
// 中文/英文文案只存在于 foliplus/locale/<component>/<lang>.json，这里不重复。
// 守卫测试断言：① foliplus/js 不出现非受控的中文着色文案字面量（见 guard 测试内 FORBIDDEN 清单），
// ② 所有被引用的 t()/ui.T() locale key 在 zh/en 两份 JSON 中都存在，
// ③ STYLE_MODE 四个 key 在 zh/en 两份 JSON 中都定义且有值（缺翻译即红）。
//
// 与 sliderVocabulary 同级：纯字符串常量、无任何 foliplus runtime import，
// 面板及其测试直接导入本模块（sliderVocabulary 的历史遗留注释见 #900）。

const STYLE_MODE = {
  ORIGINAL: "style_mode_original",
  SINGLE: "style_mode_single",
  BY_VALUE: "style_mode_by_value",
  FOLLOW_FILL: "style_mode_follow_fill",
} as const;

export { STYLE_MODE };
