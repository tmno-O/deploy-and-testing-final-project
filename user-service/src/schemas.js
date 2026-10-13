const { z } = require('zod');

const email = z.string().trim().toLowerCase().email('Invalid email').max(254);
const newPassword = z.string().min(8, 'Password must be at least 8 characters').max(128);
const displayName = z.string().trim().min(1).max(100);
const firstName = z.string().trim().min(1, 'First name is required').max(100);
const lastName = z.string().trim().min(1, 'Last name is required').max(100);

const register = z.object({ email, password: newPassword, firstName, lastName, displayName }).strict();
const login = z.object({ email, password: z.string().min(1).max(128) }).strict();

const updateProfile = z
  .object({
    firstName: firstName.optional(),
    lastName: lastName.optional(),
    displayName: displayName.optional(),
    email: email.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });

const changePassword = z
  .object({ currentPassword: z.string().min(1).max(128), newPassword })
  .strict();

const phone = z.string().trim().regex(/^[0-9+\-\s]{8,20}$/, 'Invalid phone number');
const postalCode = z.string().trim().regex(/^\d{5}$/, 'Postal code must be 5 digits');

const addressFields = {
  recipientName: z.string().trim().min(1).max(100),
  phone,
  line1: z.string().trim().min(1).max(255),
  line2: z.string().trim().max(255).optional(),
  subdistrict: z.string().trim().max(100).optional(),
  district: z.string().trim().min(1).max(100),
  province: z.string().trim().min(1).max(100),
  postalCode,
};

const createAddress = z.object({ ...addressFields, isDefault: z.boolean().optional() }).strict();

// การยกเลิก default ทำโดยตั้งที่อยู่อื่นเป็น default จึงรับแค่ true
const updateAddress = z
  .object({ ...addressFields, isDefault: z.literal(true) })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });

const idParam = z.object({ id: z.string().uuid('Invalid id') });

module.exports = {
  register,
  login,
  updateProfile,
  changePassword,
  createAddress,
  updateAddress,
  idParam,
};
