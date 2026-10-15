import { z } from 'zod';
import { TIERS } from '../catalog/rarity';
import { idSchema } from '../common/parse';

// plain text only: no control characters
const text = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    // eslint-disable-next-line no-control-regex
    .regex(/^[^\u0000-\u001f\u007f]*$/, 'control characters are not allowed');

const httpsUrl = z
  .string()
  .max(300)
  .refine((value) => {
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'must be an https URL');

const cardFields = {
  name: text(1, 100),
  imageSmall: httpsUrl,
  imageLarge: httpsUrl,
  rarity: z.enum(TIERS as [string, ...string[]]),
  sourceRarity: text(1, 60).nullable().default(null),
  setId: idSchema,
  setName: text(1, 100),
  supertype: text(1, 40).default('Pokémon'),
  subtypes: z.array(text(1, 40)).max(10).default([]),
  types: z.array(text(1, 40)).max(10).default([]),
  hp: z.number().int().min(1).max(1000),
  attacks: z
    .array(
      z
        .object({
          name: text(1, 100),
          cost: z.array(text(1, 40)).max(10).default([]),
          convertedEnergyCost: z.number().int().min(0).max(20).default(0),
          damage: text(0, 40).default(''),
          text: text(0, 500).default(''),
        })
        .strict(),
    )
    .max(10)
    .default([]),
  weaknesses: z.array(z.object({ type: text(1, 40), value: text(1, 20) }).strict()).max(5).default([]),
  retreatCost: z.number().int().min(0).max(10).default(0),
  artist: text(1, 100).nullable().default(null),
};

export const cardCreateSchema = z.object({ id: idSchema, ...cardFields }).strict();

export const cardPatchSchema = z
  .object({ ...cardFields })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');

const ratesSchema = z
  .object(Object.fromEntries(TIERS.map((tier) => [tier, z.number().int().min(0).max(100)])) as Record<
    string,
    z.ZodNumber
  >)
  .strict();

const packFields = {
  name: text(1, 100),
  description: text(0, 500).default(''),
  priceCredits: z.number().int().min(1).max(1_000_000),
  cardsPerPack: z.number().int().min(1).max(20),
  rates: ratesSchema,
  setIds: z.array(idSchema).min(1).max(20),
  active: z.boolean().default(true),
};

export const packCreateSchema = z.object({ id: idSchema, ...packFields }).strict();

export const packPatchSchema = z
  .object({ ...packFields })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');

export const stockPutSchema = z.object({ total: z.number().int().min(0).max(1_000_000) }).strict();
