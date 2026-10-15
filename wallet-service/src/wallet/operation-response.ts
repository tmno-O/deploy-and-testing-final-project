import type { Response } from 'express';
import type { OperationResult } from './wallet.service';
import { toOperationView } from './wallet.views';

/** 201 for a new transaction, 200 + `Idempotent-Replayed: true` when the idempotency key was already used. */
export function respond(res: Response, result: OperationResult) {
  if (result.replayed) {
    res.status(200);
    res.setHeader('Idempotent-Replayed', 'true');
  } else {
    res.status(201);
  }
  return toOperationView(result.transaction);
}
