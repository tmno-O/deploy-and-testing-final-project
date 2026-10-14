import * as jwt from 'jsonwebtoken';

const secret = () => process.env.JWT_SECRET as string;

export function signToken(
  userId: string | null = 'admin-1',
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
export function algNoneToken(userId = 'admin-1'): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: userId, iss: 'user-service' })}.`;
}
