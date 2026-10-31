const jwt = require('jsonwebtoken');
const db = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'wealth_command_jwt_secret_dev_2026_secure';

const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, JWT_SECRET);

      const user = await db.getUser(decoded.id);
      if (!user) {
        return res.status(401).json({ success: false, message: 'Not authorized: user account not found.' });
      }

      req.user = user;
      return next();
    } catch (err) {
      console.warn('[AuthMiddleware] Token verification error:', err.message);
      return res.status(401).json({ success: false, message: 'Session expired or invalid token. Please log in again.' });
    }
  }

  // Allow fallback to default demo user if unauthenticated in dev mode, but flag it
  if (!token) {
    return res.status(401).json({ success: false, message: 'Access denied: Authentication token required.' });
  }
};

module.exports = { protect };
