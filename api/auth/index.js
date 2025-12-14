const express = require('express');
const router = express.Router();
const auth = require('../../controllers/auth');
const authMiddleware = require('../../utils/authMiddleware');
const rateLimit = require('express-rate-limit');
const multer = require('multer');

// Configure Multer (Memory Storage) for Onboarding
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

const resetPasswordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 3, // limit each IP to 3 requests per window
    message: 'Too many password reset attempts, please try again later'
});

// --- ROUTES ---

// 1. SIGNUP
router.post('/signup', auth.signup);

// 2. LOGIN
router.post('/login', auth.login);

// 3. GOOGLE OAUTH
router.get('/google', auth.googleAuth);

// 4. CALLBACK
router.get('/callback', auth.googleCallback);

// 5. ME
router.get('/me', authMiddleware, auth.getMe);

// 6. LOGOUT
router.post('/logout', auth.logout);

// 7. RESET PASSWORD
router.post('/reset-password', resetPasswordLimiter, auth.resetPassword);

router.post('/reset-password/update', auth.updatePassword);

// 8. ONBOARDING
router.post('/onboarding', upload.single('avatar'), authMiddleware, auth.onboarding);

module.exports = router;
