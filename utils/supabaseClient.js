require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { createServerClient } = require('@supabase/ssr');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

let supabase = null;
let clientInitError = null;

if (!supabaseUrl || !supabaseKey) {
    const missing = [];
    if (!supabaseUrl) missing.push('SUPABASE_URL');
    if (!supabaseKey) missing.push('SUPABASE_ANON_KEY');
    clientInitError = `Missing required environment variables: ${missing.join(', ')}`;
    console.error(`CRITICAL: ${clientInitError}`); // Log to Vercel console
} else {
    try {
        // Singleton for generic server-side ops (non-PKCE dependent or manual token handling)
        supabase = createClient(supabaseUrl, supabaseKey, {
            auth: {
                flowType: 'pkce',
                detectSessionInUrl: false,
            }
        });
    } catch (e) {
        clientInitError = `Supabase initialization failed: ${e.message}`;
        console.error(clientInitError);
    }
}

const createAuthenticatedClient = async (token) => {
    if (!supabase) return null; // Fail fast if init failed

    // Create a new client with the Auth header pre-set
    // This bypasses the need for setSession and refresh tokens
    const client = createClient(supabaseUrl, supabaseKey, {
        global: {
            headers: {
                Authorization: `Bearer ${token}`
            }
        },
        auth: {
            autoRefreshToken: false,
            persistSession: false,
            detectSessionInUrl: false
        }
    });

    return client;
};

const createContextClient = (req, res) => {
    if (!supabaseUrl || !supabaseKey) return null;

    return createServerClient(supabaseUrl, supabaseKey, {
        cookies: {
            getAll() {
                return Object.keys(req.cookies).map((name) => ({ name, value: req.cookies[name] }));
            },
            setAll(cookiesToSet) {
                cookiesToSet.forEach(({ name, value, options }) => {
                    if (!res.headersSent) {
                        res.cookie(name, value, options);
                    } else {
                        console.warn(`[Supabase] Should set cookie ${name} but headers sent.`);
                    }
                });
            },
        },
    });
};

module.exports = { supabase, createAuthenticatedClient, createContextClient };
