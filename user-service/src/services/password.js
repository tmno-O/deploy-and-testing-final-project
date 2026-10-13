const argon2 = require('argon2');

// ค่าแนะนำของ OWASP สำหรับ Argon2id
const OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

let dummyHashPromise;

const hash = (plain) => argon2.hash(plain, OPTIONS);

async function verify(hashValue, plain) {
  try {
    return await argon2.verify(hashValue, plain);
  } catch {
    return false;
  }
}

// ใช้ตอนไม่พบผู้ใช้ เพื่อให้เวลาตอบใกล้เคียงกับกรณีรหัสผ่านผิด (กัน user enumeration)
async function verifyDummy(plain) {
  dummyHashPromise = dummyHashPromise || hash('dummy-password-for-timing');
  return verify(await dummyHashPromise, plain);
}

module.exports = { hash, verify, verifyDummy };
