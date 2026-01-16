import { NextResponse } from 'next/server';
import { getMeeting } from '../../../../lib/backend-adapter.js';
import { extractActionItems } from '../../../../lib/llm-service.js';

export async function GET(request, { params }) {
    try {
        const { id } = params;
        const meeting = await getMeeting(id);

        if (!meeting) {
            return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
        }

        const result = await extractActionItems(meeting);
        return NextResponse.json(result);
    } catch (error) {
        console.error('Action item extraction error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to extract action items' },
            { status: 500 }
        );
    }
}
