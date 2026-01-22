import { NextResponse } from 'next/server';
import { getMeetingInfo } from '../../../../lib/ms-graph.js';

/**
 * POST /api/teams/request-access
 * Body: { meetingId: string, accessToken: string }
 * 
 * Sends a permission request to the meeting organizer
 */
export async function POST(request) {
    try {
        const body = await request.json();
        const { meetingId, accessToken } = body;

        if (!meetingId || !accessToken) {
            return NextResponse.json({ error: 'meetingId and accessToken are required' }, { status: 400 });
        }

        // Get meeting info to find organizer
        const meetingInfo = await getMeetingInfo(accessToken, meetingId);
        
        // Extract organizer email
        const organizerEmail = meetingInfo.participants?.organizer?.identity?.user?.email || 
                             meetingInfo.participants?.organizer?.upn ||
                             meetingInfo.organizer?.emailAddress?.address;
        
        const organizerName = meetingInfo.participants?.organizer?.identity?.user?.displayName ||
                             meetingInfo.organizer?.emailAddress?.name ||
                             'Meeting Organizer';

        if (!organizerEmail) {
            return NextResponse.json({ error: 'Could not find organizer email for this meeting' }, { status: 404 });
        }

        // Get current user info
        const userResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        const currentUser = await userResponse.json();
        const requesterName = currentUser.displayName || currentUser.mail || 'A meeting participant';
        const requesterEmail = currentUser.mail || currentUser.userPrincipalName;

        // TODO: Send email to organizer (you can integrate with email service here)
        // For now, we'll return the organizer info so the frontend can handle it
        // You could integrate with:
        // - Microsoft Graph API to send email
        // - SendGrid, Mailgun, or other email service
        // - A notification system

        console.log(`Permission request from ${requesterEmail} (${requesterName}) for meeting "${meetingInfo.subject || meetingId}" to organizer ${organizerEmail}`);

        return NextResponse.json({
            success: true,
            message: 'Permission request prepared',
            organizerEmail,
            organizerName,
            meetingSubject: meetingInfo.subject || 'Meeting',
            requesterEmail,
            requesterName,
            // Include a mailto link for now (frontend can use this)
            mailtoLink: `mailto:${organizerEmail}?subject=Request%20Access%20to%20Meeting%20Transcript&body=Hi%20${encodeURIComponent(organizerName)}%2C%0A%0AI%20would%20like%20to%20request%20access%20to%20the%20transcript%20for%20the%20meeting%3A%20${encodeURIComponent(meetingInfo.subject || 'Meeting')}%0A%0APlease%20grant%20me%20permission%20to%20access%20the%20meeting%20transcript%20and%20recording.%0A%0AThank%20you%2C%0A${encodeURIComponent(requesterName)}`
        });
    } catch (error) {
        console.error('Request Access Failed:', error);
        return NextResponse.json({ error: error.message || 'Failed to process permission request' }, { status: 500 });
    }
}
