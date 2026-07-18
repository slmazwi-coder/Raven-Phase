import type { Request, Response, NextFunction } from "express";

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.auth) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  if (req.auth.role !== "admin") {
    res.status(403).json({ error: "Admin role required" });
    return;
  }
  next();
}
