import type { NextServer, RequestHandler } from 'next/dist/server/next';
import type { IncomingMessage } from 'http';

type Crowi = {
  nextApp: NextServer;
};

type CrowiReq = IncomingMessage & {
  crowi: Crowi;
};

type NextDelegatorResult = {
  delegateToNext: RequestHandler;
};

const MIDDLEWARE_MANIFEST_PATH =
  '/_next/static/development/_clientMiddlewareManifest.js';

function patchManifestContentType(req: IncomingMessage, res: any): void {
  if (!req.url?.includes(MIDDLEWARE_MANIFEST_PATH)) return;

  const originalSetHeader = res.setHeader.bind(res);
  res.setHeader = (name: string, value: any) => {
    if (name.toLowerCase() === 'content-type') {
      return originalSetHeader(
        'Content-Type',
        'application/javascript; charset=utf-8',
      );
    }
    return originalSetHeader(name, value);
  };
}

const delegator = (crowi: Crowi): NextDelegatorResult => {
  const { nextApp } = crowi;
  const handle = nextApp.getRequestHandler();

  const delegateToNext: RequestHandler = (
    req: CrowiReq,
    res,
  ): Promise<void> => {
    req.crowi = crowi;
    patchManifestContentType(req, res);
    return handle(req, res);
  };

  return {
    delegateToNext,
  };
};

export default delegator;
