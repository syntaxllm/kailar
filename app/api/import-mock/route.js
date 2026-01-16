import { NextResponse } from 'next/server';
import { importMock } from '../../../lib/backend-adapter.js';

export async function POST(request) {
  try {
    const url = new URL(request.url);
    const force = url.searchParams.get('force') === 'true';
    const summary = await importMock({ force });
    return NextResponse.json(summary);
  } catch (err) {
    console.error('import-mock failed', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
