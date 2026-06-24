(function() {
  const map = {{ this._parent.get_name() }};
  const SM = window._mapShared;
  const _ = (key) => _LOCALE[key] || key;

  // Fullscreen icon: four-corner arrows
  const SVG_FULLSCREEN = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2" stroke-linecap="round"
      stroke-linejoin="round">
      <polyline points="15 3 21 3 21 9"/>
      <polyline points="9 21 3 21 3 15"/>
      <line x1="21" y1="3" x2="14" y2="10"/>
      <line x1="3" y1="21" x2="10" y2="14"/>
    </svg>`;

  SM.registerHintIcon('fullscreen', SVG_FULLSCREEN);

  // Create the fullscreen control and get its container
  const fsControl = L.control.fullscreen({
    position: '{{ this.position }}',
    title: '{{ this.locale.get("fullscreen.title") }}',
    title_cancel: '{{ this.locale.get("fullscreen.title_cancel") }}',
    force_separate_button: false,
  }).addTo(map);
  const fsContainer = fsControl.getContainer();

  // Replace the default icon and intercept default fullscreen logic
  (function replaceIcon() {
    const btn = document.querySelector('.leaflet-control-zoom-fullscreen')
      || fsContainer?.querySelector('a, button');

    if (!btn) {
      setTimeout(replaceIcon, 100);
      return;
    }

    btn.innerHTML = SVG_FULLSCREEN;
    btn.style.backgroundImage = 'none';

    // Break native event bindings by cloning and replacing the button
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);

    newBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        map.getContainer().requestFullscreen();
      }
    });
  })();

  // Listen for Fullscreen API state changes
  const handleFullscreenChange = () => {
    const isFull = !!document.fullscreenElement;

    // Toggle visibility of sibling controls
    const controls = map.getContainer()
      .querySelectorAll('.leaflet-control, .custom-scale-wrap');

    for (const c of controls) {
      // Hide/show self based on backend template parameter
      if (c === fsContainer || fsContainer.contains(c)) {
        if ({{ this.hide_self | tojson }}) {
          c.style.display = isFull ? 'none' : '';
        }
        continue;
      }
      c.style.display = isFull ? 'none' : '';
    }

    SM.showHint(
      'fullscreen',
      isFull ? _('fullscreen.enter') : _('fullscreen.exit'),
      2500
    );
  };

  document.addEventListener('fullscreenchange', handleFullscreenChange);
})();
