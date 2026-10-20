import { cookies } from "next/headers";
import {
  SESSION_COOKIE_NAME as COOKIE_NAME,
  SESSION_MAX_AGE_SEC,
  signSession,
  verifySession,
  type SessionPayload
} from "./session-token";

export { signSession, verifySession, SESSION_MAX_AGE_SEC };
export { SESSION_COOKIE_NAME } from "./session-token";
export type { SessionPayload } from "./session-token";

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
