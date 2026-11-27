// ui/scrollbarLane — publish a scroll container's measured scrollbar lane.
//
// A `scrollbar-gutter: stable` lane is reserved in BOTH the scrolling and the
// fitting state, so a consumer can keep its row geometry constant across a
// max-height crossing. CSS cannot read the lane width, and the consumers need
// it for opposite purposes — the scheme picker subtracts it from its strip
// inset, the search result row extends its highlight into it — so the
// measurement lives here once and publishes the one shared property both
// stylesheets read (--foliplus-scrollbar-lane, defined in token.css).
const SCROLLBAR_LANE_PROPERTY = "--foliplus-scrollbar-lane";

/** Measured lane of the element's own vertical scrollbar, in CSS pixels. */
const measureScrollbarLane = (el: HTMLElement): number => {
  const style = getComputedStyle(el);
  const borderPx =
    parseFloat(style.borderLeftWidth || "0") +
    parseFloat(style.borderRightWidth || "0");
  return Math.max(0, Math.round(el.offsetWidth - el.clientWidth - borderPx));
};

/** Publish the measured lane on the element; returns the value it wrote. */
const publishScrollbarLane = (el: HTMLElement): number => {
  const lane = measureScrollbarLane(el);
  el.style.setProperty(SCROLLBAR_LANE_PROPERTY, `${lane}px`);
  return lane;
};

export { SCROLLBAR_LANE_PROPERTY, measureScrollbarLane, publishScrollbarLane };
