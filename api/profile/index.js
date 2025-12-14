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

// PUT /api/posts/:id - Edit Post
router.put('/posts/:id', authMiddleware, profile.UpdatePost);

// DELETE /api/posts/:id - Delete Post
router.delete('/posts/:id', authMiddleware, profile.DeletePost);

// PUT /api/comments/:id - Edit Comment
router.put('/comments/:id', authMiddleware, profile.UpdateComment);

// DELETE /api/comments/:id - Delete Comment
router.delete('/comments/:id', authMiddleware, profile.DeleteComment);

// --- Stories ---
// GET /api/stories - Fetch Active Stories
router.get('/stories', authMiddleware, profile.getActiveStories);

// POST /api/stories - Create Story
router.post('/stories', authMiddleware, profile.createStory);

// --- Profile ---
// GET /api/me
router.get('/me', authMiddleware, profile.getMyProfile);

// GET /api/profile
router.get('/profile', authMiddleware, profile.getProfile);

// PUT /api/profile
router.put('/profile', authMiddleware, upload.single('avatar'), profile.updateProfile);

// GET /api/profile/posts
router.get('/profile/posts', authMiddleware, profile.getMyPosts);

// GET /api/profile/bookmarks - Get user's saved/bookmarked posts
router.get('/profile/bookmarks', authMiddleware, profile.getBookmarkedPosts);

// GET /api/profile/tagged - Get posts where user is mentioned
router.get('/profile/tagged', authMiddleware, profile.getTaggedPosts);

// GET /api/profile/stories
router.get('/profile/stories', authMiddleware, profile.getMyStories);

// POST /api/profile/follow/:id
router.post('/profile/follow/:id', authMiddleware, profile.followUser);

const guestMiddleware = require('../../utils/guestMiddleware');

// GET /api/profile/:username
router.get('/profile/:username', guestMiddleware, profile.getPublicProfile);

// GET /api/profile/:username/posts
router.get('/profile/:username/posts', guestMiddleware, profile.getUserPosts);

// GET /api/notifications
router.get('/notifications', authMiddleware, profile.getNotifications);

// GET /api/config
router.get('/config', profile.getConfig);

module.exports = router;
