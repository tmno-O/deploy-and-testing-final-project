import { Inject, Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import type { CollectionData } from './types';

const COLLECTIONS: (keyof CollectionData)[] = ['collections', 'pulls', 'orders'];

function emptyData(): CollectionData {
  return { collections: [], pulls: [], orders: [] };
}

const clone = <T>(value: T): T => structuredClone(value);

/**
 * In-memory store backed by a JSON file (mock data). Every write goes through `transaction()`:
 * transactions run one at a time, and if the callback throws, the data is rolled back and nothing is saved.
 */
@Injectable()
export class StoreService {
  data: CollectionData;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.data = this.load();
  }

  private load(): CollectionData {
    const file = this.config.data.file;
    if (!fs.existsSync(file)) return emptyData();
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<CollectionData>;
    const data = emptyData();
    for (const name of COLLECTIONS) {
      if (Array.isArray(parsed[name])) (data[name] as unknown[]) = parsed[name];
    }
    return data;
  }

  /** Atomic write (temp file + rename) so a crash cannot leave a half-written file. */
  save(): void {
    if (!this.config.data.persist) return;
    const file = this.config.data.file;
    const tmp = path.join(path.dirname(file), `.${path.basename(file)}.tmp`);
    fs.writeFileSync(tmp, `${JSON.stringify(this.data, null, 2)}\n`);
    fs.renameSync(tmp, file);
  }

  /** Runs `fn` alone (mutex). Saves on success, restores the previous data if it throws. */
  transaction<T>(fn: () => T | Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const snapshot = clone(this.data);
      try {
        const result = await fn();
        this.save();
        return result;
      } catch (err) {
        this.data = snapshot;
        throw err;
      }
    });
    // the queue keeps going even if this transaction failed
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Used by tests to start from a known state. */
  reset(data: Partial<CollectionData> = {}): void {
    this.data = { ...emptyData(), ...clone(data) };
  }

  isReady(): boolean {
    return COLLECTIONS.every((name) => Array.isArray(this.data[name]));
  }
}
