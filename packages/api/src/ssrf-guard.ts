/**
 * orbit-core — SSRF protection
 *
 * Blocks outbound HTTP requests to private/reserved IP ranges,
 * cloud metadata endpoints, and loopback addresses.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { URL } from 'url';
import dns from 'dns/promises';

const PRIVATE_RANGES = [
  /^127\./,                          // loopback
  /^10\./,                           // RFC 1918
  /^172\.(1[6-9]|2\d|3[01])\./,     // RFC 1918
  /^192\.168\./,                     // RFC 1918
  /^169\.254\./,                     // link-local / cloud metadata
  /^0\./,                            // "this" network
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT
  /^::1$/,                           // IPv6 loopback
  /^fe80:/i,                         // IPv6 link-local
  /^fc00:/i,                         // IPv6 ULA
  /^fd/i,                            // IPv6 ULA
];

const BLOCKED_HOSTS = [
  'metadata.google.internal',
  'metadata.goog',
  '169.254.169.254',
];

function isPrivateIp(ip: string): boolean {
  return PRIVATE_RANGES.some(r => r.test(ip));
}

/**
 * Check if a URL targets a private/internal address.
 * Resolves DNS to catch SSRF via DNS rebinding of public hostnames to private IPs.
 */
export async function isPrivateUrl(urlStr: string): Promise<boolean> {
  try {
    const parsed = new URL(urlStr);

    // Block non-HTTP schemes
    if (!['http:', 'https:'].includes(parsed.protocol)) return true;

    // Block known metadata hostnames
    if (BLOCKED_HOSTS.includes(parsed.hostname.toLowerCase())) return true;

    // Check if hostname is already an IP
    if (isPrivateIp(parsed.hostname)) return true;

    // Resolve DNS to catch rebinding attacks
    const addresses = await dns.resolve4(parsed.hostname).catch(() => []);
    for (const addr of addresses) {
      if (isPrivateIp(addr)) return true;
    }

    const addresses6 = await dns.resolve6(parsed.hostname).catch(() => []);
    for (const addr of addresses6) {
      if (isPrivateIp(addr)) return true;
    }

    return false;
  } catch {
    return true; // block on parse error
  }
}
