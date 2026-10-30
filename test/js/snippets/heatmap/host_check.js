() => {
                  const list = [...document.querySelectorAll('.foliplus-dropdown-list')]
                    .find(l => !l.hidden);
                  if (!list) return null;
                  const host = list.parentElement;
                  const container = document.querySelector('.leaflet-container');
                  return {
                    hostClass: String(host.className),
                    hostIsContainer: host === container,
                    pseudoActive: container.classList.contains('leaflet-pseudo-fullscreen'),
                  };
                }
