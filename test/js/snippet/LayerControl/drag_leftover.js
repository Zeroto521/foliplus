() =>
  [...document.querySelectorAll("[data-foliplus-drop],[data-foliplus-push]")].map(
    row =>
      `${row.getAttribute("data-foliplus-drop") ?? ""}/${row.getAttribute("data-foliplus-push") ?? ""}`,
  );
