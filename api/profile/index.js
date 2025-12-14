const express = require('express');
const router = express.Router();
const authMiddleware = require('../../utils/authMiddleware');
const profile = require('../../controllers/profile');

// --- Feed & Posts ---
// GET /api/posts - Fetch Feed
router.get('/posts', authMiddleware, profile.getFeed);

// Configure Multer for memory storage
const multer = require('multer');
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// POST /api/posts - Create Post (with max 4 files)
router.post('/posts', authMiddleware, upload.array('media', 4), profile.createPost);

// POST /api/posts/:id/like
router.post('/posts/:id/like', authMiddleware, profile.toggleLike);

// POST /api/posts/:id/bookmark
router.post('/posts/:id/bookmark', authMiddleware, profile.toggleBookmark);

// GET /api/posts/:id/comments
router.get('/posts/:id/comments', authMiddleware, profile.getComments);

// POST /api/posts/:id/comments
router.post('/posts/:id/comments', authMiddleware, profile.createComment);

// --- Stories ---
// GET /api/stories - Fetch Active Stories
router.get('/stories', authMiddleware, profile.getActiveStories);

// POST /api/stories - Create Story
router.post('/stories', authMiddleware, profile.createStory);

// --- Profile ---
// GET /api/profile
router.get('/profile', authMiddleware, profile.getProfile);

// PUT /api/profile
router.put('/profile', authMiddleware, upload.single('avatar'), profile.updateProfile);

// GET /api/profile/posts
router.get('/profile/posts', authMiddleware, profile.getMyPosts);

// GET /api/profile/stories
router.get('/profile/stories', authMiddleware, profile.getMyStories);

// POST /api/profile/follow/:id
router.post('/profile/follow/:id', authMiddleware, profile.followUser);

// GET /api/profile/:username
router.get('/profile/:username', authMiddleware, profile.getPublicProfile);

// GET /api/profile/:username/posts
router.get('/profile/:username/posts', authMiddleware, profile.getUserPosts);

module.exports = router;
