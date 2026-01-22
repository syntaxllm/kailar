import { NextResponse } from 'next/server';

/**
 * GET /api/user/info
 * Returns the current logged-in user's information from Microsoft Graph
 */
export async function GET(request) {
    const token = request.cookies.get('ms_token')?.value;

    if (!token) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        // Get user info from Microsoft Graph
        const response = await fetch('https://graph.microsoft.com/v1.0/me', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Graph API Error: ${response.status}`, errorText);
            return NextResponse.json({ error: 'Failed to fetch user info' }, { status: response.status });
        }

        const userData = await response.json();
        
        return NextResponse.json({
            displayName: userData.displayName,
            email: userData.mail || userData.userPrincipalName,
            id: userData.id,
            jobTitle: userData.jobTitle,
            officeLocation: userData.officeLocation
        });
    } catch (error) {
        console.error('Error fetching user info:', error);
        return NextResponse.json({ error: error.message || 'Failed to fetch user information' }, { status: 500 });
    }
}
