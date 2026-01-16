import { NextResponse } from 'next/server';
import { getAuthUrl } from '../../../lib/auth.js';

export async function GET() {
    try {
        const url = await getAuthUrl();
        return NextResponse.redirect(url);
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
