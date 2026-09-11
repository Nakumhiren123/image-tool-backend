function getAuthCookieOptions() {
    const isProd = process.env.NODE_ENV === 'production';

    const isCrossOrigin =
        !!process.env.FRONTEND_URL &&
        !process.env.FRONTEND_URL.includes('localhost');

    return {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd && isCrossOrigin ? 'none' : 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/',
    };
}

module.exports = {
    getAuthCookieOptions,
};