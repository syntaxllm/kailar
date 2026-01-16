import { NextResponse } from 'next/server';
import { getMeeting } from '../../../../lib/backend-adapter.js';

export async function GET(request, { params }) {
  const id = params.id;
  const meeting = await getMeeting(id);
  if (!meeting) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(meeting);
}
