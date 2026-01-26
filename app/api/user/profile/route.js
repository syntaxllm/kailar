import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET() {
    try {
        const cookieStore = await cookies();
        const tokenCookie = cookieStore.get('ms_token');

        if (!tokenCookie) {
            return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
        }

        const accessToken = tokenCookie.value;

        // Fetch user profile from Microsoft Graph
        const graphRes = await fetch('https://graph.microsoft.com/v1.0/me', {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        if (!graphRes.ok) {
            return NextResponse.json({ error: 'Failed to fetch profile' }, { status: graphRes.status });
        }

        const data = await graphRes.json();

        return NextResponse.json({
            displayName: data.displayName,
            mail: data.mail || data.userPrincipalName,
            id: data.id
        });
    } catch (error) {
        console.error('Profile fetch error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
