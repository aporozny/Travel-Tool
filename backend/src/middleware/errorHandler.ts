import { Request, Response, NextFunction } from 'express';

export interface AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;
}

export const errorHandler = (
  err: AppError,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const statusCode = err.statusCode || 500;
  const message = err.isOperational ? err.message : 'Internal server error';

  // Server errors are logged in every environment, or production 500s leave no trace.
  // The path excludes the query string, which can carry emails or tokens.
  if (statusCode >= 500 || process.env.NODE_ENV === 'development') {
    const userId = (req as Request & { user?: { id?: string } }).user?.id;
    console.error('Unhandled error', {
      method: req.method,
      path: req.originalUrl.split('?')[0],
      statusCode,
      ...(userId ? { userId } : {}),
    }, err);
  }

  res.status(statusCode).json({
    status: 'error',
    statusCode,
    message,
  });
};
