() =>
  [...document.querySelectorAll("[data-foliplus-drop]")].map(row =>
    row.getAttribute("data-foliplus-drop"),
  );
