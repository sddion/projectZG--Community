const { supabase, createAuthenticatedClient } = require('../utils/supabaseClient');
const crypto = require('crypto');

// --- HELPER FUNCTIONS ---

const setAuthCookies = (res, session) => {
    const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
        path: '/',
        maxAge: (session.expires_in || 3600) * 1000
    };

    const refreshCookieOptions = {
        ...cookieOptions,
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    };

    res.cookie('sb-access-token', session.access_token, cookieOptions);
    res.cookie('sb-refresh-token', session.refresh_token, refreshCookieOptions);
};

// Shared password reset logic
async function handlePasswordResetRequest(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${process.env.APP_URL || 'http://localhost:3000'}/reset-password/update`,
    });
    if (error) throw error;
}

// --- CONTROLLER METHODS ---

const signup = async (req, res) => {
    const { email, password, username, fullName } = req.body;
    const trimmedEmail = email?.trim();
    const trimmedUsername = username?.trim();
    const trimmedFullName = fullName?.trim();

    if (!trimmedEmail || !password || !trimmedUsername) {
        return res.status(400).json({ error: 'Email, password, and username are required.' });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
        return res.status(400).json({ error: 'Please provide a valid email address.' });
    }

    // Username validation
    if (trimmedUsername.length < 3 || trimmedUsername.length > 30) {
        return res.status(400).json({ error: 'Username must be 3-30 characters.' });
    }
    if (!/^[a-zA-Z0-9_]+$/.test(trimmedUsername)) {
        return res.status(400).json({ error: 'Username can only contain letters, numbers, and underscores.' });
    }

    // Password validation
    if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    const hasLower = /[a-z]/.test(password);
    const hasUpper = /[A-Z]/.test(password);
    const hasDigit = /\d/.test(password);
    const hasSymbol = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);

    if (!hasLower || !hasUpper || !hasDigit || !hasSymbol) {
        return res.status(400).json({ error: 'Password must include lowercase, uppercase, number, and symbol.' });
    }

    // Full name validation
    if (trimmedFullName && trimmedFullName.length > 100) {
        return res.status(400).json({ error: 'Full name must be 100 characters or less.' });
    }

    try {
        const { data, error } = await supabase.auth.signUp({
            email: trimmedEmail,
            password,
            options: {
                data: {
                    username: trimmedUsername,
                    full_name: trimmedFullName || ''
                }
            }
        });

        if (error) throw error;

        if (data.session) {
            setAuthCookies(res, data.session);
        }

        res.json({ message: 'Sign up successful! Please check your email.', user: data.user });
    } catch (err) {
        console.error('Signup error:', err);

        // Return generic error or map known errors to safe messages
        const userFriendlyErrors = {
            'User already registered': 'An account with this email already exists.',
            'Invalid email': 'Please provide a valid email address.',
        };

        const errorMessage = userFriendlyErrors[err.message] || 'Sign up failed. Please try again later.';
        res.status(400).json({ error: errorMessage });
    }
};

const login = async (req, res) => {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
        return res.status(400).json({ error: 'Email/Username and password are required.' });
    }

    try {
        let emailToUse = identifier;

        // Simple check for username vs email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(identifier)) {
            // Strict failure for username login without backend lookup implementation
            return res.status(400).json({ error: 'Login with Username not fully supported yet. Please use Email.' });
        }

        const { data, error } = await supabase.auth.signInWithPassword({
            email: emailToUse,
            password
        });
        if (error) throw error;

        // Set HttpOnly Cookies
        setAuthCookies(res, data.session);

        res.json({ message: 'Login successful!', user: data.user });
    } catch (err) {
        // Log the actual error server-side for debugging
        console.error('Login error:', err);

        // Return safe, generic messages to client
        if (err.message?.includes('Invalid login credentials')) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        // Default to 500 for unexpected errors
        res.status(500).json({ error: 'An error occurred during login. Please try again later.' });
    }
};

const googleAuth = async (req, res) => {
    try {
        // Construct the base URL for redirection 
        // In local dev: http://localhost:3000
        // In prod: process.env.ALLOWED_ORIGIN or derived from req with whitelist check
        const allowedOrigins = (process.env.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGIN || '').split(',').map(o => o.trim()).filter(Boolean);
        const requestOrigin = `${req.protocol}://${req.get('host')}`;
        const origin = allowedOrigins.includes(requestOrigin) ? requestOrigin : allowedOrigins[0];

        if (!origin) {
            throw new Error('ALLOWED_ORIGIN or ALLOWED_ORIGINS environment variable must be set');
        }

        // Use request-scoped client to handle code verifier cookie
        const supabaseClient = require('../utils/supabaseClient').createContextClient(req, res);

        if (!supabaseClient) {
            console.error('Supabase client is not initialized. Check server environment variables.');
            return res.status(500).json({ error: 'Database connection unavailable' });
        }

        const { data, error } = await supabaseClient.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: `${origin}/api/auth/callback`,
                queryParams: {
                    access_type: 'offline',
                    prompt: 'consent'
                }
            }
        });

        if (error) throw error;

        if (data.url) {
            // Redirect the user to the Google OAuth consent page
            res.redirect(data.url);
        } else {
            res.status(500).json({ error: 'Failed to generate OAuth URL' });
        }

    } catch (err) {
        console.error('OAuth Error:', err);
        res.status(500).json({
            error: 'Internal Server Error',
            details: err.message,
            env_check: {
                has_origin: !!process.env.ALLOWED_ORIGIN,
                has_origins: !!process.env.ALLOWED_ORIGINS
            }
        });
    }
};

