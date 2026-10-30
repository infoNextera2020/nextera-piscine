import { checkpointAnswerApi } from '../../../../../lib/checkpoints/answer-backends';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = checkpointAnswerApi.drafts.GET;
export const POST = checkpointAnswerApi.drafts.POST;
