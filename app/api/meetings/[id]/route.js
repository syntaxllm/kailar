
import { NextResponse } from 'next/server';
import { deleteMeeting } from '../../../../lib/backend-adapter.js';

export async function DELETE(request, { params }) {
    try {
        const { id } = params;
        if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });

        await deleteMeeting(id);
        return NextResponse.json({ success: true, message: `Meeting ${id} deleted` });
    } catch (error) {
        console.error('Delete error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
