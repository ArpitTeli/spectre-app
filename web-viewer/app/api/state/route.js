import { NextResponse } from 'next/server';

let currentState = null;
let lastUpdate = 0;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function POST(request) {
  try {
    const data = await request.json();
    currentState = data;
    lastUpdate = Date.now();
    return NextResponse.json({ ok: true, ts: lastUpdate }, { headers: corsHeaders });
  } catch (e) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: corsHeaders });
  }
}

export async function GET() {
  return NextResponse.json({
    state: currentState,
    lastUpdate,
    age: currentState ? Date.now() - lastUpdate : null
  }, { headers: corsHeaders });
}
