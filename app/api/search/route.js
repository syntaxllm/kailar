import { NextResponse } from 'next/server';
import { searchEntries } from '../../../lib/backend-adapter.js';

export async function GET(request) {
  const q = request.nextUrl.searchParams.get('q') || '';
  const meetingId = request.nextUrl.searchParams.get('meetingId');
  const results = await searchEntries(q, meetingId);
  return NextResponse.json(results);
}
