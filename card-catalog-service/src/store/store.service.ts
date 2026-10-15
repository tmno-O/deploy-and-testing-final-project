import { Inject, Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import type { CatalogData } from '../catalog/types';

const COLLECTIONS: (keyof CatalogData)[] = ['cards', 'packs', 'stock', 'reservations'];

function emptyData(): CatalogData {
  return { cards: [], packs: [], stock: [], reservations: [] };
}

/** In-memory store backed by a JSON file (mock data). Repositories read/write `data` and call `save()`. */
@Injectable()
export class StoreService {
  data: CatalogData;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.data = this.load();
  }

  private load(): CatalogData {
    const file = this.config.data.file;
    if (!fs.existsSync(file)) return emptyData();
    return { ...emptyData(), ...(JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<CatalogData>) };
  }

  /** Atomic write (temp file + rename) so a crash cannot leave a half-written file. */
  save(): void {
    if (!this.config.data.persist) return;
    const file = this.config.data.file;
    const tmp = path.join(path.dirname(file), `.${path.basename(file)}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, file);
  }

  /** Used by tests to start from a known state. */
  reset(data: Partial<CatalogData> = {}): void {
    this.data = { ...emptyData(), ...data };
  }

  isReady(): boolean {
    return COLLECTIONS.every((name) => Array.isArray(this.data[name]));
  }
}
