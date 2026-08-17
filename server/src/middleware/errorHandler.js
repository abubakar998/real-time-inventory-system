'use strict';

const { ZodError } = require('zod');
const { AppError } = require('../lib/errors');
const config = require('../config/env');

function notFoundHandler(req, res) {
  res.status(404).json({
    error: { code: 'ROUTE_NOT_FOUND', message: `No route for ${req.method} ${req.originalUrl}` },
  });
}

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity.
function errorHandler(error, _req, res, _next) {
  if (error instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Some fields are invalid.',
        details: error.issues.map((issue) => ({
          field: issue.path.join('.') || '(body)',
          message: issue.message,
        })),
      },
    });
  }

  if (error instanceof AppError) {
    return res.status(error.status).json({
      error: { code: error.code, message: error.message, ...(error.details && { details: error.details }) },
    });
  }

  console.error('[error]', error);

  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong on our side.',
      ...(config.isProduction ? {} : { debug: error.message }),
    },
  });
}

/** Forwards rejected promises from async route handlers to Express. */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { notFoundHandler, errorHandler, asyncHandler };
