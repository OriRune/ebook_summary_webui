/**
 * IndexedDB persistence for run state (sections + results + character list).
 * Book text can be multiple MB, which overflows localStorage's ~5MB quota, so
 * the heavy run state lives here; settings/keys/dark-mode stay in localStorage.
 * A single "current" record holds the whole run.
 */
import { openDB, type IDBPDatabase } from "idb";
import type { CharacterSummary, Section, SectionResult } from "@/types";

const DB_NAME = "ebook-summarizer";
const STORE = "run";
const KEY = "current";

export interface PersistedRun {
  fileStem: string;
  title: string;
  author: string;
  sections: Section[];
  checked: boolean[];
  results: Record<number, SectionResult>;
  characterList: CharacterSummary[];
  characterListError: string | null;
  selectedIdx: number | null;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      },
    });
  }
  return dbPromise;
}

export async function saveRun(run: PersistedRun): Promise<void> {
  if (typeof window === "undefined") return;
  const db = await getDb();
  await db.put(STORE, run, KEY);
}

export async function loadRun(): Promise<PersistedRun | null> {
  if (typeof window === "undefined") return null;
  const db = await getDb();
  const run = (await db.get(STORE, KEY)) as PersistedRun | undefined;
  return run ?? null;
}

export async function clearRun(): Promise<void> {
  if (typeof window === "undefined") return;
  const db = await getDb();
  await db.delete(STORE, KEY);
}
