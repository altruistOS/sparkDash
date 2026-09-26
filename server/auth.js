import { timingSafeEqual } from "node:crypto";

export function configuredToken() {
  const token = process.env.SPARKDASH_TOKEN || process.env.DASHBOARD_TOKEN || "";
  return token.trim();
}

export function isLoopbackBind(host) {
  return host === "localhost" || host === "::1" || /^127\./.test(host);
}

export function requireRemoteAuth(bindHost) {
  return !isLoopbackBind(bindHost);
}

/** Unset/empty/"1" allow a tokenless remote bind. Set "0" to fail closed. */
export function allowOpenRemote() {
  const v = process.env.SPARKDASH_ALLOW_OPEN_REMOTE;
  if (v == null || v === "") return true;
  return v === "1";
}

function tokensEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function extractBearer(req) {
  const header = req.headers?.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (match) return match[1].trim();
  const query = req.query?.token;
  return typeof query === "string" ? query.trim() : "";
}

const AUTH_COOKIE = "sparkdashAuth";

export function authCookieName() {
  return AUTH_COOKIE;
}

/** Read the auth cookie from a request's Cookie header ("" when absent). */
export function extractCookieToken(req) {
  const header = req.headers?.cookie || "";
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== AUTH_COOKIE) continue;
    return part.slice(eq + 1).trim();
  }
  return "";
}

/** Constant-time check of a candidate token against the configured token. */
export function isValidToken(candidate) {
  const expected = configuredToken();
  if (!expected || typeof candidate !== "string" || !candidate) return false;
  return tokensEqual(candidate, expected);
}

export function authenticate(req) {
  const expected = configuredToken();
  if (!expected) return { ok: true, mode: "open-loopback" };
  const provided = extractBearer(req) || extractCookieToken(req);
  if (!provided || !tokensEqual(provided, expected)) {
    return { ok: false, status: 401, error: "Authentication required" };
  }
  return { ok: true, mode: "bearer" };
}

export function createAuthMiddleware() {
  return function authMiddleware(req, res, next) {
    const method = (req.method || "GET").toUpperCase();
    // The login page must stay reachable while unauthenticated.
    if ((req.path || "").split("?")[0] === "/login") return next();
    const mutating = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
    const remote = requireRemoteAuth(process.env.BIND_HOST || "127.0.0.1");
    if (!mutating && !remote && !configuredToken()) return next();
    if (!mutating && !remote) return next();
    if (!mutating && remote && !configuredToken()) {
      if (allowOpenRemote()) return next();
      return res.status(403).json({ error: "Remote access requires SPARKDASH_TOKEN" });
    }
    const result = authenticate(req);
    if (!result.ok) {
      // Browser page navigations land on the login page instead of a bare 401.
      const accept = req.headers?.accept || "";
      if (method === "GET" && accept.includes("text/html")) {
        return res.redirect("/login");
      }
      return res.status(result.status).json({ error: result.error });
    }
    next();
  };
}

export function authorizeUpgrade(req) {
  const remote = requireRemoteAuth(process.env.BIND_HOST || "127.0.0.1");
  if (!remote && !configuredToken()) return true;
  return authenticate(req).ok;
}
