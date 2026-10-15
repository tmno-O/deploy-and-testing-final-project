import { randomUUID } from 'crypto';
import * as jwt from 'jsonwebtoken';

const secret = () => process.env.JWT_SECRET as string;

export const ADMIN_ID = 'admin-1';
export const newId = () => randomUUID();

/** Signs a token the same way the User Service does. */
export function signToken(
  userId: string | null = ADMIN_ID,
  opts: { secret?: string; issuer?: string; expiresIn?: jwt.SignOptions['expiresIn']; algorithm?: jwt.Algorithm } = {},
): string {
  return jwt.sign({}, opts.secret ?? secret(), {
    algorithm: opts.algorithm ?? 'HS256',
    issuer: opts.issuer ?? 'user-service',
    expiresIn: opts.expiresIn ?? '1h',
    ...(userId === null ? {} : { subject: userId }),
  });
}

/** Unsigned token with `alg: none`, which a naive verifier would accept. */
export function algNoneToken(userId = ADMIN_ID): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: userId, iss: 'user-service' })}.`;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
export const adminAuth = () => bearer(signToken(ADMIN_ID));
export const internalKey = () => ({ 'X-Internal-Key': process.env.INTERNAL_API_KEY as string });
