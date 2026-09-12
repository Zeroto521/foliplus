import { createControlEnv } from "#core/controlEnv.js";
import { BaseControl } from "#foliplus/BaseControl.js";
import { dom } from "#common/dom.js";
import { createScopedTranslator } from "#common/locale.js";

createControlEnv(CONF);
const T = createScopedTranslator(CONF);

interface GuideMetric {
  prefix: string;
  value: string;
  suffix: string;
}

interface GuideSection {
  title: string;
  text: string;
}

/** Leaflet ships no centre corner, so make one on demand: keeping the card
 *  inside the control container is what lets FullscreenControl(hide_others)
 *  manage it, and it avoids the old `position: fixed` overlay. */
const ensureGuideCorner = (targetMap: L.Map, position: string): void => {
  if (!position.endsWith("center")) return;
  const internals = targetMap as unknown as {
    _controlContainer?: HTMLElement;
    _controlCorners: Record<string, HTMLElement>;
  };
  if (!internals._controlContainer) return;
  if (internals._controlCorners[position]) return;
  const vertical = position.startsWith("top") ? "leaflet-top" : "leaflet-bottom";
  const corner = L.DomUtil.create(
    "div",
    `${vertical} leaflet-center`,
    internals._controlContainer,
  );
  internals._controlCorners[position] = corner;
};

/** Build the card. All text goes through textContent / createTextNode, so
 *  caller-supplied metrics and paragraphs can never inject markup. */
class GuideControl extends BaseControl {
  private guideElement: HTMLDetailsElement | null = null;
  private summaryElement: HTMLElement | null = null;
  private pendingFrame: number | null = null;
  private handlers: {
    onClick: (event: Event) => void;
    onPointerDown: (event: Event) => void;
    onPointerMove: (event: Event) => void;
    onPointerUp: (event: Event) => void;
    onPointerCancel: (event: Event) => void;
    clampCurrent: () => void;
  } | null = null;
  private drag = {
    pointerId: null as number | null,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    x: 0,
    y: 0,
    moved: false,
    suppressClick: false,
  };

  buildDOM() {
    const details = dom.el("details", {
      class: "leaflet-control foliplus-guide-control",
    }) as HTMLDetailsElement;
    details.open = !CONF.collapsed;
    if (!CONF.draggable) details.classList.add("foliplus-guide-static");

    const summary = dom.el("summary", {
      class: "foliplus-guide-summary",
      parent: details,
    });
    this.summaryElement = summary;

    const body = dom.el("div", {
      class: "foliplus-guide-body",
      parent: details,
    });

    const metrics = CONF.metrics as GuideMetric[];
    if (metrics.length) {
      const row = dom.el("div", {
        class: "foliplus-guide-metrics",
        parent: body,
      });
      for (const metric of metrics) {
        const item = dom.el("span", {
          class: "foliplus-guide-metric",
          parent: row,
        });
        item.append(document.createTextNode(metric.prefix));
        const value = dom.el("span", {
          class: "foliplus-guide-value",
          parent: item,
        });
        value.textContent = metric.value;
        item.append(document.createTextNode(metric.suffix));
      }
    }

    const sections = CONF.sections as GuideSection[];
    for (const section of sections) {
      const paragraph = dom.el("p", {
        class: "foliplus-guide-section",
        parent: body,
      });
      const heading = dom.el("span", {
        class: "foliplus-guide-section-title",
        parent: paragraph,
      });
      heading.textContent = section.title;
      paragraph.append(document.createTextNode(section.text));
    }

    this.guideElement = details;
    this.bindCard(details, summary);
    return details;
  }

  /** Collapsing, dragging (clamped to the map) and layout syncing. */
  private bindCard(details: HTMLDetailsElement, summary: HTMLElement): void {
    const setTransform = () => {
      details.style.transform = `translate3d(${this.drag.x}px, ${this.drag.y}px, 0)`;
    };
    const updateMaxWidth = () => {
      const available = Math.max(1, this._map.getContainer().clientWidth - 24);
      details.style.maxWidth = `${available}px`;
    };
    const clamp = (x: number, y: number) => {
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
      const label = details.open ? "summary_open" : "summary_closed";
      summary.setAttribute("aria-expanded", String(details.open));
      summary.textContent = T(label).replace("{title}", String(CONF.title ?? ""));
      scheduleClamp();
    };
    const onClick = (event: Event) => {
      if (this.drag.suppressClick) {
        this.drag.suppressClick = false;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      requestAnimationFrame(syncSummary);
    };
    const finishDrag = (rawEvent: Event) => {
      const event = rawEvent as PointerEvent;
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
    const onPointerDown = (rawEvent: Event) => {
      const event = rawEvent as PointerEvent;
      if (event.button !== undefined && event.button !== 0) return;
      this.drag.pointerId = event.pointerId;
      this.drag.startX = event.clientX;
      this.drag.startY = event.clientY;
      this.drag.originX = this.drag.x;
      this.drag.originY = this.drag.y;
      this.drag.moved = false;
      summary.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (rawEvent: Event) => {
      const event = rawEvent as PointerEvent;
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
    const onPointerCancel = (event: Event) => finishDrag(event);

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
    // Tracked via listenMap — auto-unbound in onRemove.
    this.listenMap("resize", clampCurrent);
    syncSummary();
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
      this.drag.pointerId !== null &&
      summary.hasPointerCapture?.(this.drag.pointerId)
    ) {
      summary.releasePointerCapture(this.drag.pointerId);
    }
    if (this.pendingFrame !== null) cancelAnimationFrame(this.pendingFrame);
    this.guideElement?.classList.remove("foliplus-guide-dragging");
    this.handlers = null;
  }
}

const placement: string = String(CONF.placement ?? CONF.position ?? "topcenter");

ensureGuideCorner(map, placement);
new GuideControl({
  position: placement as L.ControlOptions["position"],
}).addTo(map);
