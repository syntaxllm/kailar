import { NextResponse } from 'next/server';
import { getMeeting } from '../../../../lib/backend-adapter.js';
import { generateSummary } from '../../../../lib/llm-service.js';

export async function GET(request, { params }) {
    try {
        const { id } = params;
        const meeting = await getMeeting(id);

        if (!meeting) {
            return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
        }

        const result = await generateSummary(meeting);
        return NextResponse.json(result);
    } catch (error) {
        console.error('Summary generation error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to generate summary' },
            { status: 500 }
        );
    }
}
