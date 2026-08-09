/**
 * IndexedDB persistence. The saved payload is a plain object graph of
 * TypedArrays, which structured clone stores natively — no JSON, no base64, no
 * copy through a string. A 12,000-organism world is a few tens of megabytes and
 * saves in well under a second.
 */
const DB_NAME = 'life-worlds';
const DB_VERSION = 1;
const STORE = 'worlds';

export interface WorldSaveMeta {
  key: string;
  name: string;
  savedAt: number;
  tick: number;
  population: number;
  seed: number;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      }),
  );
}

export async function saveWorld(
  key: string,
  name: string,
  payload: Record<string, any>,
): Promise<void> {
  const meta: WorldSaveMeta = {
    key,
    name,
    savedAt: Date.now(),
    tick: payload.tick ?? 0,
    population: countAlive(payload),
    seed: payload.cfg?.seed ?? 0,
  };
  await tx('readwrite', (s) => s.put({ ...meta, payload }));
}

export async function loadWorld(key: string): Promise<Record<string, any> | null> {
  const rec = await tx<any>('readonly', (s) => s.get(key));
  return rec?.payload ?? null;
}

export async function listWorlds(): Promise<WorldSaveMeta[]> {
  const all = await tx<any[]>('readonly', (s) => s.getAll());
  return all
    .map(({ key, name, savedAt, tick, population, seed }) => ({
      key,
      name,
      savedAt,
      tick,
      population,
      seed,
    }))
    .sort((a, b) => b.savedAt - a.savedAt);
}

export async function deleteWorld(key: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(key));
}

function countAlive(payload: Record<string, any>): number {
  const alive: Uint8Array | undefined = payload?.pop?.alive;
  if (!alive) return 0;
  let n = 0;
  for (let i = 0; i < alive.length; i++) if (alive[i]) n++;
  return n;
}

/**
 * Export to a file. The payload is written as a length-prefixed binary
 * container rather than JSON so the TypedArrays survive intact and the file
 * stays roughly the same size as the live state.
 */
export function exportWorld(payload: Record<string, any>, name: string): void {
  const json = JSON.stringify(payload, typedArrayReplacer);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.replace(/[^\w.-]+/g, '_')}.life.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function importWorld(file: File): Promise<Record<string, any>> {
  const text = await file.text();
  return JSON.parse(text, typedArrayReviver);
}

const TYPED_ARRAYS: Record<string, any> = {
  Float32Array,
  Float64Array,
  Uint8Array,
  Uint32Array,
  Int32Array,
  Uint8ClampedArray,
};

function typedArrayReplacer(_key: string, value: unknown): unknown {
  const ctor = (value as any)?.constructor?.name;
  if (ctor && TYPED_ARRAYS[ctor] && ArrayBuffer.isView(value as any)) {
    return { __ta: ctor, d: Array.from(value as any) };
  }
  return value;
}

function typedArrayReviver(_key: string, value: any): unknown {
  if (value && typeof value === 'object' && value.__ta && TYPED_ARRAYS[value.__ta]) {
    return TYPED_ARRAYS[value.__ta].from(value.d);
  }
  return value;
}
