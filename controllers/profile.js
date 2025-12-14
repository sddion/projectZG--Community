const { supabase, createAuthenticatedClient } = require('../utils/supabaseClient');

// Get authenticated user's profile
// Get authenticated user's profile
exports.getProfile = async (req, res) => {
    try {
        const userId = req.user.id;

        // Use Authenticated Client to ensure RLS policies are respected
        const token = req.cookies['sb-access-token'] ||
            (req.headers.authorization && req.headers.authorization.split(' ')[1]);

        let client = supabase;
        if (token) {
            const authClient = await createAuthenticatedClient(token);
            if (authClient) client = authClient;
        }

        let { data: profile, error } = await client
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();

        // Handle case where profile doesn't exist (e.g. trigger failed or old user)
        if (!profile && error && error.code === 'PGRST116') {
            // Return null profile to indicate incomplete
            return res.json({ profile: null });
        }

        if (error) throw error;
        res.json({ profile });
    } catch (err) {
        console.error('Profile Fetch Error:', err);
        res.status(500).json({ error: 'Failed to fetch profile' });
    }
};

exports.getMyProfile = exports.getProfile; // Alias for clarity

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

            const uploadResult = await uploadFile(req.file, 'avatars', userId, token);
            avatar_url = uploadResult.publicUrl;
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

// Get user's bookmarked/saved posts
exports.getBookmarkedPosts = async (req, res) => {
    try {
        const userId = req.user.id;

        // Get bookmarked post IDs
        const { data: bookmarks, error: bookmarkError } = await supabase
            .from('reactions')
            .select('post_id')
            .eq('user_id', userId)
            .eq('type', 'bookmark')
            .order('created_at', { ascending: false });

        if (bookmarkError) throw bookmarkError;

        if (!bookmarks || bookmarks.length === 0) {
            return res.json({ posts: [] });
        }

        const postIds = bookmarks.map(b => b.post_id);

        // Fetch the actual posts
        const { data: posts, error: postsError } = await supabase
            .from('posts')
            .select(`
                *,
                author:profiles(username, full_name, avatar_url)
            `)
            .in('id', postIds)
            .order('created_at', { ascending: false });

        if (postsError) throw postsError;
        res.json({ posts: posts || [] });
    } catch (err) {
        console.error('Bookmarked Posts Error:', err);
        res.status(500).json({ error: 'Failed to fetch bookmarked posts' });
    }
};

