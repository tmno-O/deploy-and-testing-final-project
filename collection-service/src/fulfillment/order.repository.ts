import { Injectable } from '@nestjs/common';
import { StoreService } from '../store/store.service';
import type { Order, OrderStatus } from '../store/types';

const clone = <T>(value: T): T => structuredClone(value);

/** Returns copies so callers cannot change stored orders by accident. Writes must run inside store.transaction(). */
@Injectable()
export class OrderRepository {
  constructor(private readonly store: StoreService) {}

  private record(id: string): Order | undefined {
    return this.store.data.orders.find((o) => o.id === id);
  }

  create(order: Order): Order {
    this.store.data.orders.push(clone(order));
    return clone(order);
  }

  findById(id: string): Order | undefined {
    const record = this.record(id);
    return record && clone(record);
  }

  /** Newest first. */
  listByUser(userId: string, status?: OrderStatus): Order[] {
    return this.store.data.orders
      .filter((o) => o.userId === userId && (!status || o.status === status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(clone);
  }

  update(id: string, changes: Partial<Order>): Order {
    const record = this.record(id);
    if (!record) throw new Error(`order ${id} not found`);
    Object.assign(record, clone(changes), { updatedAt: new Date().toISOString() });
    return clone(record);
  }

  remove(id: string): void {
    this.store.data.orders = this.store.data.orders.filter((o) => o.id !== id);
  }
}
