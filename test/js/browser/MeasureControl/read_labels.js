() => {
  return Array.from(document.querySelectorAll(".foliplus-measure-label")).map(
    el => el.textContent,
  );
};
