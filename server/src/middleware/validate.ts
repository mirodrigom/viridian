import type { Request, Response, NextFunction } from 'express';
import { z, type ZodSchema } from 'zod';

/**
 * Express middleware that validates request body/query/params against Zod schemas.
 * Returns 400 with structured error details on validation failure.
 */
export function validate(schemas: {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}) {
  return (req: Request, res: Response, next: NextFunction) => {
    const errors: Record<string, z.ZodError['issues']> = {};

    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (!result.success) errors.body = result.error.issues;
    }
    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (!result.success) errors.query = result.error.issues;
    }
    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (!result.success) errors.params = result.error.issues;
    }

    if (Object.keys(errors).length > 0) {
      res.status(400).json({ error: 'Validation failed', details: errors });
      return;
    }

    next();
  };
}
