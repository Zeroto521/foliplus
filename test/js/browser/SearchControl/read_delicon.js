() => {
  const x = document.querySelector("[data-del-icon].visible");
  return {
    delIconVisible: x !== null,
    inputValue: document.querySelector("input")?.value ?? null,
  };
};
