() => {
  const api = window.foliplus && window.foliplus.LayerAPI;
  if (!api) return null;
  const out = {};

  // Read operations still work
  out.length = api.layers.length;
  out.firstId = api.layers[0] ? api.layers[0].id : null;
  out.mapped = api.layers.map(l => l.id).length;

  // Direct mutations must throw
  out.pushThrew = false;
  try {
    api.layers.push({ id: "nope" });
  } catch (e) {
    out.pushThrew = true;
  }

  out.spliceThrew = false;
  try {
    api.layers.splice(0, 1);
  } catch (e) {
    out.spliceThrew = true;
  }

  out.assignThrew = false;
  try {
    api.layers[0] = { id: "nope" };
  } catch (e) {
    out.assignThrew = true;
  }

  out.shiftThrew = false;
  try {
    api.layers.shift();
  } catch (e) {
    out.shiftThrew = true;
  }

  return out;
};
