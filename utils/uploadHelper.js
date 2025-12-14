const { supabase, createAuthenticatedClient } = require('./supabaseClient');

/**
 * Uploads a file to Supabase Storage
 * @param {Object} file - The file object from Multer (buffer, mimetype, originalname)
 * @param {string} bucket - The bucket name ('avatars', 'posts', 'stories')
 * @param {string} userId - The ID of the user uploading the file
 * @param {string} [token] - Optional access token for authenticated upload (RLS)
 * @returns {Promise<string>} - The public URL of the uploaded file
 */
const uploadFile = async (file, bucket, userId, token) => {
    try {
        if (!file) throw new Error('No file provided');

        // Use authenticated client if token is provided, otherwise falls back to anon (likely fails RLS)
        let client = supabase;
        if (token) {
            client = await createAuthenticatedClient(token);
            if (!client) client = supabase; // Fallback if init failed
        }

        // Generate unique file path: userId/timestamp_random.ext
        const fileExt = file.originalname.split('.').pop();
        const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 15)}.${fileExt}`;
        const filePath = `${userId}/${fileName}`;

        const { data, error } = await client.storage
            .from(bucket)
            .upload(filePath, file.buffer, {
                contentType: file.mimetype,
                upsert: false
            });

        if (error) {
            console.error('Supabase Upload Error:', error);
            throw error;
        }

        // Get Public URL (always accessible if public bucket)
        // Note: getPublicUrl is synchronous and doesn't verify permissions usually, 
        // but the file must exist.
        const { data: { publicUrl } } = supabase.storage
            .from(bucket)
            .getPublicUrl(filePath);

        return publicUrl;
    } catch (err) {
        console.error('Upload Helper Error:', err);
        throw new Error('File upload failed');
    }
};

module.exports = { uploadFile };
