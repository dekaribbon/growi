import type { IUserHasId } from '@growi/core/dist/interfaces';
import { SCOPE } from '@growi/core/dist/interfaces';
import express from 'express';
import mongoose from 'mongoose';

import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import adminRequired from '~/server/middlewares/admin-required';
import loginRequiredFactory from '~/server/middlewares/login-required';
import loggerFactory from '~/utils/logger';

import { clearCache } from '../../features/page-write-permission/server/services';

import type Crowi from '~/server/crowi';

const logger = loggerFactory('growi:routes:apiv3:page-write-permissions');

const CONFIG_PAGE_PATH = '/page-write-permissions';

module.exports = (crowi: Crowi) => {
  const loginRequiredStrictly = loginRequiredFactory(crowi);
  const adminRequiredMiddleware = adminRequired(crowi);
  const router = express.Router();

  router.get(
    '/',
    accessTokenParser([SCOPE.READ.ADMIN.ALL], { acceptLegacy: true }),
    loginRequiredStrictly,
    adminRequiredMiddleware,
    async (_req, res) => {
      try {
        const Page = mongoose.model('Page') as any;
        const page = await Page.findOne({
          path: CONFIG_PAGE_PATH,
        }).populate('revision');

        const body: string = page?.revision?.body ?? '';
        const jsonMatch = body.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
        let config = { rules: [] };
        if (jsonMatch) {
          try {
            config = JSON.parse(jsonMatch[1]);
          }
          catch { /* return default empty config */ }
        }

        return res.json({ config });
      }
      catch (err) {
        logger.error({ err }, 'Failed to fetch page write permissions config');
        return res.status(500).json({ message: 'Internal server error' });
      }
    },
  );

  router.put(
    '/',
    accessTokenParser([SCOPE.WRITE.ADMIN.ALL], { acceptLegacy: true }),
    loginRequiredStrictly,
    adminRequiredMiddleware,
    async (req, res) => {
      const user = req.user as IUserHasId;
      const { config } = req.body as { config: { rules: unknown[] } };

      if (!config?.rules || !Array.isArray(config.rules)) {
        return res.status(400).json({ message: 'Invalid config format' });
      }

      try {
        const Page = mongoose.model('Page') as any;
        const Revision = mongoose.model('Revision');

        const page = await Page.findOne({ path: CONFIG_PAGE_PATH }).populate(
          'revision',
        );

        if (!page) {
          return res
            .status(404)
            .json({ message: 'Config page not found' });
        }

        const jsonBody = '```json\n' + JSON.stringify(config, null, 2) + '\n```';

        const newRevision = await Revision.create({
          pageId: page._id,
          body: jsonBody,
          format: 'markdown',
          author: user._id,
          origin: 'editor',
        });

        page.revision = newRevision._id;
        page.lastUpdateUser = user._id;
        page.updatedAt = new Date();
        await page.save();

        clearCache();

        return res.json({ ok: true });
      }
      catch (err) {
        logger.error({ err }, 'Failed to update page write permissions config');
        return res.status(500).json({ message: 'Internal server error' });
      }
    },
  );

  return router;
};
