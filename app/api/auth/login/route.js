import { NextResponse } from 'next/server';
import { getAuthUrl } from '../../../../lib/auth.js';

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const prompt = searchParams.get('prompt'); // 'select_account' to show account picker
        
        const url = await getAuthUrl(prompt);
        return NextResponse.redirect(url);
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
