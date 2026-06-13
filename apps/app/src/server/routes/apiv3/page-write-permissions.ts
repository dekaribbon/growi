import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import express from 'express';
import mongoose from 'mongoose';

import type {
  PageWritePermissionsConfig,
  PageWritePermissionsConfigModel,
} from '~/features/page-write-permission/server/models/page-write-permissions-config';
import { clearCache } from '~/features/page-write-permission/server/services';
import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import adminRequired from '~/server/middlewares/admin-required';
import loginRequiredFactory from '~/server/middlewares/login-required';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:routes:apiv3:page-write-permissions');

function validateRule(
  rule: unknown,
): rule is PageWritePermissionsConfig['rules'][number] {
  if (rule == null || typeof rule !== 'object') return false;
  const r = rule as Record<string, unknown>;
  return typeof r.pattern === 'string' && r.pattern.length > 0;
}

function sanitizeRules(rules: unknown[]): PageWritePermissionsConfig['rules'] {
  return rules.filter(validateRule).map((r) => {
    const rule = r as Record<string, unknown>;
    const users = Array.isArray(rule.users)
      ? rule.users.filter((u): u is string => typeof u === 'string')
      : [];
    const groups = Array.isArray(rule.groups)
      ? rule.groups.filter((g): g is string => typeof g === 'string')
      : [];
    return { pattern: rule.pattern as string, users, groups };
  });
}

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
        return (res as any).apiv3({ config });
      } catch (err) {
        logger.error({ err }, 'Failed to fetch page write permissions config');
        return (res as any).apiv3Err(
          new ErrorV3('Internal server error', 'internal_server_error'),
          500,
        );
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
        return (res as any).apiv3Err(
          new ErrorV3('Invalid config format', 'invalid_config'),
          400,
        );
      }

      const sanitizedRules = sanitizeRules(config.rules);

      try {
        const Config = mongoose.model(
          'PageWritePermissionsConfig',
        ) as PageWritePermissionsConfigModel;
        await Config.updateConfig({ rules: sanitizedRules });
        clearCache();
        return (res as any).apiv3({ ok: true });
      } catch (err) {
        logger.error({ err }, 'Failed to update page write permissions config');
        return (res as any).apiv3Err(
          new ErrorV3('Internal server error', 'internal_server_error'),
          500,
        );
      }
    },
  );

  return router;
};
