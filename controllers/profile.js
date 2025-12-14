const { supabase, createAuthenticatedClient } = require('../utils/supabaseClient');

// Get authenticated user's profile
exports.getProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        let { data: profile, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();

        // Handle case where profile doesn't exist (e.g. trigger failed or old user)
        if (!profile && error && error.code === 'PGRST116') {
            const metadata = req.user.user_metadata || {};
            // Generate a default username if missing
            const defaultUsername = metadata.username || `user_${userId.substr(0, 8)}`;

            const { data: newProfile, error: createError } = await supabase
                .from('profiles')
                .insert({
                    id: userId,
                    username: defaultUsername,
                    full_name: metadata.full_name || '',
                    avatar_url: metadata.avatar_url || null
                })
                .select()
                .single();

            if (createError) {
                console.error('Failed to auto-create profile:', createError);
                throw createError;
            }
            profile = newProfile;
            error = null;
        }

        if (error) throw error;
        res.json({ profile });
    } catch (err) {
        console.error('Profile Fetch Error:', err);
        res.status(500).json({ error: 'Failed to fetch profile' });
    }
};

// Update authenticated user's profile
exports.updateProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        const { full_name, username, bio, gender } = req.body;
        let { avatar_url } = req.body;

        // Handle Avatar Upload if file is present
        if (req.file) {
            const { uploadFile } = require('../utils/uploadHelper');
            const { createAuthenticatedClient } = require('../utils/supabaseClient');

            // Get token for auth upload
            let token = req.headers.authorization ? req.headers.authorization.split(' ')[1] : null;
            if (!token && req.cookies && req.cookies['sb-access-token']) {
                token = req.cookies['sb-access-token'];
            }

            avatar_url = await uploadFile(req.file, 'avatars', userId, token);
        }

        const updates = {};
        if (full_name !== undefined) updates.full_name = full_name;
        if (username !== undefined) updates.username = username;
        if (bio !== undefined) updates.bio = bio;
        if (gender !== undefined) updates.gender = gender;
        if (avatar_url !== undefined) updates.avatar_url = avatar_url;

        updates.updated_at = new Date().toISOString();

        // Create authenticated client for DB operations (RLS check)
        const { createAuthenticatedClient, supabase: anonClient } = require('../utils/supabaseClient');
        let dbClient = anonClient;
        const token = req.headers.authorization ? req.headers.authorization.split(' ')[1] :
            (req.cookies ? req.cookies['sb-access-token'] : null);

        if (token) {
            dbClient = await createAuthenticatedClient(token);
            if (!dbClient) dbClient = anonClient;
        }

        const { data: profile, error } = await dbClient
            .from('profiles')
            .update(updates)
            .eq('id', userId)
            .select()
            .single();

        if (error) throw error;
        res.json({ profile });
    } catch (err) {
        console.error('Profile Update Error:', err);
        res.status(500).json({ error: 'Failed to update profile' });
    }
};

// Get authenticated user's posts
exports.getMyPosts = async (req, res) => {
    try {
        const userId = req.user.id;
        const { data: posts, error } = await supabase
            .from('posts')
            .select('*')
            .eq('author_id', userId)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json({ posts });
    } catch (err) {
        console.error('My Posts Error:', err);
        res.status(500).json({ error: 'Failed to fetch posts' });
    }
};

// Get authenticated user's active stories
exports.getMyStories = async (req, res) => {
    try {
        const userId = req.user.id;
        const { data: stories, error } = await supabase
            .from('stories')
            .select('*')
            .eq('user_id', userId)
            .gt('expires_at', new Date().toISOString())
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json({ stories });
    } catch (err) {
        console.error('My Stories Error:', err);
        res.status(500).json({ error: 'Failed to fetch stories' });
    }
};

// Follow or Unfollow a user
exports.followUser = async (req, res) => {
    try {
        const followerId = req.user.id;
        const followingId = req.params.id;

        if (followerId === followingId) {
            return res.status(400).json({ error: 'Cannot follow yourself' });
        }

        let client = supabase;
        const token = req.cookies['sb-access-token'] || (req.headers.authorization && req.headers.authorization.split(' ')[1]);
        if (token) {
            const authClient = await createAuthenticatedClient(token);
            if (authClient) client = authClient;
        }

        const { data: existing } = await supabase // Select is public usually, but safer to match context if needed. RLS strictly on insert/delete.
            .from('follows')
            .select('id')
            .eq('follower_id', followerId)
            .eq('following_id', followingId)
            .single();

        if (existing) {
            await client.from('follows').delete().eq('id', existing.id);
            res.json({ following: false });
        } else {
            await client.from('follows').insert({
                follower_id: followerId,
                following_id: followingId
            });
            res.json({ following: true });
        }
    } catch (err) {
        console.error('Follow Error:', err);
        res.status(500).json({ error: 'Follow action failed' });
    }
};

