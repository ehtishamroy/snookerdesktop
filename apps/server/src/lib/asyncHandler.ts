import type { NextFunction, Request, Response } from "express";

/**
 * Wraps an async Express handler so a rejected promise is forwarded to
 * `next()` (and thus the centralized error handler) instead of crashing the
 * process / hanging the request. Express 4 does not do this automatically.
 */
export function asyncHandler<
  Req extends Request = Request,
  Res extends Response = Response
>(fn: (req: Req, res: Res, next: NextFunction) => Promise<unknown>) {
  return (req: Req, res: Res, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
