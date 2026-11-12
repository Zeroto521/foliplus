// Select a by-value field from the fill drawer's field select, like a user
// choosing a column. The option text carries the kind label (e.g.
// "NAME_3 (分类)"), so the caller passes the bare field name and this matches
// either the option value or the text prefix. Returns the committed value.
arg => {
  const { field } = arg ?? {};
  const s = document.querySelector(".foliplus-style-fill-field-select");
  if (!s) return { ok: false, reason: "no-field-select" };
  const opt = [...s.options].find(
    o => o.value === field || o.text.startsWith(field + " "),
  );
  if (!opt) {
    return {
      ok: false,
      reason: "no-such-field",
      field,
      options: [...s.options].map(o => o.text),
    };
  }
  s.value = opt.value;
  s.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true, field: opt.value };
};
