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

function getSecretBytes(): Uint8Array<ArrayBuffer> {
  const key = process.env.SESSION_SECRET || process.env.ENCRYPTION_KEY;
  if (!key || key.length < 32) {
    throw new Error("SESSION_SECRET or ENCRYPTION_KEY must be at least 32 chars");
  }
  return utf8(key.slice(0, 64));
}

async function getSigningKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    getSecretBytes(),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function utf8(s: string): Uint8Array<ArrayBuffer> {
  const src = new TextEncoder().encode(s);
  const dst = new Uint8Array(new ArrayBuffer(src.byteLength));
  dst.set(src);
  return dst;
}

function base64UrlEncode(bytes: Uint8Array<ArrayBuffer>): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array<ArrayBuffer> {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encodeJsonB64(value: unknown): string {
  return base64UrlEncode(utf8(JSON.stringify(value)));
}

function decodeJsonB64<T>(b64: string): T {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(b64))) as T;
}

export async function signSession(payload: Omit<SessionPayload, "iat" | "exp">): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const full: SessionPayload = {
    ...payload,
    iat: now,
    exp: now + SESSION_MAX_AGE_SEC
  };

  const header = encodeJsonB64({ alg: "HS256", typ: "JWT" });
  const body = encodeJsonB64(full);
  const unsigned = `${header}.${body}`;
  const key = await getSigningKey();
  const sig = await crypto.subtle.sign("HMAC", key, utf8(unsigned));

  return `${unsigned}.${base64UrlEncode(new Uint8Array(sig))}`;
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [headerB64, bodyB64, sigB64] = parts as [string, string, string];
    const unsigned = `${headerB64}.${bodyB64}`;
    const key = await getSigningKey();
    const ok = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlDecode(sigB64),
      utf8(unsigned)
    );
    if (!ok) return null;

    const payload = decodeJsonB64<SessionPayload>(bodyB64);

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
  const token = await signSession(payload);
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
