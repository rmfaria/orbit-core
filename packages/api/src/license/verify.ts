import jwt from 'jsonwebtoken';
import { LICENSE_PUBLIC_KEY } from './public-key.js';

export interface LicenseClaims {
  iss: string;
  sub: string;        // deployment_id
  aud: string;
  iat: number;
  exp?: number;
  jti: string;
  plan: string;
  email: string;
}

export type LicenseStatus =
  | { valid: true; claims: LicenseClaims }
  | { valid: false; reason: string };

export function verifyLicenseJwt(token: string): LicenseStatus {
  try {
    const decoded = jwt.verify(token, LICENSE_PUBLIC_KEY, {
      algorithms: ['EdDSA' as jwt.Algorithm],
      issuer: 'orbit-core.org',
      audience: 'orbit-core',
    }) as LicenseClaims;

    return { valid: true, claims: decoded };
  } catch (err: unknown) {
    const e = err as Error & { name?: string };
    if (e.name === 'TokenExpiredError') {
      return { valid: false, reason: 'License expired' };
    }
    if (e.name === 'JsonWebTokenError') {
      return { valid: false, reason: `Invalid license: ${e.message}` };
    }
    return { valid: false, reason: 'License verification failed' };
  }
}