// Get posts where user is tagged/mentioned
exports.getTaggedPosts = async (req, res) => {
    try {
        const userId = req.user.id;

        // First get the user's username
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('username')
            .eq('id', userId)
            .single();

        if (profileError || !profile) {
            return res.json({ posts: [] });
        }

        // Search for posts that mention this user (@username)
        const mentionPattern = `@${profile.username}`;

        const { data: posts, error: postsError } = await supabase
            .from('posts')
            .select(`
                *,
                author:profiles(username, full_name, avatar_url)
            `)
            .ilike('content_text', `%${mentionPattern}%`)
            .neq('author_id', userId) // Exclude own posts
            .order('created_at', { ascending: false })
            .limit(50);

        if (postsError) throw postsError;
        res.json({ posts: posts || [] });
    } catch (err) {
        console.error('Tagged Posts Error:', err);
        res.status(500).json({ error: 'Failed to fetch tagged posts' });
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

        const { data: existing, error: lookupError } = await supabase
            .from('follows')
            .select('id')
            .eq('follower_id', followerId)
            .eq('following_id', followingId)
            .maybeSingle();

        if (lookupError) {
            console.error('Follow lookup error:', lookupError);
        }

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

// Fetch Feed (supports filter=following for posts from followed users only)
exports.getFeed = async (req, res) => {
    try {
        const userId = req.user.id;
        const filter = req.query.filter; // 'following' or undefined for all

        let postsQuery = supabase
            .from('posts')
            .select(`
                *,
                author:profiles(username, full_name, avatar_url)
            `)
            .order('created_at', { ascending: false })
            .limit(20);

        // If filter is 'following', only show posts from followed users
        if (filter === 'following') {
            // Get list of users this user follows
            const { data: following, error: followError } = await supabase
                .from('follows')
                .select('following_id')
                .eq('follower_id', userId);

            if (followError) throw followError;

            if (!following || following.length === 0) {
                return res.json({ posts: [] });
            }

            const followedUserIds = following.map(f => f.following_id);
            // Include own posts too
            followedUserIds.push(userId);

            postsQuery = postsQuery.in('author_id', followedUserIds);
        }

        const { data: posts, error } = await postsQuery;

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
            const uploadResult = await uploadFile(file, 'posts', userId, token);
            mediaUrls.push(uploadResult.publicUrl);
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

// Fetch Comments (Threaded)
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

        // Structure as threaded: separate top-level and replies
        const topLevel = [];
        const repliesMap = {};

        comments.forEach(comment => {
            if (!comment.parent_id) {
                topLevel.push({ ...comment, replies: [] });
            } else {
                if (!repliesMap[comment.parent_id]) {
                    repliesMap[comment.parent_id] = [];
                }
                repliesMap[comment.parent_id].push(comment);
            }
        });

        // Attach replies to their parents
        topLevel.forEach(comment => {
            comment.replies = repliesMap[comment.id] || [];
        });

        res.json({ comments: topLevel, totalCount: comments.length });
    } catch (err) {
        console.error('Fetch Comments Error:', err);
        res.status(500).json({ error: 'Failed to fetch comments' });
    }
};

// Create Comment (supports replies via parent_id)
exports.createComment = async (req, res) => {
    try {
        const userId = req.user.id;
        const postId = req.params.id;
        const { content, parent_id } = req.body;

        if (!content || !content.trim()) return res.status(400).json({ error: 'Empty comment' });

        // Get authenticated client for RLS
        let client = supabase;
        const token = req.cookies['sb-access-token'] || (req.headers.authorization && req.headers.authorization.split(' ')[1]);
        if (token) {
            const authClient = await createAuthenticatedClient(token);
            if (authClient) client = authClient;
        }

        // Validate parent exists if provided
        if (parent_id) {
            const { data: parentComment, error: parentError } = await supabase
                .from('comments')
                .select('id, post_id')
                .eq('id', parent_id)
                .single();

            if (parentError || !parentComment) {
                return res.status(404).json({ error: 'Parent comment not found' });
            }
            if (parentComment.post_id !== postId) {
                return res.status(400).json({ error: 'Parent comment belongs to different post' });
            }
        }

        const { data: newComment, error } = await client
            .from('comments')
            .insert({
                post_id: postId,
                user_id: userId,
                content: content.trim(),
                parent_id: parent_id || null
            })
            .select('*, user:profiles(username, full_name, avatar_url)')
            .single();

        if (error) throw error;

        // Update parent's replies_count if this is a reply
        if (parent_id) {
            await supabase.rpc('increment_replies_count', { comment_id: parent_id }).catch(() => {
                // Fallback: update directly if RPC doesn't exist
                supabase
                    .from('comments')
                    .update({ replies_count: supabase.raw('replies_count + 1') })
                    .eq('id', parent_id);
            });
        }

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
// Fetch User Notifications (Last 7 days only)
exports.getNotifications = async (req, res) => {
    try {
        const userId = req.user.id;
        const { createAuthenticatedClient } = require('../utils/supabaseClient');

        // Get token for auth
        let token = req.headers.authorization ? req.headers.authorization.split(' ')[1] : null;
        if (!token && req.cookies && req.cookies['sb-access-token']) {
            token = req.cookies['sb-access-token'];
        }

        let client = supabase;
        if (token) {
            const authClient = await createAuthenticatedClient(token);
            if (authClient) client = authClient;
        }

        // Calculate 7 days ago
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const { data: notifications, error } = await client
            .from('notifications')
            .select(`
                *,
                actor:profiles!notifications_actor_id_fkey(id, username, avatar_url)
            `)
            .eq('user_id', userId)
            .gte('created_at', sevenDaysAgo.toISOString())
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) throw error;
        res.json({ notifications });
    } catch (err) {
        console.error('Fetch Notifications Error:', err);
        res.status(500).json({ error: 'Failed to fetch notifications' });
    }
};

// Get Public Config
exports.getConfig = (req, res) => {
    res.json({
        supabaseUrl: process.env.SUPABASE_URL,
        supabaseKey: process.env.SUPABASE_ANON_KEY
    });
};

// Update Post
exports.UpdatePost = async (req, res) => {
    try {
        const userId = req.user.id;
        const postId = req.params.id;
        const { content } = req.body;

        if (!content || !content.trim()) {
            return res.status(400).json({ error: 'Content is required' });
        }

        // Create authenticated client for RLS
        const { createAuthenticatedClient, supabase: anonClient } = require('../utils/supabaseClient');
        let token = req.headers.authorization ? req.headers.authorization.split(' ')[1] : null;
        if (!token && req.cookies && req.cookies['sb-access-token']) {
            token = req.cookies['sb-access-token'];
        }

        let dbClient = anonClient;
        if (token) {
            const authClient = await createAuthenticatedClient(token);
            if (authClient) dbClient = authClient;
        }

        // Verify ownership first
        const { data: existingPost, error: fetchError } = await dbClient
            .from('posts')
            .select('id, author_id')
            .eq('id', postId)
            .single();

        if (fetchError || !existingPost) {
            return res.status(404).json({ error: 'Post not found' });
        }

        if (existingPost.author_id !== userId) {
            return res.status(403).json({ error: 'Not authorized to edit this post' });
        }

        // Update the post
        const { data: updatedPost, error: updateError } = await dbClient
            .from('posts')
            .update({
                content_text: content.trim(),
                is_edited: true,
                updated_at: new Date().toISOString()
            })
            .eq('id', postId)
            .select('*, author:profiles(username, full_name, avatar_url)')
            .single();

        if (updateError) throw updateError;

        res.json({ post: updatedPost });
    } catch (err) {
        console.error('Update Post Error:', err);
        res.status(500).json({ error: 'Failed to update post' });
    }
};

// Delete Post
exports.DeletePost = async (req, res) => {
    try {
        const userId = req.user.id;
        const postId = req.params.id;

        // Create authenticated client for RLS
        const { createAuthenticatedClient, supabase: anonClient } = require('../utils/supabaseClient');
        let token = req.headers.authorization ? req.headers.authorization.split(' ')[1] : null;
        if (!token && req.cookies && req.cookies['sb-access-token']) {
            token = req.cookies['sb-access-token'];
        }

        let dbClient = anonClient;
        if (token) {
            const authClient = await createAuthenticatedClient(token);
            if (authClient) dbClient = authClient;
        }

        // Verify ownership first
        const { data: existingPost, error: fetchError } = await dbClient
            .from('posts')
            .select('id, author_id')
            .eq('id', postId)
            .single();

        if (fetchError || !existingPost) {
            return res.status(404).json({ error: 'Post not found' });
        }

        if (existingPost.author_id !== userId) {
            return res.status(403).json({ error: 'Not authorized to delete this post' });
        }

        // Delete the post
        const { error: deleteError } = await dbClient
            .from('posts')
            .delete()
            .eq('id', postId);

        if (deleteError) throw deleteError;

        res.json({ success: true, message: 'Post deleted successfully' });
    } catch (err) {
        console.error('Delete Post Error:', err);
        res.status(500).json({ error: 'Failed to delete post' });
    }
};

// Update Comment
exports.UpdateComment = async (req, res) => {
    try {
        const userId = req.user.id;
        const commentId = req.params.id;
        const { content } = req.body;

        if (!content || !content.trim()) {
            return res.status(400).json({ error: 'Content is required' });
        }

        // Create authenticated client for RLS
        const { createAuthenticatedClient, supabase: anonClient } = require('../utils/supabaseClient');
        let token = req.headers.authorization ? req.headers.authorization.split(' ')[1] : null;
        if (!token && req.cookies && req.cookies['sb-access-token']) {
            token = req.cookies['sb-access-token'];
        }

        let dbClient = anonClient;
        if (token) {
            const authClient = await createAuthenticatedClient(token);
            if (authClient) dbClient = authClient;
        }

        // Verify ownership first
        const { data: existingComment, error: fetchError } = await dbClient
            .from('comments')
            .select('id, user_id')
            .eq('id', commentId)
            .single();

        if (fetchError || !existingComment) {
            return res.status(404).json({ error: 'Comment not found' });
        }

        if (existingComment.user_id !== userId) {
            return res.status(403).json({ error: 'Not authorized to edit this comment' });
        }

        // Update the comment
        const { data: updatedComment, error: updateError } = await dbClient
            .from('comments')
            .update({
                content: content.trim(),
                is_edited: true,
                updated_at: new Date().toISOString()
            })
            .eq('id', commentId)
            .select('*, user:profiles(username, full_name, avatar_url)')
            .single();

        if (updateError) throw updateError;

        res.json({ comment: updatedComment });
    } catch (err) {
        console.error('Update Comment Error:', err);
        res.status(500).json({ error: 'Failed to update comment' });
    }
};

// Delete Comment
exports.DeleteComment = async (req, res) => {
    try {
        const userId = req.user.id;
        const commentId = req.params.id;

        // Create authenticated client for RLS
        const { createAuthenticatedClient, supabase: anonClient } = require('../utils/supabaseClient');
        let token = req.headers.authorization ? req.headers.authorization.split(' ')[1] : null;
        if (!token && req.cookies && req.cookies['sb-access-token']) {
            token = req.cookies['sb-access-token'];
        }

        let dbClient = anonClient;
        if (token) {
            const authClient = await createAuthenticatedClient(token);
            if (authClient) dbClient = authClient;
        }

        // Verify ownership first
        const { data: existingComment, error: fetchError } = await dbClient
            .from('comments')
            .select('id, user_id, post_id')
            .eq('id', commentId)
            .single();

        if (fetchError || !existingComment) {
            return res.status(404).json({ error: 'Comment not found' });
        }

        if (existingComment.user_id !== userId) {
            return res.status(403).json({ error: 'Not authorized to delete this comment' });
        }

        // Delete the comment
        const { error: deleteError } = await dbClient
            .from('comments')
            .delete()
            .eq('id', commentId);

        if (deleteError) throw deleteError;

        res.json({ success: true, message: 'Comment deleted successfully', postId: existingComment.post_id });
    } catch (err) {
        console.error('Delete Comment Error:', err);
        res.status(500).json({ error: 'Failed to delete comment' });
    }
};
