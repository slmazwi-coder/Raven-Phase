import jwt from "jsonwebtoken";
import { logger } from "./logger";

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  throw new Error("SESSION_SECRET must be set");
}

export interface AuthPayload {
  sub: string; // member id
  role: "admin" | "moderator" | "member";
  fullName?: string;
}

const TOKEN_TTL = "30d";

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, SESSION_SECRET!, { expiresIn: TOKEN_TTL });
}

export function verifyToken(token: string): AuthPayload | null {
  try {
    const decoded = jwt.verify(token, SESSION_SECRET!) as AuthPayload & {
      iat: number;
      exp: number;
    };
    return { sub: decoded.sub, role: decoded.role, fullName: decoded.fullName };
  } catch (err) {
    logger.debug({ err }, "Token verification failed");
    return null;
  }
}
