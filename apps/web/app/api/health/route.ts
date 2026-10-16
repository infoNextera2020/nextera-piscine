export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(
    { status: 'ok', application: 'nextera-piscine', foundation: '001' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
