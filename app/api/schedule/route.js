import { NextResponse } from 'next/server';
import { saveScheduledRecording, getScheduledRecordings, deleteScheduledRecording } from '../../../lib/storage-prod.js';
import { initScheduler, tickScheduler } from '../../../lib/scheduler.js';

// Initialize scheduler on first load of this API
let initialized = false;

export async function GET() {
    if (!initialized) {
        initScheduler();
        initialized = true;
    }

    const schedules = await getScheduledRecordings();
    return NextResponse.json(schedules);
}

export async function POST(request) {
    if (!initialized) {
        initScheduler();
        initialized = true;
    }

    try {
        const body = await request.json();
        const { meeting } = body;

        if (!meeting) return NextResponse.json({ error: 'Meeting data required' }, { status: 400 });

        await saveScheduledRecording({
            id: meeting.id,
            subject: meeting.subject,
            start: meeting.start,
            end: meeting.end,
            webUrl: meeting.webUrl,
            status: 'scheduled',
            createdAt: new Date().toISOString()
        });

        // Forced tick to see if it should join immediately
        tickScheduler();

        return NextResponse.json({ status: 'scheduled', meetingId: meeting.id });
    } catch (err) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

export async function DELETE(request) {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });

    await deleteScheduledRecording(id);
    return NextResponse.json({ status: 'deleted' });
}
