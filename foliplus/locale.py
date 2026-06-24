"""
Localization support for foliplus UI components.

Provides language-specific string tables for all frontend UI text and a helper to inject
the correct locale into Jinja2 templates.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Dict, Optional

# ---------------------------------------------------------------------------
# Language code → string table
# ---------------------------------------------------------------------------

LOCALE_TABLES: Dict[str, Dict[str, str]] = {
    "en": {
        # ── Shared ──
        "locale.name": "English",
        "locale.code": "en",
        # ── Fullscreen ──
        "fullscreen.enter": "Entered fullscreen, press Esc to exit",
        "fullscreen.exit": "Exited fullscreen",
        # ── Heatmap ──
        "heatmap.title": "Hexbin Aggregation",
        "heatmap.layer": "Layer",
        "heatmap.layer_placeholder": "Select a point layer",
        "heatmap.agg_method": "Aggregation",
        "heatmap.agg_count": "Count",
        "heatmap.agg_sum": "Sum",
        "heatmap.agg_avg": "Average",
        "heatmap.agg_min": "Min",
        "heatmap.agg_max": "Max",
        "heatmap.field": "Field",
        "heatmap.field_auto": "Auto-detect",
        "heatmap.class_method": "Classification / Classes",
        "heatmap.jenks": "Natural Breaks",
        "heatmap.quantile": "Quantile",
        "heatmap.equal": "Equal Interval",
        "heatmap.heads": "Equal Count",
        "heatmap.scheme": "Color Scheme",
        "heatmap.border": "Border",
        "heatmap.label": "Label",
        "heatmap.clear": "Reset",
        "heatmap.confirm": "Apply",
        "heatmap.no_h3": "h3-js library failed to load, hexbin aggregation unavailable",
        "heatmap.no_ss": "simple-statistics library failed to load, hexbin aggregation unavailable",
        "heatmap.no_chroma": "chroma-js library failed to load, using default gray",
        "heatmap.section_data": "Data",
        "heatmap.section_style": "Style",
        # ── LayerControl ──
        "layer.panel_title": "Layers",
        "layer.toggle_title": "Layer Manager",
        "layer.close_title": "Collapse",
        "layer.base_map_label": "Base Map",
        "layer.color_map_label": "Solid Color",
        # ── MapSearch ──
        "search.coord_placeholder": "Enter: longitude,latitude",
        "search.addr_placeholder": "Enter an address keyword",
        "search.coord_error": "Invalid format. Enter: longitude,latitude",
        "search.addr_not_found": "Address not found, try different keywords",
        "search.addr_error": "Address lookup failed, please check network",
        "search.popup_title_coord": "📍 Coordinate Search",
        "search.popup_title_addr": "📍 Address Search",
        "search.popup_loc_label": "📌 Location:",
        "search.popup_addr_label": "📌 Address:",
        "search.popup_loading": "Searching…",
        "search.btn_title": "Map Search",
        "search.clear_title": "Clear",
        "search.mode_coord": "Coordinate Search",
        "search.mode_addr": "Address Search",
        # ── MeasureControl ──
        "measure.tool_toggle": "Measurement Tools",
        "measure.tool_marker": "Locate",
        "measure.tool_distance": "Measure Distance",
        "measure.tool_circle": "Draw Circle",
        "measure.tool_clear": "Clear All",
        "measure.hint_marker": "Click the map to place a location marker",
        "measure.hint_dist_start": "Click to start measuring distance, double-click / right-click / click last point to finish",
        "measure.hint_circle_start": "Click to set the center, move mouse to set radius, click again to finish",
        "measure.hint_circle_radius": "Move mouse to set radius, click to confirm",
        "measure.popup_title": "📍 Location",
        "measure.popup_loc_label": "📌 Location:",
        "measure.popup_addr_label": "📌 Address:",
        "measure.popup_loading": "Searching…",
        "measure.dist_origin": "Start",
        "measure.geo_timeout": "Request timed out, please check network",
        "measure.geo_network": "Network error, please check connection",
        "measure.geo_rate_limit": "Service rate limited, please try again later",
        "measure.geo_unavailable": "Service unavailable",
        "measure.geo_fail": "Lookup failed",
        # ── ScaleControl ──
        "scale.zoom_label": "Zoom Level: {zoom}",
        # ── gcoord ──
        "gcoord.warn": "gcoord library failed to load, coordinate transformation unavailable",
    },
    "zh": {
        "locale.name": "中文",
        "locale.code": "zh",
        "fullscreen.enter": "已进入全屏，按 Esc 退出",
        "fullscreen.exit": "已退出全屏",
        "heatmap.title": "网格聚合",
        "heatmap.layer": "图层",
        "heatmap.layer_placeholder": "请选择点图层",
        "heatmap.agg_method": "聚合方式",
        "heatmap.agg_count": "计数",
        "heatmap.agg_sum": "求和",
        "heatmap.agg_avg": "平均值",
        "heatmap.agg_min": "最小值",
        "heatmap.agg_max": "最大值",
        "heatmap.field": "字段",
        "heatmap.field_auto": "自动识别",
        "heatmap.class_method": "分段方式/数量",
        "heatmap.jenks": "自然断点",
        "heatmap.quantile": "分位数法",
        "heatmap.equal": "等距分段",
        "heatmap.heads": "等数分段",
        "heatmap.scheme": "色带",
        "heatmap.border": "边框",
        "heatmap.label": "标注",
        "heatmap.clear": "清除",
        "heatmap.confirm": "创建",
        "heatmap.no_h3": "h3-js 库未加载成功，网格聚合功能不可用",
        "heatmap.no_ss": "simple-statistics 库未加载成功，网格聚合功能不可用",
        "heatmap.no_chroma": "chroma-js 库未加载成功，颜色分级将使用默认灰色",
        "heatmap.section_data": "数据",
        "heatmap.section_style": "样式",
        "layer.panel_title": "图层",
        "layer.toggle_title": "图层管理",
        "layer.close_title": "收起",
        "layer.base_map_label": "基础底图",
        "layer.color_map_label": "纯色地图",
        "search.coord_placeholder": "请输入：经度,纬度",
        "search.addr_placeholder": "请输入地址关键词",
        "search.coord_error": "格式错误，请输入：经度,纬度",
        "search.addr_not_found": "未找到该地址，请更换关键词重试",
        "search.addr_error": "地址查询失败，请检查网络",
        "search.popup_title_coord": "📍 坐标搜索",
        "search.popup_title_addr": "📍 地址搜索",
        "search.popup_loc_label": "📌 定位：",
        "search.popup_addr_label": "📌 地址：",
        "search.popup_loading": "查询中…",
        "search.btn_title": "地图搜索",
        "search.clear_title": "清除",
        "search.mode_coord": "地图搜索",
        "search.mode_addr": "地址搜索",
        "measure.tool_toggle": "量算工具",
        "measure.tool_marker": "定位",
        "measure.tool_distance": "测距",
        "measure.tool_circle": "画圆",
        "measure.tool_clear": "清空",
        "measure.hint_marker": "点击地图放置定位标记",
        "measure.hint_dist_start": "点击地图开始测距，双击 / 右键 / 点击末点结束",
        "measure.hint_circle_start": "点击地图确定圆心，移动鼠标设定半径，再次点击完成",
        "measure.hint_circle_radius": "移动鼠标设定半径，点击确认",
        "measure.popup_title": "📍 坐标定位",
        "measure.popup_loc_label": "📌 定位：",
        "measure.popup_addr_label": "📌 地址：",
        "measure.popup_loading": "查询中…",
        "measure.dist_origin": "起点",
        "measure.geo_timeout": "查询超时，请检查网络",
        "measure.geo_network": "网络错误，请检查连接",
        "measure.geo_rate_limit": "服务限流，请稍后再试",
        "measure.geo_unavailable": "服务不可用",
        "measure.geo_fail": "查询失败",
        "scale.zoom_label": "地图层级: {zoom}",
        "gcoord.warn": "gcoord 库未加载成功，坐标转换不可用",
    },
}

# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------


@dataclass
class LocaleConfig:
    """Locale configuration for a control instance.

    Stores the selected language code and provides string lookup.
    """

    language: str = "en"
    _strings: Dict[str, str] = field(default_factory=dict, init=False, repr=False)

    def __post_init__(self):
        table = LOCALE_TABLES.get(self.language, LOCALE_TABLES["en"])
        self._strings = dict(table)

    def get(self, key: str, default: Optional[str] = None) -> str:
        """Look up a localized string by key."""
        return self._strings.get(key, default or key)

    def get_js_table(self) -> str:
        """Return the string table as a JavaScript object literal for injection."""
        return json.dumps(self._strings, ensure_ascii=False)

    @property
    def code(self) -> str:
        return self._strings.get("locale.code", "en")


# Pre-built instances for convenience
EN = LocaleConfig("en")
ZH = LocaleConfig("zh")


def detect_language(accept_language: str = "") -> str:
    """Detect language from HTTP Accept-Language header, defaulting to 'en'."""
    if not accept_language:
        return "en"
    lang = accept_language.split(",")[0].split("-")[0].strip().lower()
    return lang if lang in LOCALE_TABLES else "en"
