import { Inject, Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import type { GachaData } from '../pulls/types';

function emptyData(): GachaData {
  return { pulls: [] };
}

/** In-memory store backed by a JSON file. Repositories read/write `data` and call `save()`. */
@Injectable()
export class StoreService {
  data: GachaData;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.data = this.load();
  }

  private load(): GachaData {
    const file = this.config.data.file;
    if (!fs.existsSync(file)) return emptyData();
    return { ...emptyData(), ...(JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<GachaData>) };
  }

  /** Atomic write (temp file + rename) so a crash cannot leave a half-written file. */
  save(): void {
    if (!this.config.data.persist) return;
    const file = this.config.data.file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = path.join(path.dirname(file), `.${path.basename(file)}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, file);
  }

  /** Used by tests to start from a known state. */
  reset(data: Partial<GachaData> = {}): void {
    this.data = { ...emptyData(), ...data };
  }

  isReady(): boolean {
    return Array.isArray(this.data.pulls);
  }
}