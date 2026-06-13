import type { IUserHasId } from '@growi/core/dist/interfaces';
import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';

import { isUserAllowedToWrite } from '../services';

export async function pageWritePermissionForPageIdMiddleware(
  req: Request,
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

  try {
    const Page = mongoose.model('Page');
    const page = await Page.findById(pageId).select('path').lean();
    if (!page?.path) {
      next();
      return;
    }

    const allowed = await isUserAllowedToWrite(page.path as string, user);
    if (!allowed) {
      res.status(403).json({
        message: 'You do not have permission to edit this page.',
      });
      return;
    }
  } catch {
    res.status(500).json({ message: 'Internal server error' });
    return;
  }

  next();
}
