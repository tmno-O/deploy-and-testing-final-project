import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { UserClient } from '../clients/user.client';
import { WalletClient, type PaymentResult } from '../clients/wallet.client';
import { CollectionRepository } from '../collection/collection.repository';
import { conflict, notFound } from '../common/app-error';
import { paginate, parseOrThrow } from '../common/parse';
import type { CallContext } from '../common/request-context';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { StoreService } from '../store/store.service';
import type { Order, OrderItem, OrderStatus, ShippingAddress } from '../store/types';
import {
  createOrderBody,
  adminListOrdersQuery,
  listOrdersQuery,
  orderIdParam,
  updateStatusBody,
  type CreateOrderBody,
} from './fulfillment.schemas';
import { OrderRepository } from './order.repository';
import { calculateShipping } from './shipping';
import { assertTransition, type Actor } from './state-machine';

const ADDRESS_FIELDS: (keyof ShippingAddress)[] = [
  'recipientName',
  'phone',
  'line1',
  'line2',
  'subdistrict',
  'district',
  'province',
  'postalCode',
];

/** Copy of the address at order time: later edits in the User Service do not change the order. */
function snapshotAddress(address: Record<string, unknown>): ShippingAddress {
  const out: Record<string, unknown> = {};
  for (const key of ADDRESS_FIELDS) {
    if (address[key] !== undefined && address[key] !== null) out[key] = address[key];
  }
  return out as unknown as ShippingAddress;
}

@Injectable()
export class FulfillmentService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly store: StoreService,
    private readonly collections: CollectionRepository,
    private readonly orders: OrderRepository,
    private readonly users: UserClient,
    private readonly wallet: WalletClient,
  ) {}

  async create(userId: string, rawBody: unknown, ctx: CallContext): Promise<Order> {
    const body = parseOrThrow(createOrderBody, rawBody);
    const { shippingFee } = calculateShipping(body.items, this.config.shipping);
    // address first: if the User Service is down, no card is touched
    const address = await this.resolveAddress(body, ctx);

    const now = new Date().toISOString();
    const order = await this.store.transaction(() =>
      this.orders.create({
        id: randomUUID(),
        userId,
        items: this.reserveCards(userId, body.items),
        ...address,
        shippingFee,
        status: 'PENDING',
        trackingNumber: null,
        paymentStatus: 'NOT_REQUIRED',
        paymentRef: null,
        statusHistory: [{ status: 'PENDING', at: now }],
        createdAt: now,
        updatedAt: now,
      }),
    );

    if (shippingFee === 0 || !this.wallet.isEnabled()) return order;

    // charge the shipping fee; on failure (low balance / wallet down) release the cards and drop the order
    try {
      const payment = await this.wallet.charge(userId, shippingFee, order.id, ctx);
      return await this.store.transaction(() =>
        this.orders.update(order.id, { paymentStatus: payment.status, paymentRef: payment.transactionId }),
      );
    } catch (err) {
      await this.store.transaction(() => {
        this.collections.adjustRedeemed(userId, order.items, -1);
        this.orders.remove(order.id);
      });
      throw err;
    }
  }

  list(userId: string, rawQuery: unknown) {
    const query = parseOrThrow(listOrdersQuery, rawQuery);
    return paginate(this.orders.listByUser(userId, query.status), query);
  }

  /** Someone else's order answers 404, the same as a missing one (does not reveal that it exists). */
  getOwned(userId: string, rawId: unknown): Order {
    const id = parseOrThrow(orderIdParam, rawId);
    const order = this.orders.findById(id);
    if (!order || order.userId !== userId) throw notFound('Order not found', 'ORDER_NOT_FOUND');
    return order;
  }

  cancel(userId: string, rawId: unknown, ctx: CallContext): Promise<Order> {
    return this.changeStatus(this.getOwned(userId, rawId), 'CANCELLED', 'user', undefined, ctx);
  }

  /** Every user's orders for the admin queue (filter by status and/or userId). */
  adminList(rawQuery: unknown) {
    const query = parseOrThrow(adminListOrdersQuery, rawQuery);
    return paginate(this.orders.list({ userId: query.userId, status: query.status }), query);
  }

  adminGet(rawId: unknown): Order {
    const id = parseOrThrow(orderIdParam, rawId);
    const order = this.orders.findById(id);
    if (!order) throw notFound('Order not found', 'ORDER_NOT_FOUND');
    return order;
  }

  adminUpdateStatus(rawId: unknown, rawBody: unknown, ctx: CallContext): Promise<Order> {
    const id = parseOrThrow(orderIdParam, rawId);
    const { status, trackingNumber } = parseOrThrow(updateStatusBody, rawBody);
    const order = this.orders.findById(id);
    if (!order) throw notFound('Order not found', 'ORDER_NOT_FOUND');
    return this.changeStatus(order, status, 'admin', trackingNumber, ctx);
  }

  private async resolveAddress(body: CreateOrderBody, ctx: CallContext) {
    if (body.shippingAddress) return { addressId: null, shippingAddress: snapshotAddress(body.shippingAddress) };
    const addressId = body.addressId as string; // the schema guarantees exactly one of the two
    return { addressId, shippingAddress: snapshotAddress(await this.users.getAddress(addressId, ctx)) };
  }

  /** Checks every line first, then holds them all at once: one short line means nothing is held. */
  private reserveCards(userId: string, items: { cardId: string; quantity: number }[]): OrderItem[] {
    const shortages: { cardId: string; requested: number; available: number }[] = [];
    const lines: OrderItem[] = [];
    for (const item of items) {
      const record = this.collections.find(userId, item.cardId);
      const available = record ? record.quantity - record.redeemedQuantity : 0;
      if (!record || available < item.quantity) {
        shortages.push({ cardId: item.cardId, requested: item.quantity, available });
      } else {
        lines.push({ cardId: item.cardId, cardName: record.cardName, quantity: item.quantity });
      }
    }
    if (shortages.length > 0) throw conflict('INSUFFICIENT_QUANTITY', 'Not enough cards available to redeem', shortages);
    this.collections.adjustRedeemed(userId, items, 1);
    return lines;
  }

  private async changeStatus(
    order: Order,
    to: OrderStatus,
    actor: Actor,
    trackingNumber: string | undefined,
    ctx: CallContext,
  ): Promise<Order> {
    assertTransition(order.status, to, { actor, trackingNumber });

    // refund before changing status: if the wallet is down the order keeps its status and can be retried (same key)
    let refund: PaymentResult | null = null;
    if (to === 'CANCELLED' && order.paymentStatus === 'PAID') {
      refund = await this.wallet.refund(order.userId, order.shippingFee, order.id, ctx);
    }

    return this.store.transaction(() => {
      const current = this.orders.findById(order.id);
      if (!current) throw notFound('Order not found', 'ORDER_NOT_FOUND');
      // someone may have changed the status while we waited on the wallet
      assertTransition(current.status, to, { actor, trackingNumber });
      if (to === 'CANCELLED') this.collections.adjustRedeemed(current.userId, current.items, -1);

      const changes: Partial<Order> = {
        status: to,
        statusHistory: [...current.statusHistory, { status: to, at: new Date().toISOString() }],
      };
      if (trackingNumber) changes.trackingNumber = trackingNumber;
      if (refund?.status === 'REFUNDED') changes.paymentStatus = 'REFUNDED';
      return this.orders.update(current.id, changes);
    });
  }
}