// Get public profile by username
exports.getPublicProfile = async (req, res) => {
    try {
        const { username } = req.params;
        const cleanUsername = username.startsWith('@') ? username.substring(1) : username;

        const { data: profile, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('username', cleanUsername)
            .single();

        if (error || !profile) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Check if current user follows this profile
        let isFollowing = false;
        if (req.user && req.user.id !== profile.id) {
            const { data: follow } = await supabase
                .from('follows')
                .select('id')
                .eq('follower_id', req.user.id)
                .eq('following_id', profile.id)
                .single();

            if (follow) isFollowing = true;
        }

        res.json({ profile: { ...profile, is_following: isFollowing } });
    } catch (err) {
        console.error('Public Profile Fetch Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

// --- From Post  ---

// Fetch Feed
exports.getFeed = async (req, res) => {
    try {
        const userId = req.user.id;

        const { data: posts, error } = await supabase
            .from('posts')
            .select(`
                *,
                author:profiles(username, full_name, avatar_url)
            `)
            .order('created_at', { ascending: false })
            .limit(20);

        if (error) throw error;

        const postIds = posts.map(p => p.id);

        const { data: reactions, error: rError } = await supabase
            .from('reactions')
            .select('post_id, type')
            .in('post_id', postIds)
            .eq('user_id', userId);

        if (rError) console.error("Error fetching reactions:", rError);

        const postsWithState = posts.map(post => {
            const userReactions = reactions ? reactions.filter(r => r.post_id === post.id) : [];
            return {
                ...post,
                has_liked: userReactions.some(r => r.type === 'like'),
                has_bookmarked: userReactions.some(r => r.type === 'bookmark')
            };
        });

        res.json({ posts: postsWithState });
    } catch (err) {
        console.error('Fetch Posts Error:', err);
        res.status(500).json({ error: 'Failed to fetch posts' });
    }
};

// Create Post
exports.createPost = async (req, res) => {
    try {
        const userId = req.user.id;
        const { content } = req.body;
        const files = req.files || []; // Multer adds this

        if ((!content || !content.trim()) && files.length === 0) {
            return res.status(400).json({ error: 'Content or media is required' });
        }

        // Upload files
        const { uploadFile } = require('../utils/uploadHelper');

        let token = req.headers.authorization ? req.headers.authorization.split(' ')[1] : null;
        if (!token && req.cookies && req.cookies['sb-access-token']) {
            token = req.cookies['sb-access-token'];
        }

        const mediaUrls = [];
        for (const file of files) {
            const url = await uploadFile(file, 'posts', userId, token);
            mediaUrls.push(url);
        }

        // Create authenticated client for DB operations (RLS check)
        const { createAuthenticatedClient, supabase: anonClient } = require('../utils/supabaseClient');
        let dbClient = anonClient;
        if (token) {
            dbClient = await createAuthenticatedClient(token);
            if (!dbClient) dbClient = anonClient;
        }

        const { data: newPost, error } = await dbClient
            .from('posts')
            .insert({
                author_id: userId,
                content_text: content ? content.trim() : '',
                media_urls: mediaUrls
            })
            .select('*, author:profiles(username, full_name, avatar_url)')
            .single();

        if (error) throw error;

        res.json({ post: newPost });
    } catch (err) {
        console.error('Create Post Error:', err);
        res.status(500).json({ error: 'Failed to create post' });
    }
};

// Toggle Like
exports.toggleLike = async (req, res) => {
    try {
        const userId = req.user.id;
        const postId = req.params.id;

        let client = supabase;
        const token = req.cookies['sb-access-token'] || (req.headers.authorization && req.headers.authorization.split(' ')[1]);
        if (token) {
            const authClient = await createAuthenticatedClient(token);
            if (authClient) client = authClient;
        }

        const { data: existing } = await supabase
            .from('reactions')
            .select('id')
            .eq('post_id', postId)
            .eq('user_id', userId)
            .eq('type', 'like')
            .single();

        if (existing) {
            await client.from('reactions').delete().eq('id', existing.id);
            res.json({ liked: false });
        } else {
            await client.from('reactions').insert({
                post_id: postId,
                user_id: userId,
                type: 'like'
            });
            res.json({ liked: true });
        }
    } catch (err) {
        console.error('Like Error:', err);
        res.status(500).json({ error: 'Action failed' });
    }
};

// Toggle Bookmark
exports.toggleBookmark = async (req, res) => {
    try {
        const userId = req.user.id;
        const postId = req.params.id;

        let client = supabase;
        const token = req.cookies['sb-access-token'] || (req.headers.authorization && req.headers.authorization.split(' ')[1]);
        if (token) {
            const authClient = await createAuthenticatedClient(token);
            if (authClient) client = authClient;
        }

        const { data: existing } = await supabase
            .from('reactions')
            .select('id')
            .eq('post_id', postId)
            .eq('user_id', userId)
            .eq('type', 'bookmark')
            .single();

        if (existing) {
            await client.from('reactions').delete().eq('id', existing.id);
            res.json({ bookmarked: false });
        } else {
            await client.from('reactions').insert({
                post_id: postId,
                user_id: userId,
                type: 'bookmark'
            });
            res.json({ bookmarked: true });
        }
    } catch (err) {
        console.error('Bookmark Error:', err);
        res.status(500).json({ error: 'Action failed' });
    }
};

// Fetch Comments
exports.getComments = async (req, res) => {
    try {
        const postId = req.params.id;
        const { data: comments, error } = await supabase
            .from('comments')
            .select(`
                *,
                user:profiles(username, full_name, avatar_url)
            `)
            .eq('post_id', postId)
            .order('created_at', { ascending: true });

        if (error) throw error;
        res.json({ comments });
    } catch (err) {
        console.error('Fetch Comments Error:', err);
        res.status(500).json({ error: 'Failed to fetch comments' });
    }
};

// Create Comment
exports.createComment = async (req, res) => {
    try {
        const userId = req.user.id;
        const postId = req.params.id;
        const { content } = req.body;

        if (!content || !content.trim()) return res.status(400).json({ error: 'Empty comment' });

        const { data: newComment, error } = await supabase
            .from('comments')
            .insert({
                post_id: postId,
                user_id: userId,
                content: content.trim()
            })
            .select('*, user:profiles(username, full_name, avatar_url)')
            .single();

        if (error) throw error;
        res.json({ comment: newComment });
    } catch (err) {
        console.error('Post Comment Error:', err);
        res.status(500).json({ error: 'Failed to post comment' });
    }
};

// --- From Story ---

// Fetch Active Stories
exports.getActiveStories = async (req, res) => {
    try {
        const { data: stories, error } = await supabase
            .from('stories')
            .select(`
                *,
                user:profiles(username, full_name, avatar_url)
            `)
            .gt('expires_at', new Date().toISOString())
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json({ stories });
    } catch (err) {
        console.error('Fetch Stories Error:', err);
        res.status(500).json({ error: 'Failed to fetch stories' });
    }
};

// Create Story
exports.createStory = async (req, res) => {
    try {
        const userId = req.user.id;
        const { media_url, caption } = req.body;

        if (!media_url) return res.status(400).json({ error: 'Media is required' });

        const { data: newStory, error } = await supabase
            .from('stories')
            .insert({
                user_id: userId,
                media_url,
                caption,
                media_type: 'image'
            })
            .select()
            .single();

        if (error) throw error;
        res.json({ story: newStory });
    } catch (err) {
        console.error('Create Story Error:', err);
        res.status(500).json({ error: 'Failed to create story' });
    }
};

// Get posts for a specific user
exports.getUserPosts = async (req, res) => {
    try {
        const { username } = req.params;
        const cleanUsername = username.startsWith('@') ? username.substring(1) : username;

        // First find the user_id from username
        const { data: user, error: userError } = await supabase
            .from('profiles')
            .select('id')
            .eq('username', cleanUsername)
            .single();

        if (userError || !user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const { data: posts, error: postsError } = await supabase
            .from('posts')
            .select(`
                *,
                author:profiles(username, full_name, avatar_url),
                comments_count:comments(count)
            `)
            .eq('author_id', user.id)
            .order('created_at', { ascending: false });

        if (postsError) throw postsError;

        // Calculate has_liked / has_bookmarked using reactions table
        let postsWithState = posts;
        if (req.user && posts.length > 0) {
            const postIds = posts.map(p => p.id);
            const { data: reactions, error: rError } = await supabase
                .from('reactions')
                .select('post_id, type')
                .in('post_id', postIds)
                .eq('user_id', req.user.id);

            if (rError) console.warn('Error fetching reactions:', rError);

            postsWithState = posts.map(post => {
                const userReactions = reactions ? reactions.filter(r => r.post_id === post.id) : [];
                return {
                    ...post,
                    has_liked: userReactions.some(r => r.type === 'like'),
                    has_bookmarked: userReactions.some(r => r.type === 'bookmark')
                };
            });
        }

        res.json({ posts: postsWithState });

    } catch (err) {
        console.error('Get User Posts Error:', err);
        res.status(500).json({ error: 'Failed to fetch user posts' });
    }
};
