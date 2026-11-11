// Minimal in-memory Firestore for route tests: collections, docs, get/create/set(merge),
// equality queries (dotted paths) and transactions that buffer writes until commit.
function read(data, path) { return path.split('.').reduce((value, key) => (value && typeof value === 'object' ? value[key] : undefined), data); }
function deepMerge(target, patch) {
  const out = { ...target };
  for (const [key, value] of Object.entries(patch)) out[key] = value && typeof value === 'object' && !Array.isArray(value) && out[key] && typeof out[key] === 'object' ? deepMerge(out[key], value) : value;
  return out;
}

export function createFakeFirestore(seed = {}) {
  const store = new Map(Object.entries(seed).map(([name, docs]) => [name, new Map(Object.entries(docs))]));
  const writes = [];
  const col = (name) => { if (!store.has(name)) store.set(name, new Map()); return store.get(name); };
  const snapshot = (name, id) => {
    const data = col(name).get(id);
    return { exists: data !== undefined, id, data: () => data, get: (field) => (data === undefined ? undefined : read(data, field)) };
  };
  const apply = (op) => {
    const docs = col(op.name);
    if (op.type === 'create') { if (docs.has(op.id)) throw new Error('ALREADY_EXISTS'); docs.set(op.id, op.data); }
    else if (op.type === 'set') docs.set(op.id, op.merge && docs.has(op.id) ? deepMerge(docs.get(op.id), op.data) : op.data);
    writes.push({ type: op.type, collection: op.name, id: op.id, data: op.data, merge: Boolean(op.merge) });
  };
  const docRef = (name, id) => ({
    __kind: 'doc', id, collection: name,
    get: async () => snapshot(name, id),
    create: async (data) => apply({ type: 'create', name, id, data }),
    set: async (data, options) => apply({ type: 'set', name, id, data, merge: options?.merge }),
  });
  const query = (name, filters = [], max = Infinity) => ({
    __kind: 'query',
    where: (field, op, value) => { if (op !== '==') throw new Error('Only equality queries are supported'); return query(name, [...filters, [field, value]], max); },
    limit: (n) => query(name, filters, n),
    get: async () => {
      const docs = [...col(name).entries()].filter(([, data]) => filters.every(([field, value]) => read(data, field) === value)).slice(0, max).map(([id]) => snapshot(name, id));
      return { empty: docs.length === 0, docs, size: docs.length };
    },
  });
  const collection = (name) => ({ ...query(name), doc: (id) => docRef(name, id) });
  return {
    collection,
    writes,
    docs: (name) => Object.fromEntries(col(name)),
    runTransaction: async (work) => {
      const pending = [];
      const tx = {
        get: async (target) => (target.__kind === 'doc' ? snapshot(target.collection, target.id) : target.get()),
        create: (ref, data) => pending.push({ type: 'create', name: ref.collection, id: ref.id, data }),
        set: (ref, data, options) => pending.push({ type: 'set', name: ref.collection, id: ref.id, data, merge: options?.merge }),
      };
      const result = await work(tx);
      for (const op of pending) apply(op);
      return result;
    },
  };
}
