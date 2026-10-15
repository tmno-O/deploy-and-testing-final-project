process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-test-secret-test-secret-123';
process.env.INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'test-internal-test-internal-test-1234';
process.env.PERSIST_DATA = 'false'; // tests must never overwrite the mock data file
process.env.ADMIN_USER_IDS = 'admin-1,admin-2';
