import { z } from 'zod';
import { idSchema, paginationShape, uuidSchema } from '../common/parse';
import { ORDER_STATUSES } from '../store/types';

// same rules as user-service/src/schemas.js so addresses look the same everywhere
const phone = z.string().trim().regex(/^[0-9+\-\s]{8,20}$/, 'Invalid phone number');
const postalCode = z.string().trim().regex(/^\d{5}$/, 'Postal code must be 5 digits');

export const shippingAddressSchema = z
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

const orderItem = z.object({ cardId: idSchema, quantity: z.number().int().min(1) }).strict();

export const createOrderBody = z
  .object({
    items: z.array(orderItem).min(1, 'At least one item is required'),
    addressId: uuidSchema('addressId').optional(),
    shippingAddress: shippingAddressSchema.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
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
export type CreateOrderBody = z.output<typeof createOrderBody>;

export const listOrdersQuery = z.object({ ...paginationShape, status: z.enum(ORDER_STATUSES).optional() }).strict();

export const adminListOrdersQuery = listOrdersQuery.extend({ userId: uuidSchema('userId').optional() }).strict();

export const updateStatusBody = z
  .object({
    status: z.enum(ORDER_STATUSES),
    trackingNumber: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export const orderIdParam = uuidSchema('order id');
