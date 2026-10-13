const { badRequest } = require('../errors');

const validate = (schema, source = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({
      field: i.path.join('.'),
      message: i.message,
    }));
    return next(badRequest('Invalid request', details));
  }
  req[source] = result.data;
  return next();
};

module.exports = { validate };
