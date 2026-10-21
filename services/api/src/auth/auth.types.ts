import type { User } from '../store/types.js';

export type AuthContext = {
  user: User;
  tenantId: string;
};

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
  }
}
