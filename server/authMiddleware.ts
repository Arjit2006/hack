import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { NextFunction, Request, Response } from 'express';

let cachedProjectId = '';
try {
  const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(cfgPath)) {
    const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) as { projectId?: string };
    cachedProjectId = parsed.projectId || '';
  }
} catch {
  // Ignore if config absent
}

interface CertCache {
  certs: Record<string, string>;
  expiresAt: number;
}

let certCache: CertCache | null = null;

async function getGooglePublicCerts(): Promise<Record<string, string>> {
  if (certCache && Date.now() < certCache.expiresAt) {
    return certCache.certs;
  }
  const res = await fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
  if (!res.ok) {
    throw new Error('Failed to fetch Firebase public verification certificates');
  }
  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
  const maxAgeMs = maxAgeMatch ? Number(maxAgeMatch[1]) * 1000 : 3600 * 1000;
  const certs = (await res.json()) as Record<string, string>;
  certCache = { certs, expiresAt: Date.now() + maxAgeMs };
  return certs;
}

export interface VerifiedFirebaseUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  signInSecondFactor?: string;
  role: 'USER' | 'ADMIN' | 'SUPER_ADMIN';
}

const BOOTSTRAPPED_SUPER_ADMINS = new Set(['kuku42615@gmail.com']);
const runtimeAdminRoles = new Map<string, 'ADMIN' | 'SUPER_ADMIN'>();

export function setRuntimeAdminRole(email: string, role: 'USER' | 'ADMIN' | 'SUPER_ADMIN') {
  const clean = email.trim().toLowerCase();
  if (role === 'USER') {
    runtimeAdminRoles.delete(clean);
  } else {
    runtimeAdminRoles.set(clean, role);
  }
}

export async function verifyFirebaseIdToken(token: string): Promise<VerifiedFirebaseUser> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed Firebase ID token');
  }
  const [headerB64, payloadB64, sigB64] = parts;
  const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8')) as { alg?: string; kid?: string };
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
    iss?: string;
    aud?: string;
    sub?: string;
    exp?: number;
    iat?: number;
    email?: string;
    email_verified?: boolean;
    firebase?: { sign_in_second_factor?: string };
  };

  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Unsupported token signing algorithm');
  }
  if (!payload.sub || !payload.exp || payload.exp * 1000 < Date.now()) {
    throw new Error('Token expired or missing subject');
  }
  if (cachedProjectId) {
    if (payload.aud !== cachedProjectId || payload.iss !== `https://securetoken.google.com/${cachedProjectId}`) {
      throw new Error('Token audience or issuer mismatch');
    }
  }

  const certs = await getGooglePublicCerts();
  const cert = certs[header.kid];
  if (!cert) {
    throw new Error('Unknown signing key ID');
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  const sigBuf = Buffer.from(sigB64, 'base64url');
  if (!verifier.verify(cert, sigBuf)) {
    throw new Error('Invalid Firebase ID token signature');
  }

  const email = (payload.email || '').toLowerCase();
  const emailVerified = Boolean(payload.email_verified);
  let role: VerifiedFirebaseUser['role'] = 'USER';
  if (emailVerified && BOOTSTRAPPED_SUPER_ADMINS.has(email)) {
    role = 'SUPER_ADMIN';
  } else if (emailVerified && runtimeAdminRoles.has(email)) {
    role = runtimeAdminRoles.get(email) ?? 'USER';
  }

  return {
    uid: payload.sub,
    email,
    emailVerified,
    signInSecondFactor: payload.firebase?.sign_in_second_factor,
    role,
  };
}

declare global {
  namespace Express {
    interface Request {
      user?: VerifiedFirebaseUser;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authentication required (missing Bearer token).' });
      return;
    }
    const token = authHeader.slice(7).trim();
    const user = await verifyFirebaseIdToken(token);
    req.user = user;
    next();
  } catch (err) {
    res.status(401).json({ error: err instanceof Error ? err.message : 'Invalid or expired authentication token.' });
  }
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  await requireAuth(req, res, () => {
    if (!req.user) return;
    if (req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Administrator privileges required.' });
      return;
    }
    next();
  });
}

// Simple server-side rate limiter per IP + route bucket
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip || 'local'}:${req.path}`;
    const now = Date.now();
    const entry = rateBuckets.get(key);
    if (!entry || now > entry.resetAt) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    entry.count++;
    if (entry.count > maxRequests) {
      res.status(429).json({ error: 'Rate limit exceeded. Please wait before retrying.' });
      return;
    }
    next();
  };
}
