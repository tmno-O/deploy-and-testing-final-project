import { Inject, Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import type { WalletData } from './types';

const COLLECTIONS: (keyof WalletData)[] = ['wallets', 'transactions'];

function emptyData(): WalletData {
  return { wallets: [], transactions: [] };
}

const clone = <T>(value: T): T => structuredClone(value);

/**
 * In-memory store backed by a JSON file (no database yet). Every write goes through `transaction()`:
 * transactions run one at a time, and if the callback throws, the data is rolled back and nothing is saved.
 * That mutex is what makes "check balance, then debit" safe against two requests arriving together.
 */
@Injectable()
export class StoreService {
  data: WalletData;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.data = this.load();
  }

  private load(): WalletData {
    const file = this.config.data.file;
    if (!fs.existsSync(file)) return emptyData();
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<WalletData>;
    const data = emptyData();
    for (const name of COLLECTIONS) {
      if (Array.isArray(parsed[name])) (data[name] as unknown[]) = parsed[name];
    }
    return data;
  }

  /** Atomic write (temp file + rename) so a crash cannot leave a half-written ledger. */
  save(): void {
    if (!this.config.data.persist) return;
    const file = this.config.data.file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
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
  reset(data: Partial<WalletData> = {}): void {
    this.data = { ...emptyData(), ...clone(data) };
  }

  isReady(): boolean {
    return COLLECTIONS.every((name) => Array.isArray(this.data[name]));
  }
}
