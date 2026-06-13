import { SCOPE } from '@growi/core/dist/interfaces';
import express from 'express';
import mongoose from 'mongoose';

import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import adminRequired from '~/server/middlewares/admin-required';
import loginRequiredFactory from '~/server/middlewares/login-required';
import loggerFactory from '~/utils/logger';

import type { PageWritePermissionsConfigModel } from '~/features/page-write-permission/server/models/page-write-permissions-config';
import { clearCache } from '~/features/page-write-permission/server/services';

const logger = loggerFactory('growi:routes:apiv3:page-write-permissions');

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
        const Config = mongoose.model(
          'PageWritePermissionsConfig',
        ) as PageWritePermissionsConfigModel;
        const config = await Config.getConfig();
        return res.json({ config });
      } catch (err) {
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
      const { config } = req.body as {
        config: { rules: unknown[] };
      };

      if (!config?.rules || !Array.isArray(config.rules)) {
        return res.status(400).json({ message: 'Invalid config format' });
      }

      try {
        const Config = mongoose.model(
          'PageWritePermissionsConfig',
        ) as PageWritePermissionsConfigModel;
        await Config.updateConfig(config);
        clearCache();
        return res.json({ ok: true });
      } catch (err) {
        logger.error({ err }, 'Failed to update page write permissions config');
        return res.status(500).json({ message: 'Internal server error' });
      }
    },
  );

  return router;
};
