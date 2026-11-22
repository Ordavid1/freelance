// Minimal in-memory Firestore for route tests: collections, docs, get/create/set(merge)/update/delete,
// getAll, equality queries (dotted paths) and transactions. A transaction buffers its writes until commit and,
// like the real one, re-runs when a collection it read was written by someone else in the meantime.
export const DELETE_FIELD = Symbol('delete-field');

const isPlain = (value) => Object.prototype.toString.call(value) === '[object Object]';
function read(data, path) { return path.split('.').reduce((value, key) => (value && typeof value === 'object' ? value[key] : undefined), data); }
function deepMerge(target, patch) {
  const out = { ...target };
  for (const [key, value] of Object.entries(patch)) out[key] = isPlain(value) && isPlain(out[key]) ? deepMerge(out[key], value) : value;
  return out;
}
// Firestore update(): top-level keys may be dotted field paths; the delete sentinel removes the field.
function applyUpdate(target, patch) {
  const out = structuredClone(target);
  for (const [path, value] of Object.entries(patch)) {
    const keys = path.split('.');
    let node = out;
    for (const key of keys.slice(0, -1)) { if (!node[key] || typeof node[key] !== 'object') node[key] = {}; node = node[key]; }
    if (value === DELETE_FIELD) delete node[keys.at(-1)]; else node[keys.at(-1)] = value;
  }
  return out;
}
function withoutDeletes(data) {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== DELETE_FIELD).map(([key, value]) => [key, isPlain(value) ? withoutDeletes(value) : value]));
}

export function createFakeFirestore(seed = {}) {
  const store = new Map(Object.entries(seed).map(([name, docs]) => [name, new Map(Object.entries(docs))]));
  const versions = new Map();
  const writes = [];
  let autoId = 0;
  const col = (name) => { if (!store.has(name)) store.set(name, new Map()); return store.get(name); };
  const snapshot = (name, id) => {
    const data = col(name).get(id);
    return { exists: data !== undefined, id, ref: docRef(name, id), data: () => data, get: (field) => (data === undefined ? undefined : read(data, field)) };
  };
  const apply = (op) => {
    const docs = col(op.name);
    if (op.type === 'create') { if (docs.has(op.id)) throw new Error('ALREADY_EXISTS'); docs.set(op.id, withoutDeletes(op.data)); }
    else if (op.type === 'set') docs.set(op.id, op.merge && docs.has(op.id) ? deepMerge(docs.get(op.id), withoutDeletes(op.data)) : withoutDeletes(op.data));
    else if (op.type === 'update') { if (!docs.has(op.id)) throw new Error('NOT_FOUND'); docs.set(op.id, applyUpdate(docs.get(op.id), op.data)); }
    else if (op.type === 'delete') docs.delete(op.id);
    versions.set(op.name, (versions.get(op.name) || 0) + 1);
    writes.push({ type: op.type, collection: op.name, id: op.id, data: op.data, merge: Boolean(op.merge) });
  };
  const docRef = (name, id) => ({
    __kind: 'doc', id, collection: name,
    get: async () => snapshot(name, id),
    create: async (data) => apply({ type: 'create', name, id, data }),
    set: async (data, options) => apply({ type: 'set', name, id, data, merge: options?.merge }),
    update: async (data) => apply({ type: 'update', name, id, data }),
    delete: async () => apply({ type: 'delete', name, id }),
  });
  const query = (name, filters = [], max = Infinity) => ({
    __kind: 'query', collection: name,
    where: (field, op, value) => { if (op !== '==') throw new Error('Only equality queries are supported'); return query(name, [...filters, [field, value]], max); },
    limit: (n) => query(name, filters, n),
    get: async () => {
      const docs = [...col(name).entries()].filter(([, data]) => filters.every(([field, value]) => read(data, field) === value)).slice(0, max).map(([id]) => snapshot(name, id));
      return { empty: docs.length === 0, docs, size: docs.length };
    },
  });
  const collection = (name) => ({
    ...query(name),
    doc: (id = `auto-${++autoId}`) => docRef(name, id),
    add: async (data) => { const id = `auto-${++autoId}`; apply({ type: 'create', name, id, data }); return docRef(name, id); },
  });
  return {
    collection,
    writes,
    docs: (name) => Object.fromEntries(col(name)),
    getAll: async (...refs) => refs.map((ref) => snapshot(ref.collection, ref.id)),
    runTransaction: async (work) => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const pending = [];
        const seen = new Map();
        const touch = (name) => { if (!seen.has(name)) seen.set(name, versions.get(name) || 0); };
        const tx = {
          get: async (target) => { touch(target.collection); return target.__kind === 'doc' ? snapshot(target.collection, target.id) : target.get(); },
          create: (ref, data) => pending.push({ type: 'create', name: ref.collection, id: ref.id, data }),
          set: (ref, data, options) => pending.push({ type: 'set', name: ref.collection, id: ref.id, data, merge: options?.merge }),
          update: (ref, data) => pending.push({ type: 'update', name: ref.collection, id: ref.id, data }),
          delete: (ref) => pending.push({ type: 'delete', name: ref.collection, id: ref.id }),
        };
        const result = await work(tx);
        // Commit only if nothing this transaction read changed meanwhile; otherwise run it again.
        if ([...seen].some(([name, version]) => (versions.get(name) || 0) !== version)) continue;
        for (const op of pending) apply(op);
        return result;
      }
      throw new Error('ABORTED: too much contention');
    },
  };
}
