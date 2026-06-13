import type { IUserHasId } from '@growi/core/dist/interfaces';
import mongoose from 'mongoose';

import loggerFactory from '~/utils/logger';

import type { PageWritePermissionsConfigModel } from '../models/page-write-permissions-config';

const logger = loggerFactory('growi:features:page-write-permission');

interface PermissionRule {
  pattern: string;
  users?: string[];
  groups?: string[];
}

let cachedRules: PermissionRule[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 30_000;

function matchPattern(pattern: string, pagePath: string): boolean {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${regexStr}$`).test(pagePath);
}

async function fetchRules(): Promise<PermissionRule[]> {
  const now = Date.now();
  if (cachedRules !== null && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedRules;
  }

  try {
    const Config = mongoose.model(
      'PageWritePermissionsConfig',
    ) as PageWritePermissionsConfigModel;
    const config = await Config.getConfig();
    cachedRules = config.rules.filter(
      (r: PermissionRule) =>
        typeof r.pattern === 'string' && r.pattern.length > 0,
    );
    cacheTimestamp = now;
    return cachedRules;
  }
  catch (err) {
    logger.warn({ err }, 'Failed to fetch page write permission config');
    cachedRules = [];
    cacheTimestamp = now;
    return [];
  }
}

function findMatchingRule(
  rules: PermissionRule[],
  pagePath: string,
): PermissionRule | null {
  for (const rule of rules) {
    if (matchPattern(rule.pattern, pagePath)) {
      return rule;
    }
  }
  return null;
}

async function getUserGroupNames(user: IUserHasId): Promise<string[]> {
  try {
    const UserGroupRelation = mongoose.model('UserGroupRelation');
    const UserGroup = mongoose.model('UserGroup');
    const groupIds = await (
      UserGroupRelation as any
    ).findAllUserGroupIdsRelatedToUser(user);

    if (!groupIds || groupIds.length === 0) return [];

    const groups = await UserGroup.find({ _id: { $in: groupIds } }).lean();
    return groups.map((g: any) => g.name).filter(Boolean);
  }
  catch {
    return [];
  }
}

export async function isUserAllowedToWrite(
  pagePath: string,
  user: IUserHasId,
): Promise<boolean> {
  const rules = await fetchRules();
  if (rules.length === 0) return true;

  const rule = findMatchingRule(rules, pagePath);
  if (!rule) return true;

  if (!rule.users?.length && !rule.groups?.length) return true;

  if (rule.users?.includes(user.username)) return true;

  if (rule.groups?.length) {
    const userGroupNames = await getUserGroupNames(user);
    for (const g of rule.groups) {
      if (userGroupNames.includes(g)) return true;
    }
  }

  return false;
}

export function clearCache(): void {
  cachedRules = null;
  cacheTimestamp = 0;
}
