import { serviceApplication } from '../../../../../lib/submissions/application';
export const POST = (request: Request) => serviceApplication(request, true);