const googleCallback = async (req, res) => {
    const { code, error, error_description } = req.query;

    console.log('\n\n==================================================');
    console.log('[Auth-Callback] HIT');
    console.log('[Auth-Callback] URL:', req.originalUrl);
    console.log('[Auth-Callback] Params:', { code: !!code, error, state: !!req.query.state });
    console.log('[Auth-Callback] Cookies:', JSON.stringify(req.cookies));
    console.log('==================================================\n\n');

    if (error) {
        const description = error_description || 'Unknown error';
        console.error('[Auth-Callback] Error param:', error, description);
        return res.redirect(`/auth?error=${encodeURIComponent(error)}&error_description=${encodeURIComponent(description)}`);
    }

    if (!code) {
        console.error('[Auth-Callback] No code param');
        return res.redirect('/auth?error=no_code');
    }

    try {
        // Use request-scoped client to retrieve code verifier from cookie
        const supabaseClient = require('../utils/supabaseClient').createContextClient(req, res);

        const { data, error } = await supabaseClient.auth.exchangeCodeForSession(code);

        if (error) {
            console.error('[Auth-Callback] Code Exchange Error:', error);
            // Check for specific PKCE error for better feedback
            if (error.name === 'AuthApiError' && error.message.includes('code verifier')) {
                return res.redirect(`/auth?error=${encodeURIComponent('Authentication mismatch. Please try again.')}`);
            }
            return res.redirect(`/auth?error=${encodeURIComponent(error.message)}`);
        }

        const { session } = data;

        // Check if headers are already sent
        if (res.headersSent) {
            console.error('[Auth-Callback] Headers already sent! Cannot set cookies.');
            return;
        }

        // Set HttpOnly Cookies (Server-side backup)
        // IMPORTANT: Explicitly set path: '/' so cookies are available everywhere
        setAuthCookies(res, session);

        // Check if user has completed onboarding (has a username in profiles table)
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('username')
            .eq('id', session.user.id)
            .single();


        // Construct cleanup hash for client-side token handoff
        const hash = `access_token=${session.access_token}&refresh_token=${session.refresh_token}`;

        // Ensure username is not just an empty string if a trigger created the row
        if (profile && profile.username && profile.username.trim() !== '') {
            // Existing user -> Home
            res.redirect(302, `/#${hash}`);
        } else {
            // New user -> Onboarding
            // Use query param which auth.js already looks for
            res.redirect(302, `/auth?onboarding=true#${hash}`);
        }

    } catch (err) {
        console.error('[Auth-Callback] Unexpected Error:', err);
        res.redirect('/auth?error=server_error');
    }
};

const getMe = async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

        if (!token) {
            return res.status(401).json({ error: 'Not authenticated (Missing Token)' });
        }

        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (error || !user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        res.json({ user });
    } catch (err) {
        console.error('Me endpoint error:', err);
        res.status(500).json({ error: 'Server error' });
    }
};

const logout = async (req, res) => {
    try {
        // We will prioritize cookies, but also check auth header for compatibility
        let accessToken = req.cookies['sb-access-token'];

        if (!accessToken) {
            const authHeader = req.headers.authorization;
            if (authHeader && authHeader.startsWith('Bearer ')) {
                accessToken = authHeader.split(' ')[1];
            }
        }

        if (!accessToken || accessToken.trim() === '') {
            // If no token, just clear cookies and return success (idempotent)
            res.clearCookie('sb-access-token');
            res.clearCookie('sb-refresh-token');
            return res.json({ message: 'Logout successful (no active session found).' });
        }

        // Sign out the user from Supabase
        const { error } = await supabase.auth.admin.signOut(accessToken);

        if (error) {
            console.error('Failed to sign out user:', error);
            // Even if upstream fails, clear local cookies
            res.clearCookie('sb-access-token');
            res.clearCookie('sb-refresh-token');
            return res.status(401).json({ error: 'Invalid or expired token.' });
        }

        // Clear cookies
        res.clearCookie('sb-access-token');
        res.clearCookie('sb-refresh-token');

        res.json({ message: 'Logout successful!' });
    } catch (err) {
        res.status(500).json({ error: err.message || 'Failed to logout.' });
    }
};

