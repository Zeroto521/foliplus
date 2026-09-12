"""Collapsible, draggable map guide card built on foliplus ``BaseControl``.

The caller supplies a title, a few metrics and a few explanation paragraphs;
the control owns the DOM, escaping, collapsing, dragging, styling and its
mounting corner. Content is created with ``textContent`` / ``createTextNode``,
never by concatenating untrusted HTML, so the card is safe for user data.

Scope of the first version: no arbitrary HTML, no Markdown, no colour themes —
those would turn a reading guide into a generic HTML container.

Examples
--------
>>> import folium
>>> from foliplus import GuideControl
>>> m = folium.Map()
>>> GuideControl(
...     title="配送范围订单覆盖",
...     metrics=[("模拟订单", "1,234 笔"), ("覆盖率", "87.4%")],
...     sections=[("怎么看", "绿色房屋是门店，蓝色范围是当前配送区域。")],
... ).add_to(m)
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Literal, get_args

from jinja2 import Template

from .BaseControl import BaseControl
from .locale import LocaleConfig

GuidePlacement = Literal[
    "topcenter",
    "topleft",
    "topright",
    "bottomcenter",
    "bottomleft",
    "bottomright",
]

# Metrics are (prefix, value, suffix) so the value can be highlighted without
# letting the caller inject markup.
GUIDE_TEMPLATE = Template(
    r"""
{% macro html(this, kwargs) %}
<style>
.leaflet-top.leaflet-center,
.leaflet-bottom.leaflet-center {
  left: 50%;
  transform: translateX(-50%);
}
.foliplus-guide-control {
  width: min(520px, calc(100vw - 260px));
  margin: 12px 0 0;
  pointer-events: auto;
  font: 13px/1.55 var(--font-family, Inter), "PingFang SC", "Microsoft YaHei",
    sans-serif;
  color: var(--text-primary, #172033);
  background: var(--panel-bg, rgba(255, 255, 255, .96));
  border: 1px solid var(--panel-border, rgba(148, 163, 184, .55));
  border-radius: var(--radius-md, 12px);
  box-shadow: var(--shadow-lg, 0 8px 28px rgba(15, 23, 42, .18));
  overflow: hidden;
  box-sizing: border-box;
  will-change: transform;
}
.leaflet-bottom .foliplus-guide-control {
  margin: 0 0 12px;
}
.foliplus-guide-summary {
  cursor: grab;
  touch-action: none;
  user-select: none;
  padding: var(--space-sm, 10px) var(--space-md, 14px);
  font-weight: var(--font-weight-semibold, 600);
  list-style-position: inside;
}
.foliplus-guide-control.foliplus-guide-static .foliplus-guide-summary {
  cursor: pointer;
}
.foliplus-guide-control.foliplus-guide-dragging .foliplus-guide-summary {
  cursor: grabbing;
}
.foliplus-guide-control[open] .foliplus-guide-summary {
  border-bottom: 1px solid var(--panel-divider, #e2e8f0);
}
.foliplus-guide-body {
  padding: var(--space-sm, 10px) var(--space-md, 14px) var(--space-md, 12px);
  display: grid;
  gap: var(--space-xs, 8px);
}
.foliplus-guide-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs, 6px);
}
.foliplus-guide-metric {
  padding: 3px var(--space-xs, 8px);
  background: var(--accent-soft, #eff6ff);
  border-radius: var(--radius-pill, 999px);
}
.foliplus-guide-value,
.foliplus-guide-section-title {
  color: var(--accent, #1d4ed8);
  font-weight: var(--font-weight-semibold, 600);
}
.foliplus-guide-section {
  margin: 0;
}
@media (max-width: 760px) {
  .foliplus-guide-control {
    width: calc(100vw - 112px);
    font-size: var(--font-size-sm, 12px);
  }
  .foliplus-guide-body {
    max-height: 42vh;
    overflow: auto;
  }
}
</style>
{% endmacro %}

{% macro script(this, kwargs) %}
(() => {
  const map = {{ this._parent.get_name() }};
  const CONF = {{ this._config_block | safe }};
  const FoliplusBaseControl = window.foliplus?.BaseControl?.BaseControl;
  if (!FoliplusBaseControl) {
    throw new Error("[GuideControl] foliplus BaseControl is unavailable");
  }

  // Leaflet has no "center" corner by default; create it on demand so the card
  // lives inside the control container instead of floating on position: fixed.
  const ensureGuideCorner = (targetMap, placement) => {
    if (!placement.endsWith("center")) return;
    if (!targetMap._controlContainer || !targetMap._controlCorners) {
      throw new Error("[GuideControl] Leaflet control container is unavailable");
    }
    if (targetMap._controlCorners[placement]) return;
    const vertical = placement.startsWith("top") ? "leaflet-top" : "leaflet-bottom";
    const corner = L.DomUtil.create(
      "div",
      `${vertical} leaflet-center`,
      targetMap._controlContainer,
    );
    targetMap._controlCorners[placement] = corner;
  };

  const appendText = (parent, value) => {
    parent.append(document.createTextNode(value));
  };

  class GuideLeafletControl extends FoliplusBaseControl {
    buildDOM() {
      const details = document.createElement("details");
      details.className = "leaflet-control foliplus-guide-control";
      details.open = !CONF.collapsed;
      if (!CONF.draggable) details.classList.add("foliplus-guide-static");

      const summary = document.createElement("summary");
      summary.className = "foliplus-guide-summary";
      summary.textContent = CONF.summary_open;
      summary.setAttribute("aria-expanded", String(details.open));
      details.append(summary);

      const body = document.createElement("div");
      body.className = "foliplus-guide-body";

      if (CONF.metrics.length) {
        const metrics = document.createElement("div");
        metrics.className = "foliplus-guide-metrics";
        for (const metric of CONF.metrics) {
          const item = document.createElement("span");
          item.className = "foliplus-guide-metric";
          appendText(item, metric.prefix);
          const value = document.createElement("span");
          value.className = "foliplus-guide-value";
          value.textContent = metric.value;
          item.append(value);
          appendText(item, metric.suffix);
          metrics.append(item);
        }
        body.append(metrics);
      }

      for (const section of CONF.sections) {
        const paragraph = document.createElement("p");
        paragraph.className = "foliplus-guide-section";
        const title = document.createElement("span");
        title.className = "foliplus-guide-section-title";
        title.textContent = section.title;
        paragraph.append(title);
        appendText(paragraph, section.text);
        body.append(paragraph);
      }
      details.append(body);

      this.guideElement = details;
      this.summaryElement = summary;
      this.pendingFrame = null;
      this.drag = {
        pointerId: null,
        startX: 0,
        startY: 0,
        originX: 0,
        originY: 0,
        x: 0,
        y: 0,
        moved: false,
        suppressClick: false,
      };

      const setTransform = () => {
        details.style.transform = `translate3d(${this.drag.x}px, ${this.drag.y}px, 0)`;
      };
      const updateMaxWidth = () => {
        const available = Math.max(1, this._map.getContainer().clientWidth - 24);
        details.style.maxWidth = `${available}px`;
      };
      const clamp = (x, y) => {
        const mapRect = this._map.getContainer().getBoundingClientRect();
        const box = details.getBoundingClientRect();
        const baseLeft = box.left - this.drag.x;
        const baseTop = box.top - this.drag.y;
        const minX = mapRect.left - baseLeft;
        const maxX = mapRect.right - baseLeft - box.width;
        const minY = mapRect.top - baseTop;
        const maxY = mapRect.bottom - baseTop - box.height;
        return {
          x: Math.min(Math.max(x, Math.min(minX, maxX)), Math.max(minX, maxX)),
          y: Math.min(Math.max(y, Math.min(minY, maxY)), Math.max(minY, maxY)),
        };
      };
      const clampCurrent = () => {
        updateMaxWidth();
        const next = clamp(this.drag.x, this.drag.y);
        this.drag.x = next.x;
        this.drag.y = next.y;
        setTransform();
      };
      const scheduleClamp = () => {
        if (this.pendingFrame !== null) cancelAnimationFrame(this.pendingFrame);
        this.pendingFrame = requestAnimationFrame(() => {
          this.pendingFrame = null;
          clampCurrent();
        });
      };
      const syncSummary = () => {
        summary.setAttribute("aria-expanded", String(details.open));
        summary.textContent = details.open ? CONF.summary_open : CONF.summary_closed;
        scheduleClamp();
      };
      const onClick = (event) => {
        if (this.drag.suppressClick) {
          this.drag.suppressClick = false;
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        requestAnimationFrame(syncSummary);
      };
      const finishDrag = (event) => {
        if (this.drag.pointerId !== event.pointerId) return;
        if (summary.hasPointerCapture?.(event.pointerId)) {
          summary.releasePointerCapture(event.pointerId);
        }
        this.drag.pointerId = null;
        this.drag.suppressClick = this.drag.moved;
        details.classList.remove("foliplus-guide-dragging");
        if (this.drag.moved) {
          event.preventDefault();
          event.stopPropagation();
        }
      };
      const onPointerDown = (event) => {
        if (event.button !== undefined && event.button !== 0) return;
        this.drag.pointerId = event.pointerId;
        this.drag.startX = event.clientX;
        this.drag.startY = event.clientY;
        this.drag.originX = this.drag.x;
        this.drag.originY = this.drag.y;
        this.drag.moved = false;
        summary.setPointerCapture(event.pointerId);
      };
      const onPointerMove = (event) => {
        if (this.drag.pointerId !== event.pointerId) return;
        const dx = event.clientX - this.drag.startX;
        const dy = event.clientY - this.drag.startY;
        if (!this.drag.moved && Math.hypot(dx, dy) < 4) return;
        this.drag.moved = true;
        details.classList.add("foliplus-guide-dragging");
        const next = clamp(this.drag.originX + dx, this.drag.originY + dy);
        this.drag.x = next.x;
        this.drag.y = next.y;
        setTransform();
        event.preventDefault();
        event.stopPropagation();
      };
      const onPointerCancel = (event) => finishDrag(event);

      this.handlers = {
        onClick,
        onPointerDown,
        onPointerMove,
        onPointerUp: finishDrag,
        onPointerCancel,
        clampCurrent,
      };
      summary.addEventListener("click", onClick);
      if (CONF.draggable) {
        summary.addEventListener("pointerdown", onPointerDown);
        summary.addEventListener("pointermove", onPointerMove);
        summary.addEventListener("pointerup", finishDrag);
        summary.addEventListener("pointercancel", onPointerCancel);
      }
      window.addEventListener("resize", clampCurrent);
      document.addEventListener("fullscreenchange", clampCurrent);
      this.listenMap("resize", clampCurrent);
      scheduleClamp();
      return details;
    }

    destroy() {
      const summary = this.summaryElement;
      const handlers = this.handlers;
      if (summary && handlers) {
        summary.removeEventListener("click", handlers.onClick);
        summary.removeEventListener("pointerdown", handlers.onPointerDown);
        summary.removeEventListener("pointermove", handlers.onPointerMove);
        summary.removeEventListener("pointerup", handlers.onPointerUp);
        summary.removeEventListener("pointercancel", handlers.onPointerCancel);
      }
      if (handlers) {
        window.removeEventListener("resize", handlers.clampCurrent);
        document.removeEventListener("fullscreenchange", handlers.clampCurrent);
      }
      if (
        summary &&
        this.drag?.pointerId !== null &&
        summary.hasPointerCapture?.(this.drag.pointerId)
      ) {
        summary.releasePointerCapture(this.drag.pointerId);
      }
      if (this.pendingFrame !== null) cancelAnimationFrame(this.pendingFrame);
      this.guideElement?.classList.remove("foliplus-guide-dragging");
      this.handlers = null;
    }
  }

  ensureGuideCorner(map, CONF.placement);
  new GuideLeafletControl({ position: CONF.placement }).addTo(map);
})();
{% endmacro %}
"""
)


def _required_text(value: object, name: str) -> str:
    """Reject non-strings and blank strings with the offending field named."""
    if not isinstance(value, str):
        raise TypeError(f"{name} must be a string")
    normalized = value.strip()
    if not normalized:
        raise ValueError(f"{name} must be a non-empty string")
    return normalized


def _records(
    value: object,
    *,
    name: str,
    required: tuple[str, ...],
    optional: tuple[str, ...],
) -> list[dict[str, str]]:
    """Normalise a sequence of mappings, rejecting anything else.

    ``metrics`` / ``sections`` are user-facing content, so a stray string or a
    typo'd key must fail loudly at construction time rather than render an
    empty card.
    """
    if isinstance(value, (str, bytes)) or not isinstance(value, Sequence):
        raise TypeError(f"{name} must be a sequence of mappings")

    allowed = set(required + optional)
    result: list[dict[str, str]] = []
    for index, item in enumerate(value):
        if not isinstance(item, Mapping):
            raise TypeError(f"{name}[{index}] must be a mapping")
        unknown = set(item) - allowed
        if unknown:
            fields = ", ".join(sorted(str(field) for field in unknown))
            raise ValueError(f"{name}[{index}] has unknown fields: {fields}")

        row = {
            field: _required_text(item.get(field), f"{name}[{index}].{field}")
            for field in required
        }
        for field in optional:
            raw = item.get(field, "")
            if not isinstance(raw, str):
                raise TypeError(f"{name}[{index}].{field} must be a string")
            # Prefix/suffix whitespace is meaningful around the value.
            row[field] = raw
        result.append(row)
    return result


class GuideControl(BaseControl):
    """Render a collapsible guide card that can be dragged within its map.

    Parameters
    ----------
    title : str
        Heading shown on the summary line.
    metrics : sequence of mappings, optional
        Each mapping needs ``value`` and may carry ``prefix`` / ``suffix``.
    sections : sequence of mappings, optional
        Each mapping needs ``title`` and ``text``.
    placement : {"topcenter", "topleft", "topright", "bottomcenter",
        "bottomleft", "bottomright"}, default "topcenter"
        Leaflet corner the card is mounted in.
    collapsed : bool, default False
        Whether the card starts collapsed.
    draggable : bool, default True
        Whether the card can be dragged away from its corner.

    locale : str or LocaleConfig, optional
        Language code (``"en"``, ``"zh"``) or a :class:`LocaleConfig` instance.
        Defaults to auto-detection, falling back to English.

    Examples
    --------
    >>> import folium
    >>> from foliplus import GuideControl
    >>> m = folium.Map()
    >>> GuideControl(title="How to read this map").add_to(m)
    """

    _export_fields = (
        "title",
        "metrics",
        "sections",
        "placement",
        "collapsed",
        "draggable",
    )

    def __init__(
        self,
        *,
        title: str,
        metrics: Sequence[Mapping[str, str]] = (),
        sections: Sequence[Mapping[str, str]] = (),
        placement: GuidePlacement = "topcenter",
        collapsed: bool = False,
        draggable: bool = True,
        locale: str | LocaleConfig | None = None,
    ):
        normalized_title = _required_text(title, "title")
        if not isinstance(placement, str) or placement not in get_args(GuidePlacement):
            raise ValueError(
                f"placement must be one of {get_args(GuidePlacement)}, "
                f"got {placement!r}"
            )
        if not isinstance(collapsed, bool):
            raise TypeError("collapsed must be a bool")
        if not isinstance(draggable, bool):
            raise TypeError("draggable must be a bool")

        # Leaflet only knows the four corners. A centre placement is mounted by
        # the JS side, which creates the corner on demand (ensureGuideCorner),
        # so the base control gets the matching vertical corner and the card
        # itself is positioned from CONF.placement.
        corner = "topleft" if placement.startswith("top") else "bottomleft"
        super().__init__(position=corner, locale=locale)
        self.title = normalized_title
        self.metrics = _records(
            metrics, name="metrics", required=("value",), optional=("prefix", "suffix")
        )
        self.sections = _records(
            sections, name="sections", required=("title", "text"), optional=()
        )
        self.placement = placement
        self.collapsed = collapsed
        self.draggable = draggable
        # The guide is a reading aid, not a packaged widget, so it carries its
        # own inline template: there is no dist/foliplus-GuideControl bundle.
        self._template = GUIDE_TEMPLATE

    @property
    def _config_block(self) -> str:
        """Escape JSON characters that are unsafe inside an inline script."""
        return (
            super()
            ._config_block.replace("<", "\\u003c")
            .replace(">", "\\u003e")
            .replace("&", "\\u0026")
            .replace("\u2028", "\\u2028")
            .replace("\u2029", "\\u2029")
        )
