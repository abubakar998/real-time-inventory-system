'use strict';

/**
 * Errors carry a stable machine-readable `code` so the React client can render
 * the right message/toast without string-matching on prose.
 */
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    if (details) this.details = details;
  }
}

const badRequest = (code, message, details) => new AppError(400, code, message, details);
const unauthorized = (message = 'Sign in to continue.') =>
  new AppError(401, 'UNAUTHENTICATED', message);
const forbidden = (code, message) => new AppError(403, code, message);
const notFound = (code, message) => new AppError(404, code, message);
const conflict = (code, message, details) => new AppError(409, code, message, details);

module.exports = { AppError, badRequest, unauthorized, forbidden, notFound, conflict };
