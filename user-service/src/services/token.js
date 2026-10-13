const jwt = require('jsonwebtoken');
const config = require('../config');

const ALGORITHM = 'HS256';

function sign(userId) {
  const token = jwt.sign({}, config.jwt.secret, {
    algorithm: ALGORITHM,
    subject: userId,
    issuer: config.jwt.issuer,
    expiresIn: config.jwt.expiresIn,
  });
  const { iat, exp } = jwt.decode(token);
  return { token, expiresIn: exp - iat };
}

// โยน JsonWebTokenError / TokenExpiredError ถ้าไม่ผ่าน
function verify(token) {
  return jwt.verify(token, config.jwt.secret, {
    algorithms: [ALGORITHM],
    issuer: config.jwt.issuer,
  });
}

module.exports = { sign, verify };
