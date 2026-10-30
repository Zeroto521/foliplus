() => {
                  const el = document.querySelector(
                    '.foliplus-heatmap-ctrl .foliplus-toggle-btn'
                  );
                  const r = el.getBoundingClientRect();
                  return { x: Math.round(r.left + r.width / 2),
                           y: Math.round(r.top + r.height / 2) };
                }
