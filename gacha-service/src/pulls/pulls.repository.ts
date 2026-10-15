import { Injectable } from '@nestjs/common';
import { StoreService } from '../store/store.service';
import type { PullRecord } from './types';

@Injectable()
export class PullsRepository {
  constructor(private readonly store: StoreService) {}

  find(id: string): PullRecord | undefined {
    return this.store.data.pulls.find((p) => p.id === id);
  }

  insert(pull: PullRecord): void {
    this.store.data.pulls.push(pull);
    this.store.save();
  }

  /** `pull` is the object held in memory: change it, then call save */
  save(pull: PullRecord): void {
    pull.updatedAt = new Date().toISOString();
    this.store.save();
  }

  /** newest first */
  listByUser(userId: string): PullRecord[] {
    return this.store.data.pulls.filter((p) => p.userId === userId).reverse();
  }
}