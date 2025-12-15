/**
 * auth.js
 * Redux-integrated Authentication Logic
 */

document.addEventListener('DOMContentLoaded', () => {
    const API_URL = (typeof Config !== 'undefined') ? Config.API_URL : '/api';
    const container = document.getElementById('view-auth');

    // Access Redux Store and Actions (exposed globally in store.js)
    const store = window['store'];
    const Actions = window.Actions;
    let sessionToken = null;

    // Toast Helper
    const showToast = (type, msg, title) => {
        if (typeof Toast !== 'undefined') {
            Toast[type](msg, title);
        } else {
            alert(`${title}: ${msg}`);
        }
    };

    // ==========================================
    // 1. STATE SUBSCRIPTION (UI UPDATES)
    // ==========================================
    store.subscribe(() => {
        const state = store.getState();
        updateUI(state);
    });

    function updateUI(state) {
        // 1. View Switching
        document.querySelectorAll('.auth-view').forEach(el => el.classList.remove('active'));
        const target = document.getElementById(`view-${state.view}`);
        if (target) target.classList.add('active');

        // 2. Auth Container Animation (Login vs Signup)
        if (state.view === 'auth') {
            if (state.authContainerActive) {
                container?.classList.add("right-panel-active");
            } else {
                container?.classList.remove("right-panel-active");
            }
        }

        // 3. Onboarding Steps
        if (state.view === 'onboarding') {
            renderOnboardingStep(state.onboarding.step);
            // Sync Input Values if needed (omitted for brevity, usually binding handles this)
        }
    }

    function renderOnboardingStep(stepNum) {
        // Hide all steps
        document.querySelectorAll('.swipe-card').forEach(el => el.classList.remove('active'));
        // Show current
        const step = document.getElementById(`step-${stepNum}`);
        if (step) step.classList.add('active');

        // Update dots (if generic class exists)
        // ... (can be added if strictly required, but CSS might handle active class on parent)
    }

    // ==========================================
    // 2. INITIAL ROUTING & TOKEN CHECK
    // ==========================================
    function handleInitialRoute() {
        const path = window.location.pathname;
        const hash = window.location.hash;
        const searchParams = new URLSearchParams(window.location.search);
        const hashParams = new URLSearchParams(hash.substring(1));

        // Public Profile Redirect: If 'user' param is present, redirect to main app immediately.
        // The main app handles public profile views for both guests and auth users.
        if (searchParams.has('user')) {
            window.location.href = '/' + window.location.search;
            return;
        }

        // Capture onboarding status BEFORE clearing history
        const isOnboarding = path.includes('onboarding') ||
            hashParams.get('onboarding') === 'true' ||
            hash === '#onboarding' ||
            searchParams.get('onboarding') === 'true';



        // Error Handling
        if (searchParams.get('error')) {
            const err = searchParams.get('error');
            const desc = searchParams.get('error_description');
            showToast('error', desc || err, "Authentication Error");
        }

        // Token Handoff (Hash)
        if (hashParams.get('access_token') && hashParams.get('refresh_token')) {
            const at = hashParams.get('access_token');
            const rt = hashParams.get('refresh_token');

            document.cookie = `sb-access-token=${at}; path=/; max-age=3600; SameSite=Lax`;
            document.cookie = `sb-refresh-token=${rt}; path=/; max-age=2592000; SameSite=Lax`;

            sessionToken = at; // Capture token

            window.history.replaceState(null, null, window.location.pathname);
            checkAuthStatus(at, isOnboarding); // Re-verify with explicit token and onboarding status
            // Continue to routing logic so view is set correctly
        }

        // Routing
        if (hashParams.get('type') === 'recovery' || path.includes('reset-password/update')) {
            store.dispatch(Actions.setView('update-password'));
        } else if (path.includes('reset-password')) {
            store.dispatch(Actions.setView('reset-password'));
        } else if (path.includes('verify-email')) {
            store.dispatch(Actions.setView('verify-email'));
        } else if (isOnboarding) {
            store.dispatch(Actions.setView('onboarding'));
        } else {
            store.dispatch(Actions.setView('auth'));
            if (path.includes('signup') || hash === '#signup') {
                store.dispatch(Actions.toggleAuthContainer(true));
            }
        }
    }

    async function checkAuthStatus(explicitToken = null, isOnboarding = false) {
        try {
            const headers = {};
            if (explicitToken) {
                headers['Authorization'] = `Bearer ${explicitToken}`;
            }

            const res = await fetch(`${API_URL}/auth/me`, {
                credentials: 'include',
                headers: headers
            });
            if (res.ok) {
                const data = await res.json();
                if (data.user) {
                    store.dispatch(Actions.setUser(data.user));

                    // If we are NOT onboarding, and the user is logged in, redirect to home.
                    // If we ARE onboarding (passed from handleInitialRoute), stay here.
                    if (!isOnboarding && !window.location.pathname.includes('onboarding') && store.getState().view === 'auth') {
                        // Double check we aren't supposed to be onboarding based on URL
                        const search = new URLSearchParams(window.location.search);
                        if (search.get('onboarding') !== 'true') {
                            const redirectTarget = search.get('redirect');
                            window.location.href = redirectTarget ? decodeURIComponent(redirectTarget) : '/';
                        }
                    }
                }
            }
        } catch (e) { }
    }

    // ==========================================
    // 3. EVENT LISTENERS (DISPATCH ACTIONS)
    // ==========================================

    // Helpers
    const getVal = (id) => document.getElementById(id)?.value;

    // View Toggles
    window.showLogin = () => {
        store.dispatch(Actions.setView('auth'));
        store.dispatch(Actions.toggleAuthContainer(false));
    };

    // Auth Toggles (Signin/Signup)
    const signUpButton = document.getElementById('signUp');
    const signInButton = document.getElementById('signIn');
    if (signUpButton) signUpButton.addEventListener('click', () => store.dispatch(Actions.toggleAuthContainer(true)));
    if (signInButton) signInButton.addEventListener('click', () => store.dispatch(Actions.toggleAuthContainer(false)));

    // Mobile Toggles
    document.getElementById('mobileSignUp')?.addEventListener('click', (e) => {
        e.preventDefault();
        store.dispatch(Actions.toggleAuthContainer(true));
    });
    document.getElementById('mobileSignIn')?.addEventListener('click', (e) => {
        e.preventDefault();
        store.dispatch(Actions.toggleAuthContainer(false));
    });

    // Back Buttons
    document.getElementById('btn-back-verify')?.addEventListener('click', window.showLogin);
    document.getElementById('btn-back-reset')?.addEventListener('click', window.showLogin);

    // --- RESET PASSWORD REQUEST ---
    const btnResetRequest = document.getElementById('btn-reset-request');
    if (btnResetRequest) {
        btnResetRequest.addEventListener('click', async (e) => {
            e.preventDefault();
            const email = getVal('reset-email');

            if (!email) return showToast('warning', "Please enter your email", "Error");

            btnResetRequest.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
            btnResetRequest.disabled = true;

            try {
                const res = await fetch(`${API_URL}/auth/reset-password`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email })
                });
                const data = await res.json();

                if (res.ok) {
                    showToast('success', "Check your email for the reset link", "Link Sent");
                    // Optional: Switch to a "check email" view or just stay here
                } else {
                    // 429 warnings are common here
                    if (res.status === 429) {
                        showToast('warning', data.message || "Too many attempts", "Slow Down");
                    } else {
                        throw new Error(data.error || "Failed to send reset link");
                    }
                }
            } catch (err) {
                showToast('error', err.message, "Error");
            } finally {
                btnResetRequest.innerHTML = 'Send Reset Link';
                btnResetRequest.disabled = false;
            }
        });
    }


    // --- SIGN UP ---
    const btnSignup = document.getElementById('btn-signup');
    if (btnSignup) {
        btnSignup.addEventListener('click', async (e) => {
            e.preventDefault();
            const email = getVal('signup-email');
            const password = getVal('signup-password');
            const username = getVal('signup-username');

            if (!email || !password || !username) return showToast('warning', "Missing Fields", "Error");

            store.dispatch(Actions.setLoading(true));
            btnSignup.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Signing up...';

            try {
                const res = await fetch(`${API_URL}/auth/signup`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password, username })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error);

                store.dispatch(Actions.setView('verify-email'));
                showToast('success', "Account Created", "Success");
            } catch (err) {
                showToast('error', err.message, "Signup Failed");
            } finally {
                store.dispatch(Actions.setLoading(false));
                btnSignup.innerHTML = 'Sign Up';
            }
        });
    }

    // --- SIGN IN ---
    const btnSignin = document.getElementById('btn-signin');
    if (btnSignin) {
        btnSignin.addEventListener('click', async (e) => {
            e.preventDefault();
            const identifier = getVal('signin-identifier');
            const password = getVal('signin-password');

            if (!identifier || !password) return showToast('warning', "Missing Credentials", "Error");

            try {
                const res = await fetch(`${API_URL}/auth/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ identifier, password })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error);

                if (data.session) {
                    localStorage.setItem('sb-access-token', data.session.access_token);
                    localStorage.setItem('sb-refresh-token', data.session.refresh_token);

                    // Set cookies for app-init.js
                    document.cookie = `sb-access-token=${data.session.access_token}; path=/; max-age=3600; SameSite=Lax`;
                    document.cookie = `sb-refresh-token=${data.session.refresh_token}; path=/; max-age=2592000; SameSite=Lax`;

                    // Redirect to home or original destination
                    showToast('success', 'Login successful!', 'Welcome');
                    const urlParams = new URLSearchParams(window.location.search);
                    const redirectTarget = urlParams.get('redirect');
                    setTimeout(() => {
                        window.location.href = redirectTarget ? decodeURIComponent(redirectTarget) : '/';
                    }, 500);
                }
            } catch (err) {
                showToast('error', err.message, "Login Failed");
            }
        });
    }

    // --- ONBOARDING FLOW ---
    // Step 1: Username
    document.getElementById('ob-next-1')?.addEventListener('click', async (e) => {
        const val = getVal('ob-username');
        if (val.length < 3) return showToast('warning', "Username too short", "Invalid");

        const btn = e.target;
        const originalText = btn.innerText;
        btn.innerText = 'Checking...';
        btn.disabled = true;

        try {
            // Check availability via public profile endpoint
            const res = await fetch(`${API_URL}/profile/${val}`);
            if (res.ok) {
                // 200 OK = User exists = Taken
                showToast('error', "Username is already taken", "Unavailable");
            } else if (res.status === 404) {
                // 404 = User not found = Available
                store.dispatch(Actions.updateOnboardingData({ username: val }));
                store.dispatch(Actions.setOnboardingStep(2));
            } else {
                throw new Error('Check failed');
            }
        } catch (err) {
            console.error(err);
            showToast('error', "Could not verify username", "Error");
        } finally {
            btn.innerText = originalText;
            btn.disabled = false;
        }
    });

    // Step 2: Gender
    document.querySelectorAll('.btn-option').forEach(btn => {
        btn.addEventListener('click', () => {
            const gender = btn.dataset.value;
            store.dispatch(Actions.updateOnboardingData({ gender }));
            setTimeout(() => store.dispatch(Actions.setOnboardingStep(3)), 200);
        });
    });

    // Step 3: Avatar
    const avatarInput = document.getElementById('avatar-input');
    document.getElementById('avatar-trigger')?.addEventListener('click', () => avatarInput?.click());
    avatarInput?.addEventListener('change', (e) => {
        if (e.target.files[0]) {
            store.dispatch(Actions.updateOnboardingData({ avatar: e.target.files[0] }));
            // Preview logic kept simple/inline or moved to UI update if strict Redux preferred, 
            // but reading file for preview is often side-effecty.
            const reader = new FileReader();
            reader.onload = (ev) => document.getElementById('avatar-preview').src = ev.target.result;
            reader.readAsDataURL(e.target.files[0]);
        }
    });

    document.getElementById('ob-next-3')?.addEventListener('click', () => store.dispatch(Actions.setOnboardingStep(4)));
    document.getElementById('ob-skip-3')?.addEventListener('click', () => {
        store.dispatch(Actions.updateOnboardingData({ avatar: null }));
        store.dispatch(Actions.setOnboardingStep(4));
    });

    // Step 4: Submit
    const obSubmit = document.getElementById('ob-submit');
    if (obSubmit) {
        obSubmit.addEventListener('click', async () => {
            const pwd = getVal('ob-password');
            const cfm = getVal('ob-confirm-password');

            if (pwd.length < 8) return showToast('warning', "Password too short", "Error");
            if (pwd !== cfm) return showToast('error', "Mismatch", "Error");

            store.dispatch(Actions.updateOnboardingData({ password: pwd }));

            // Submit
            obSubmit.innerHTML = 'Setting up...';
            obSubmit.disabled = true;

            const { onboarding } = store.getState();
            const { username, gender, avatar, password } = onboarding.data;

            const formData = new FormData();
            formData.append('username', username);
            formData.append('gender', gender);
            formData.append('password', password); // Actually using the local var 'pwd' is safer due to async state updates potentially lag
            if (avatar) formData.append('avatar', avatar);

            try {
                const headers = {};
                if (sessionToken) {
                    headers['Authorization'] = `Bearer ${sessionToken}`;
                }

                const res = await fetch(`${API_URL}/auth/onboarding`, {
                    method: 'POST',
                    headers: headers,
                    body: formData
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error);

                // Update Session if provided (likely due to password change invalidating old one)
                if (data.session) {
                    const { access_token, refresh_token } = data.session;

                    // Update Cookies
                    document.cookie = `sb-access-token=${access_token}; path=/; max-age=3600; SameSite=Lax`;
                    document.cookie = `sb-refresh-token=${refresh_token}; path=/; max-age=2592000; SameSite=Lax`;

                    // Update LocalStorage
                    localStorage.setItem('sb-access-token', access_token);
                    localStorage.setItem('sb-refresh-token', refresh_token);

                    // Update Stores/Runtime vars
                    if (typeof sessionToken !== 'undefined') sessionToken = access_token;
                    store.dispatch(Actions.setUser(data.user || store.getState().user)); // Ensure user is fresh
                }

                showToast('success', "Profile Ready!", "Welcome");
                window.location.href = '/';
            } catch (err) {
                showToast('error', err.message, "Error");
                obSubmit.innerHTML = 'Complete Setup';
                obSubmit.disabled = false;
            }
        });
    }

    // --- SOCIAL LOGIN ---
    const socialBtns = document.querySelectorAll('.social');
    socialBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            if (btn.id && btn.id.includes('google')) {
                window.location.href = `${API_URL}/auth/google`;
            } else {
                showToast('info', "Social login is currently limited to Google.", "Coming Soon");
            }
        });
    });

    // Init
    handleInitialRoute();
    window.addEventListener('popstate', handleInitialRoute);
});
