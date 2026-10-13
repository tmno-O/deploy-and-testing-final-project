const crypto = require('crypto');
const config = require('../config');

const HEADER = 'X-Request-Id';
const VALID = /^[A-Za-z0-9._-]{1,128}$/;

// รับ X-Request-Id จาก caller (ถ้ารูปแบบถูก) หรือสร้างใหม่ แล้วส่งกลับใน response และพิมพ์ใน log
function requestId(req, res, next) {
  const incoming = req.get(HEADER);
  req.id = incoming && VALID.test(incoming) ? incoming : crypto.randomUUID();
  res.set(HEADER, req.id);

  if (config.env !== 'test') {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      console.log(`[collection-service] [${req.id}] ${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms`);
    });
  }
  next();
}

// ข้อมูลที่ต้องส่งต่อเมื่อเรียก service อื่น
const callContext = (req) => ({ requestId: req.id, authorization: req.get('Authorization') });

module.exports = { requestId, callContext, HEADER };
