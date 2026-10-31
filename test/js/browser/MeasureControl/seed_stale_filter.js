() => {
  const mm = window.__measureManager;
  localStorage.setItem(
    mm.filterStorageKey,
    JSON.stringify({
      version: 1,
      filter: { kind: "enum", field: "type", values: ["bogus"] },
    }),
  );
};
