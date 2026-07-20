import { NextResponse } from 'next/server';

// In-memory state (persists while function is warm)
let currentState = null;
let lastUpdate = 0;

export async function POST(request) {
  try {
    const data = await request.json();
    currentState = data;
    lastUpdate = Date.now();
    return NextResponse.json({ ok: true, ts: lastUpdate });
  } catch (e) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
}

export async function GET() {
  return NextResponse.json({
    state: currentState,
    lastUpdate,
    age: currentState ? Date.now() - lastUpdate : null
  });
}
