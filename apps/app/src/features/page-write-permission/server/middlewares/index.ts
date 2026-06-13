import type { IUserHasId } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { NextFunction, Response } from 'express';
import mongoose from 'mongoose';

import { isUserAllowedToWrite } from '../services';

interface RequestWithUser {
  user?: IUserHasId;
  body?: Record<string, unknown>;
  params?: Record<string, string>;
}

function isValidObjectId(id: string): boolean {
  return mongoose.Types.ObjectId.isValid(id);
}

export async function pageWritePermissionForPageIdMiddleware(
  req: RequestWithUser,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const user = req.user as IUserHasId | undefined;
  if (!user) {
    next();
    return;
  }

  const body = req.body as Record<string, unknown> | undefined;
  const pageId = (body?.pageId as string) || (req.params?.pageId as string);
  if (!pageId) {
    next();
    return;
  }

  if (!isValidObjectId(pageId)) {
    next();
    return;
  }

  try {
    const Page = mongoose.model('Page');
    const page = await Page.findById(pageId).select('path').lean();
    if (!page?.path) {
      next();
      return;
    }

    const allowed = await isUserAllowedToWrite(page.path as string, user);
    if (!allowed) {
      (res as any).apiv3Err(
        new ErrorV3(
          'You do not have permission to edit this page.',
          'forbidden',
        ),
        403,
      );
      return;
    }
  } catch {
    (res as any).apiv3Err(
      new ErrorV3('Internal server error', 'internal_server_error'),
      500,
    );
    return;
  }

  next();
}
