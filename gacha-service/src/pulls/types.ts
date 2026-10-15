export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

/** PENDING = จองสต็อกแล้ว · PAID = หักเงินแล้ว · COMPLETED = การ์ดเข้า Collection ครบ · FAILED = ล้มเหลว (คืนเงิน/คืนสต็อกแล้ว) */
export type PullStatus = 'PENDING' | 'PAID' | 'COMPLETED' | 'FAILED';

export interface PulledCard {
  cardId: string;
  cardName: string;
  rarity: Rarity;
  imageUrl: string;
  /** pullId ที่ใช้ส่งให้ Collection (ต้องไม่ซ้ำต่อการ์ดแต่ละใบ ใช้ซ้ำเมื่อ retry) */
  collectionPullId: string;
  delivered: boolean;
}

export interface PullRecord {
  id: string; // pullId (UUID v4)
  userId: string;
  packId: string;
  status: PullStatus;
  price: number | null;
  cards: PulledCard[];
  reservationId: string | null;
  walletTransactionId: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GachaData {
  pulls: PullRecord[];
}