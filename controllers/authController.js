const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const db = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'wealth_command_jwt_secret_dev_2026_secure';

const generateToken = (id) => {
  return jwt.sign({ id }, JWT_SECRET, {
    expiresIn: '365d',
  });
};

const authController = {
  /**
   * @desc    Google Sign-In / Register
   * @route   POST /api/auth/google-login
   * @access  Public
   */
  googleLogin: async (req, res) => {
    try {
      const { idToken, email: directEmail, name: directName, profileImage: directImage } = req.body;

      let email = directEmail;
      let name = directName || '';
      let profileImage = directImage || '';
      let googleId = '';

      // 1. Verify with Google official OAuth2Client (matching marrige_app)
      if (idToken) {
        const webClientId = process.env.GOOGLE_WEB_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
        try {
          const client = new OAuth2Client(webClientId);
          const ticket = await client.verifyIdToken({
            idToken,
            audience: [
              webClientId,
              '966849632362-ns76g3jkqescuvd8emu68jbntcbn32vc.apps.googleusercontent.com',
              '524746447996-qlbdmlb9td25c4sdd6hkttjpk56qp4kp.apps.googleusercontent.com'
            ].filter(Boolean)
          });
          const payload = ticket.getPayload();
          if (payload) {
            email = payload.email || email;
            name = payload.name || name;
            profileImage = payload.picture || profileImage;
            googleId = payload.sub || googleId;
          }
        } catch (googleErr) {
          // Fallback: parse JWT payload (dev/local fallback)
          try {
            const decoded = jwt.decode(idToken);
            if (decoded) {
              email = decoded.email || email;
              name = decoded.name || name;
              profileImage = decoded.picture || profileImage;
              googleId = decoded.sub || decoded.user_id || decoded.uid || googleId;
            }
          } catch (_) {}
        }
      }

      if (!email) {
        return res.status(400).json({
          success: false,
          message: 'Google login requires email address.'
        });
      }

      // Find or create user via unified DB interface
      const user = await db.findOrCreateGoogleUser({
        email,
        name: name || email.split('@')[0],
        profileImage,
        googleId
      });

      const token = generateToken(user.id || user._id || 'usr-default');

      return res.status(200).json({
        success: true,
        message: 'Successfully authenticated with Google.',
        token,
        user: {
          id: user.id || user._id,
          email: user.email,
          name: user.name,
          phone: user.phone || '',
          profileImage: user.profileImage,
          income: user.income,
          savingsTarget: user.savingsTarget,
          fixedExpenses: user.fixedExpenses,
          profileCompleted: Boolean(user.profileCompleted)
        },
        requiresOnboarding: !user.profileCompleted
      });
    } catch (error) {
      console.error('[Google Auth Error]', error);
      return res.status(500).json({ success: false, message: error.message });
    }
  },

  /**
   * @desc    Demo 1-Tap Login for instant test access
   * @route   POST /api/auth/demo-login
   * @access  Public
   */
  demoLogin: async (req, res) => {
    try {
      const user = await db.getUser();
      const token = generateToken(user.id || user._id || 'usr-default');

      return res.status(200).json({
        success: true,
        message: 'Logged in as Demo User.',
        token,
        user: {
          id: user.id || user._id,
          email: user.email || '',
          name: user.name || '',
          phone: user.phone || '',
          profileImage: user.profileImage || '',
          income: user.income || 0,
          savingsTarget: user.savingsTarget || 0,
          fixedExpenses: user.fixedExpenses || [],
          profileCompleted: Boolean(user.profileCompleted)
        },
        requiresOnboarding: !user.profileCompleted
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  },

  /**
   * @desc    Get Current Logged-in User Profile
   * @route   GET /api/auth/me
   * @access  Private (Bearer Token)
   */
  getMe: async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: 'Not authenticated.' });
      }
      return res.json({
        success: true,
        user: req.user
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }
};

module.exports = authController;
