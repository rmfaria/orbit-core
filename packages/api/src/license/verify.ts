import { createPublicKey, verify } from 'node:crypto';
import { LICENSE_PUBLIC_KEY } from './public-key.js';

const publicKey = createPublicKey(LICENSE_PUBLIC_KEY);

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
    const parts = token.split('.');
    if (parts.length !== 3) return { valid: false, reason: 'Invalid license: malformed token' };

    const [headerB64, payloadB64, signatureB64] = parts;
    const signingInput = `${headerB64}.${payloadB64}`;

    // Verify Ed25519 signature
    const signature = Buffer.from(signatureB64, 'base64url');
    const isValid = verify(null, Buffer.from(signingInput), publicKey, signature);
    if (!isValid) return { valid: false, reason: 'Invalid license: bad signature' };

    // Decode header and validate algorithm
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());
    if (header.alg !== 'EdDSA') return { valid: false, reason: 'Invalid license: wrong algorithm' };

    // Decode and validate claims
    const claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString()) as LicenseClaims;

    if (claims.iss !== 'orbit-core.org') return { valid: false, reason: 'Invalid license: wrong issuer' };
    if (claims.aud !== 'orbit-core') return { valid: false, reason: 'Invalid license: wrong audience' };

    // Check expiration
    if (claims.exp && claims.exp < Math.floor(Date.now() / 1000)) {
      return { valid: false, reason: 'License expired' };
    }

    return { valid: true, claims };
  } catch {
    return { valid: false, reason: 'License verification failed' };
  }
}
