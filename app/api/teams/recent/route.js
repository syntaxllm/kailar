import { NextResponse } from 'next/server';
import { listRecentMeetings } from '../../../../lib/ms-graph.js';

export async function GET(request) {
    const token = request.cookies.get('ms_token')?.value;

    if (!token) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const meetings = await listRecentMeetings(token);
        return NextResponse.json(meetings);
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
