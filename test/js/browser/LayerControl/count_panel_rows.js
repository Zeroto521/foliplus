() => {
  const role = "overlay";
  const headers = document.querySelectorAll('.foliplus-layer-toggle-all[data-role="' + role + '"]');
  const items = document.querySelectorAll('.foliplus-layer-item[data-role="' + role + '"]');
  return { headerCount: headers.length, itemCount: items.length };
}
