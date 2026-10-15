import { z } from 'zod';
import { idSchema, paginationShape, uuidSchema } from '../common/parse';
import { RARITIES } from '../store/types';

export const listCollectionQuery = z.object({ ...paginationShape, rarity: z.enum(RARITIES).optional() }).strict();

// card fields are optional here; "required while the catalog is disabled" is checked in CollectionService
export const addCardBody = z
  .object({
    pullId: uuidSchema('pullId'),
    cardId: idSchema,
    cardName: z.string().trim().min(1).max(200).optional(),
    cardRarity: z.enum(RARITIES).optional(),
    cardImageUrl: z.string().trim().url().max(500).optional(),
    quantity: z.number().int().min(1).max(100).default(1),
  })
  .strict();
export type AddCardBody = z.output<typeof addCardBody>;

export const userIdParam = uuidSchema('userId');
