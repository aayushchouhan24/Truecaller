import { registerAs } from '@nestjs/config';

export default registerAs('jwt', () => ({
  secret: process.env.JWT_SECRET || 'default-secret',
  expiration: process.env.JWT_EXPIRATION || '7d',
}));
