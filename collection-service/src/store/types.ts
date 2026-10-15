export const RARITIES = ['common', 'rare', 'epic', 'legendary'] as const;
export type Rarity = (typeof RARITIES)[number];

export const ORDER_STATUSES = ['PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type PaymentStatus = 'NOT_REQUIRED' | 'PAID' | 'REFUNDED';

/** Card details copied from the catalog when the card first enters a collection. */
export interface CardInfo {
  cardId: string;
  cardName: string;
  cardRarity: Rarity;
  cardImageUrl: string;
}

export interface CollectionRecord extends CardInfo {
  id: string;
  userId: string;
  quantity: number;
  /** cards held by an order that is not cancelled; available = quantity - redeemedQuantity */
  redeemedQuantity: number;
  createdAt: string;
  updatedAt: string;
}

/** One Gacha pull already applied; makes POST /internal/collections/:userId/cards idempotent. */
export interface PullRecord {
  pullId: string;
  userId: string;
  cardId: string;
  quantity: number;
  createdAt: string;
}

export interface ShippingAddress {
  recipientName: string;
  phone: string;
  line1: string;
  line2?: string;
  subdistrict?: string;
  district: string;
  province: string;
  postalCode: string;
}

export interface OrderItem {
  cardId: string;
  cardName: string;
  quantity: number;
}

export interface Order {
  id: string;
  userId: string;
  items: OrderItem[];
  addressId: string | null;
  shippingAddress: ShippingAddress;
  shippingFee: number;
  status: OrderStatus;
  trackingNumber: string | null;
  paymentStatus: PaymentStatus;
  paymentRef: string | null;
  statusHistory: { status: OrderStatus; at: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface CollectionData {
  collections: CollectionRecord[];
  pulls: PullRecord[];
  orders: Order[];
}
