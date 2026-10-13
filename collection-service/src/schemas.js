const { z } = require('zod');

const RARITIES = ['COMMON', 'RARE', 'SUPER_RARE', 'ULTRA_RARE', 'SECRET_RARE'];
const ORDER_STATUSES = ['PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'];

// Catalog เป็นเจ้าของรูปแบบ cardId (เช่น CARD-001) ฝั่งนี้จึงตรวจแค่ตัวอักษรที่ปลอดภัย
const cardId = z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Invalid cardId');
const uuid = (label) => z.string().uuid(`Invalid ${label}`);

// copy จาก user-service/src/schemas.js เพื่อให้ที่อยู่รูปแบบเดียวกัน
const phone = z.string().trim().regex(/^[0-9+\-\s]{8,20}$/, 'Invalid phone number');
const postalCode = z.string().trim().regex(/^\d{5}$/, 'Postal code must be 5 digits');
const shippingAddress = z
  .object({
    recipientName: z.string().trim().min(1).max(100),
    phone,
    line1: z.string().trim().min(1).max(255),
    line2: z.string().trim().max(255).optional(),
    subdistrict: z.string().trim().max(100).optional(),
    district: z.string().trim().min(1).max(100),
    province: z.string().trim().min(1).max(100),
    postalCode,
  })
  .strict();

const pagination = {
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
};

const listCollection = z.object({ ...pagination, rarity: z.enum(RARITIES).optional() }).strict();
const listOrders = z.object({ ...pagination, status: z.enum(ORDER_STATUSES).optional() }).strict();

const cardIdParam = z.object({ cardId });
const userIdParam = z.object({ userId: uuid('userId') });
const orderIdParam = z.object({ id: uuid('order id') });

// ฟิลด์การ์ดเป็น optional ที่นี่ ส่วนกฎ "ต้องครบเมื่อปิด Catalog" อยู่ใน collectionService
const addCard = z
  .object({
    pullId: uuid('pullId'),
    cardId,
    cardName: z.string().trim().min(1).max(200).optional(),
    cardRarity: z.enum(RARITIES).optional(),
    cardImageUrl: z.string().trim().url().max(500).optional(),
    quantity: z.number().int().min(1).max(100).default(1),
  })
  .strict();

const orderItem = z.object({ cardId, quantity: z.number().int().min(1) }).strict();

const createOrder = z
  .object({
    items: z.array(orderItem).min(1, 'At least one item is required'),
    addressId: uuid('addressId').optional(),
    shippingAddress: shippingAddress.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const seen = new Set();
    v.items.forEach((item, i) => {
      if (seen.has(item.cardId)) {
        ctx.addIssue({ code: 'custom', path: ['items', i, 'cardId'], message: 'Duplicate cardId in items' });
      }
      seen.add(item.cardId);
    });
    if (Boolean(v.addressId) === Boolean(v.shippingAddress)) {
      ctx.addIssue({ code: 'custom', path: ['addressId'], message: 'Provide exactly one of addressId or shippingAddress' });
    }
  });

const updateStatus = z
  .object({
    status: z.enum(ORDER_STATUSES),
    trackingNumber: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

module.exports = {
  RARITIES,
  ORDER_STATUSES,
  shippingAddress,
  listCollection,
  listOrders,
  cardIdParam,
  userIdParam,
  orderIdParam,
  addCard,
  createOrder,
  updateStatus,
};
