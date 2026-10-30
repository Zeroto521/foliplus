// Reads the layer dropdown trigger's ink state and compares it to the
// native select the trigger replaces. Used to prove the placeholder prompt
// ("Select a point layer") keeps the muted ink instead of inheriting the
// value ink from .foliplus-form-select, and that a picked layer switches
// back to the value ink at the same weight.
() => {
  const ctrl = document.querySelector('.foliplus-heatmap-ctrl');
  if (!ctrl) return { ok: false, reason: 'no-ctrl' };
  const select = ctrl.querySelector('select[data-heatmap-layer]');
  const row = select ? select.closest('.foliplus-form-row') : null;
  const trigger = row ? row.querySelector('.foliplus-dropdown-trigger') : null;
  if (!select || !trigger) return { ok: false, reason: 'no-trigger' };
  const t = getComputedStyle(trigger);
  const native = getComputedStyle(select);
  const placeholderClass = trigger.classList.contains('foliplus-dropdown-placeholder');
  return {
    ok: true,
    placeholder: placeholderClass,
    label: (trigger.textContent || '').trim(),
    nativeLabel: select.options[select.selectedIndex]
      ? (select.options[select.selectedIndex].textContent || '').trim()
      : '',
    triggerColor: t.color,
    triggerWeight: t.fontWeight,
    nativeColor: native.color,
    nativeWeight: native.fontWeight,
  };
};
