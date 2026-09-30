// Inject the three button kinds the radius guard covers and report their ids.
// The buttons are bare foliplus classes (no component shell), so the shared
// button.css recipes apply exactly as they would on a real control.
() => {
  const host = document.createElement("div");
  host.innerHTML =
    '<button class="foliplus-toggle-btn" id="tb">T</button>' +
    '<button class="foliplus-tool-btn" id="tool">M</button>' +
    '<button class="foliplus-panel-btn" id="panel">P</button>';
  host.style.cssText =
    "position:absolute;left:120px;top:120px;display:flex;gap:20px";
  document.body.appendChild(host);
  return ["tb", "tool", "panel"];
}