const resetPassword = async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    try {
        await handlePasswordResetRequest(email);
        res.json({ message: 'Password reset link sent to your email.' });
    } catch (err) {
        console.error('Password reset error:', err);
        res.status(400).json({ error: 'Failed to send password reset email. Please try again.' });
    }
};

const updatePassword = async (req, res) => {
    const { password, accessToken } = req.body;

    if (!password) {
        return res.status(400).json({ error: 'New password is required' });
    }

    if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }

    if (!accessToken) {
        return res.status(400).json({ error: 'Access token is required' });
    }


    try {
        // Set the session with the access token from the magic link
        const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: accessToken // For password recovery, access token works
        });

        if (sessionError) throw sessionError;

        // Update the user's password
        const { data, error } = await supabase.auth.updateUser({
            password: password
        });

        if (error) throw error;

        res.json({ message: 'Password updated successfully!' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

const onboarding = async (req, res) => {
    try {
        // 1. Verify Authentication
        const authHeader = req.headers.authorization;
        // Also check cookies? For now, stick to logic in file which uses header

        if (!authHeader) {
            return res.status(401).json({ error: 'Missing Authorization header' });
        }

        if (!authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Invalid Authorization scheme, Bearer expected' });
        }
        const token = authHeader.slice(7);
        const refreshToken = req.headers['x-refresh-token'];

        // Create Authenticated Client
        const supabase = await createAuthenticatedClient(token, refreshToken);

        // Verify validity of the token by getting the user
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return res.status(401).json({ error: 'Invalid or expired token', details: authError });
        }

        const userId = user.id;
        const { username, gender, password } = req.body;


        // 2. Validate Inputs
        if (!username || username.length < 3) {
            return res.status(400).json({ error: 'Username must be at least 3 characters' });
        }

        if (!password || password.length < 8) {
            return res.status(400).json({ error: 'Password is required (min 8 characters)' });
        }

        let avatarUrl = null;

        // 3. Handle Avatar Upload
        if (req.file) {
            const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
            if (!allowedMimeTypes.includes(req.file.mimetype)) {
                return res.status(400).json({ error: 'Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.' });
            }

            const fileExt = req.file.mimetype.split('/')[1] || 'img';
            const fileName = `avatar_${Date.now()}.${fileExt}`;
            const filePath = `${userId}/${fileName}`;

            // Upload to 'avatars' bucket
            const { error: uploadError } = await supabase.storage
                .from('avatars')
                .upload(filePath, req.file.buffer, {
                    contentType: req.file.mimetype,
                    upsert: true
                });

            if (uploadError) {
                console.error('Upload Error:', uploadError);
                throw new Error('Failed to upload avatar');
            }

            // Get Public URL
            const { data } = supabase.storage.from('avatars').getPublicUrl(filePath);
            avatarUrl = data.publicUrl;

            // Insert into Media Table
            const { error: mediaError } = await supabase.from('media').insert({
                user_id: userId,
                bucket_name: 'avatars',
                file_path: filePath,
                file_name: fileName,
                file_size: req.file.size,
                mime_type: req.file.mimetype,
                is_public: true
            });

            if (mediaError) {
                console.error('Media Insert Error:', mediaError);
                // Non-fatal? Maybe, but good to track.
            }
        }

        // 4. Update Profile
        const updates = {
            username: username,
            gender: gender,
            updated_at: new Date()
        };

        if (avatarUrl) {
            updates.avatar_url = avatarUrl;
        }

        const { error: profileError } = await supabase
            .from('profiles')
            .update(updates)
            .eq('id', userId);

        if (profileError) {
            // Handle unique constraint violation for username
            if (profileError.code === '23505') {
                return res.status(409).json({ error: 'Username is already taken' });
            }
            throw profileError;
        }

        const { error: passwordError } = await supabase.auth.updateUser({
            password: password
        });

        if (passwordError) {
            throw passwordError;
        }

        res.json({
            message: 'Profile completed successfully!',
            avatar_url: avatarUrl
        });

    } catch (err) {
        console.error('Onboarding Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

module.exports = {
    signup,
    login,
    googleAuth,
    googleCallback,
    getMe,
    logout,
    resetPassword,
    updatePassword,
    onboarding
};
