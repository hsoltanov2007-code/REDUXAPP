import jwt from "jsonwebtoken";

export function signToken(payload, secret) {
  return jwt.sign(payload, secret, { expiresIn: "7d" });
}

export function authMiddleware(secret) {
  return (req, res, next) => {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: "No token" });
    }

    try {
      req.user = jwt.verify(token, secret);
      next();
    } catch {
      return res.status(401).json({ error: "Invalid token" });
    }
  };
}

export function adminOnly(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }
  next();
}
