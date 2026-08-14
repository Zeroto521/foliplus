() => {
  const api = window.foliplus && window.foliplus.LayerAPI;
  if (!api) return null;
  const coll = api.layerRegistry;
  if (!coll) return { error: "no layerRegistry exposed" };
  const out = {};

  // Start from an empty registry so assertions are independent
  // of the map's initial layers.
  coll.replace([]);

  // Ordered-array semantics
  const a = { id: "a", name: "A" };
  const b = { id: "b", name: "B" };
  coll.prepend(a);
  coll.prepend(b); // b, a
  out.afterPrepend = { len: coll.size, first: coll.at(0).id, second: coll.at(1).id };

  // Index semantics
  out.getById = coll.get("a").name;
  out.hasA = coll.has("a");
  out.indexOfA = coll.indexOf(a);

  // Idempotent upsert keeps position
  coll.upsert({ id: "b", name: "B2" });
  out.afterUpsert = {
    len: coll.size,
    idxB: coll.indexOf(coll.get("b")),
    name: coll.get("b").name,
  };

  // Remove keeps index in sync
  coll.remove("a");
  out.afterRemove = { len: coll.size, hasA: coll.has("a"), first: coll.at(0).id };

  // Iteration preserves order
  coll.upsert({ id: "c", name: "C" });
  const ids = [];
  for (const li of coll) ids.push(li.id);
  out.iter = ids;

  // replace rebuilds both list and index
  coll.replace([
    { id: "x", name: "X" },
    { id: "y", name: "Y" },
  ]);
  out.afterReplace = {
    len: coll.size,
    hasX: coll.has("x"),
    hasOld: coll.has("b"),
    first: coll.at(0).id,
  };
  return out;
};
