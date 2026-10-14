class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

module.exports = {
  AppError,
  badRequest: (message, details) => new AppError(400, 'VALIDATION_ERROR', message, details),
  unauthorized: (message = 'Authentication required', code = 'UNAUTHORIZED') =>
    new AppError(401, code, message),
  notFound: (message = 'Resource not found', code = 'NOT_FOUND') =>
    new AppError(404, code, message),
  conflict: (code, message) => new AppError(409, code, message),
};
