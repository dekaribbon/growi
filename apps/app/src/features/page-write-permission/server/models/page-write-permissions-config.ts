import type { Document, Model } from 'mongoose';
import { Schema } from 'mongoose';

import { getOrCreateModel } from '~/server/util/mongoose-utils';

interface PageWritePermissionRule {
  pattern: string;
  users?: string[];
  groups?: string[];
}

export interface PageWritePermissionsConfig {
  rules: PageWritePermissionRule[];
}

interface PageWritePermissionsConfigDocumentFields {
  key: string;
}

export interface PageWritePermissionsConfigDocument
  extends PageWritePermissionsConfig,
    PageWritePermissionsConfigDocumentFields,
    Document {}

export interface PageWritePermissionsConfigModel
  extends Model<PageWritePermissionsConfigDocument> {
  getConfig(): Promise<PageWritePermissionsConfig>;
  updateConfig(
    config: PageWritePermissionsConfig,
  ): Promise<PageWritePermissionsConfigDocument>;
}

const KEY = 'default';

const schema = new Schema<
  PageWritePermissionsConfigDocument,
  PageWritePermissionsConfigModel
>(
  {
    key: { type: String, required: true, unique: true, default: KEY },
    rules: [
      {
        pattern: { type: String, required: true },
        users: [{ type: String }],
        groups: [{ type: String }],
      },
    ],
  },
  { timestamps: true },
);

schema.statics.getConfig =
  async function (): Promise<PageWritePermissionsConfig> {
    const doc = await this.findOne({ key: KEY }).lean();
    return { rules: doc?.rules ?? [] };
  };

schema.statics.updateConfig = async function (
  config: PageWritePermissionsConfig,
): Promise<PageWritePermissionsConfigDocument> {
  const doc = await this.findOneAndUpdate(
    { key: KEY },
    { rules: config.rules },
    { upsert: true, new: true, lean: false },
  );
  return doc!;
};

export default getOrCreateModel<
  PageWritePermissionsConfigDocument,
  PageWritePermissionsConfigModel
>('PageWritePermissionsConfig', schema);
