// Snapshot of Leaflet's own zoom control: whether the node marked by
// `mark_zoom_control_node` is still the rendered one, still connected, and
// still hosted by the same map corner. Used before and after a fullscreen
// session to prove the control never touches it.
() => {
  const node = document.querySelector(".leaflet-control-zoom");
  const marked = window.__foliplusZoomControl;
  return {
    present: Boolean(node),
    same: Boolean(marked && node === marked),
    connected: Boolean(marked && marked.isConnected),
    parent: node && node.parentElement ? node.parentElement.className : "",
  };
};
