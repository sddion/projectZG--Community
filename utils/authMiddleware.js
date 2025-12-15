/**
 * Authentication middleware
 *
 * - Verifies Supabase access token from Authorization header or cookies
 * - Attaches authenticated user to req.user
 * - Strict auth: rejects requests without valid token
 * - Clears stale auth cookies on invalid / expired tokens
 */
const authMiddleware = async (req, res, next) => {
  // ------------------------------------------------------------
  // Safety guard: ensure next() exists to prevent hard crashes
  // This should never happen in normal Express usage, but
  // protects against miswired middleware or manual invocation.
  // ------------------------------------------------------------
  if (typeof next !== 'function') {
    console.error('CRITICAL ERROR: authMiddleware called without a next function');

    if (res && typeof res.status === 'function') {
      return res
        .status(500)
        .json({ error: 'Server Middleware Error: next() undefined' });
    }
    return;
  }

  // ------------------------------------------------------------
  // Extract access token
  // Priority:
  // 1. Authorization header: "Bearer <token>"
  // 2. Supabase access token cookie
  // ------------------------------------------------------------
  const token =
    (req.headers.authorization &&
      req.headers.authorization.split(' ')[1]) ||
    req.cookies?.['sb-access-token'];

  // ------------------------------------------------------------
  // No token present
  //
  // Controllers currently expect req.user to exist and may crash
  // if it's missing, so we enforce strict authentication here.
  // Alternative (not used): set req.user = null and continue.
  // ------------------------------------------------------------
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  // ------------------------------------------------------------
  // Import Supabase client here to avoid potential circular
  // dependency issues (safe to move to top if confirmed stable)
  // ------------------------------------------------------------
  const { supabase } = require('./supabaseClient');

  try {
    // ----------------------------------------------------------
    // Verify token and fetch user from Supabase
    // ----------------------------------------------------------
    const { data, error } = await supabase.auth.getUser(token);

    // ----------------------------------------------------------
    // Invalid token or user no longer exists
    //
    // This can happen when:
    // - Token is expired
    // - Token is invalid
    // - User was deleted but cookie/token remains
    // ----------------------------------------------------------
    if (error || !data?.user) {
      console.error(
        'Auth Middleware Verification Failed:',
        error ? error.message : 'No user returned'
      );

      // --------------------------------------------------------
      // Clear stale Supabase cookies if they exist on the request
      // IMPORTANT: cookies must be read from req.cookies,
      // not res.cookies (bug fixed)
      // --------------------------------------------------------
      if (
        req.cookies?.['sb-access-token'] ||
        req.cookies?.['sb-refresh-token']
      ) {
        res.clearCookie('sb-access-token', { path: '/' });
        res.clearCookie('sb-refresh-token', { path: '/' });
      }

      return res
        .status(401)
        .json({ error: 'Unauthorized: Invalid token or user check failed' });
    }

    // ----------------------------------------------------------
    // Auth successful
    // Attach user to request for downstream controllers
    // ----------------------------------------------------------
    req.user = data.user;
    next();
  } catch (err) {
    // ----------------------------------------------------------
    // Some Supabase / JWT errors may throw instead of returning
    // data.error (version / transport dependent)
    //
    // Explicitly handle token expiry or invalid JWT signatures
    // ----------------------------------------------------------
    if (
      err?.message &&
      (err.message.includes('expired') ||
        err.message.includes('invalid JWT'))
    ) {
      if (
        req.cookies?.['sb-access-token'] ||
        req.cookies?.['sb-refresh-token']
      ) {
        res.clearCookie('sb-access-token', { path: '/' });
        res.clearCookie('sb-refresh-token', { path: '/' });
      }

      return res.status(401).json({ error: 'Unauthorized: Token expired' });
    }

    // ----------------------------------------------------------
    // Unexpected error path
    // ----------------------------------------------------------
    console.error('Auth Middleware Exception:', err);
    return res
      .status(500)
      .json({ error: 'Internal Server Error during auth' });
  }
};

module.exports = authMiddleware;
