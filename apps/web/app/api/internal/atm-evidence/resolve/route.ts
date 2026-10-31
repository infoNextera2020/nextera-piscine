import { handleAtmEvidenceRequest } from '../../../../../lib/atm-evidence/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function POST(request: Request) {
  return handleAtmEvidenceRequest(request, 'resolve', process.env);
}
