import { NextResponse } from 'next/server';
import { getTokenFromCode } from '../../../../lib/auth.js';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');

    if (!code) {
        return NextResponse.json({ error: 'No code provided' }, { status: 400 });
    }

    try {
        const tokenResponse = await getTokenFromCode(code);

        // In "simplest form" production, we redirect back to home 
        // with the token in a cookie for the client to use.
        const response = NextResponse.redirect(new URL('/', request.url));

        // Note: In real production, use HttpOnly, Secure, and a refresh token logic
        response.cookies.set('ms_token', tokenResponse.accessToken, {
            path: '/',
            maxAge: 3600 // 1 hour
        });

        return response;
    } catch (error) {
        console.error('Auth Callback Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
