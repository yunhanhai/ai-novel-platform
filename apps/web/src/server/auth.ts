import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "session";
const SESSION_MAX_AGE_SEC = 7 * 24 * 60 * 60; // 7 days

interface SessionPayload {
  userId: string;
  organizationId: string;
  displayName: string;
  iat: number;
  exp: number;
}

function getSecret(): Buffer {
  const key = process.env.SESSION_SECRET || process.env.ENCRYPTION_KEY;
  if (!key || key.length < 32) {
    throw new Error("SESSION_SECRET or ENCRYPTION_KEY must be at least 32 chars");
  }
  return Buffer.from(key.slice(0, 64), "utf-8");
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64url");
}

function base64UrlDecode(str: string): Buffer {
  return Buffer.from(str, "base64url");
}

export function signSession(payload: Omit<SessionPayload, "iat" | "exp">): string {
  const now = Math.floor(Date.now() / 1000);
  const full: SessionPayload = {
    ...payload,
    iat: now,
    exp: now + SESSION_MAX_AGE_SEC
  };

  const header = base64UrlEncode(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = base64UrlEncode(Buffer.from(JSON.stringify(full)));
  const unsigned = `${header}.${body}`;
  const sig = createHmac("sha256", getSecret()).update(unsigned).digest();

  return `${unsigned}.${base64UrlEncode(sig)}`;
}

export function verifySession(token: string): SessionPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [headerB64, bodyB64, sigB64] = parts as [string, string, string];
    const unsigned = `${headerB64}.${bodyB64}`;
    const expectedSig = createHmac("sha256", getSecret()).update(unsigned).digest();
    const actualSig = base64UrlDecode(sigB64);

    if (expectedSig.length !== actualSig.length || !timingSafeEqual(expectedSig, actualSig)) {
      return null;
    }

    const payload = JSON.parse(base64UrlDecode(bodyB64).toString("utf-8")) as SessionPayload;

    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (!payload.userId || !payload.organizationId) return null;

    return payload;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySession(token);
}

export async function setSessionCookie(payload: Omit<SessionPayload, "iat" | "exp">): Promise<void> {
  const token = signSession(payload);
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}
