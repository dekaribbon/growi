import gc from 'expose-gc/function';
import { Transform, Writable } from 'stream';
import { pipeline } from 'stream/promises';

import { SearchDelegatorName } from '~/interfaces/named-query';
import type { ISearchResult, ISearchResultData } from '~/interfaces/search';
import { SocketEventName } from '~/interfaces/websocket';
import PageTagRelation from '~/server/models/page-tag-relation';
import loggerFactory from '~/utils/logger';

import type {
  FullTextSearchDelegator,
  MeiliQueryTerms,
  MeiliTermsKey,
  QueryTerms,
  SearchableData,
  SearchDelegator,
  UnavailableTermsKey,
  UpdateOrInsertPagesOpts,
} from '../../interfaces/search';
import { createBatchStream } from '../../util/batch-stream';
import { configManager } from '../config-manager';
import { aggregatePipelineToIndex } from './aggregate-to-index';

const logger = loggerFactory('growi:service:search-delegator:meilisearch');

const DEFAULT_OFFSET = 0;
const DEFAULT_LIMIT = 50;

const AVAILABLE_KEYS = [
  'match',
  'not_match',
  'phrase',
  'not_phrase',
  'prefix',
  'not_prefix',
  'tag',
  'not_tag',
];

// biome-ignore lint/suspicious/noExplicitAny: ignore
type Data = any;

class MeilisearchDelegator
  implements FullTextSearchDelegator<Data, MeiliTermsKey, MeiliQueryTerms>
{
  name!: SearchDelegatorName.DEFAULT;

  private socketIoService;

  // biome-ignore lint/suspicious/noExplicitAny: ignore
  private client: any;

  private indexName: string = 'growi';

  private pageModel;

  private userModel;

  constructor(socketIoService) {
    this.name = SearchDelegatorName.DEFAULT;
    this.socketIoService = socketIoService;
  }

  private getPageModel() {
    if (!this.pageModel) {
      const mongoose = require('mongoose');
      this.pageModel = mongoose.model('Page');
    }
    return this.pageModel;
  }

  private getUserModel() {
    if (!this.userModel) {
      const mongoose = require('mongoose');
      this.userModel = mongoose.model('User');
    }
    return this.userModel;
  }

  getConnectionInfo() {
    const uri =
      configManager.getConfig('app:meilisearchUri') ?? 'http://localhost:7700';
    const apiKey = configManager.getConfig('app:meilisearchApiKey') ?? '';
    return { uri, apiKey };
  }

  async initClient() {
    const { uri, apiKey } = this.getConnectionInfo();
    const { Meilisearch } = await import('meilisearch');
    this.client = new Meilisearch({ host: uri, apiKey });
  }

  async init() {
    await this.initClient();
    await this.normalizeIndices();
  }

  async getInfo() {
    const index = this.client.index(this.indexName);
    const stats = await index.getStats();
    const version = await this.client.version();
    return { meiliVersion: version, stats };
  }

  async getInfoForHealth() {
    const health = await this.client.health();
    return { meiliHealth: health };
  }

  async getInfoForAdmin() {
    const index = this.client.index(this.indexName);
    try {
      const stats = await index.getStats();
      return {
        documentCount: stats.numberOfDocuments,
        isNormalized: true,
        indexSettings: await index.getSettings(),
      };
    } catch {
      return {
        documentCount: 0,
        isNormalized: false,
        indexSettings: null,
      };
    }
  }
  async normalizeIndices() {
    try {
      await this.client.getIndex(this.indexName);
    } catch {
      await this.client.createIndex(this.indexName, { primaryKey: 'id' });
      logger.info(`Created index: ${this.indexName}`);
    }

    // Configure filterable and sortable attributes
    const index = this.client.index(this.indexName);
    try {
      await index.updateFilterableAttributes([
        'grant',
        'granted_users',
        'granted_groups',
        'path',
        'tag_names',
      ]);
      await index.updateSortableAttributes(['created_at', 'updated_at']);
    } catch (err) {
      logger.error('Failed to update index settings', err);
    }
  }

  async rebuildIndex(
    option: UpdateOrInsertPagesOpts = { shouldEmitProgress: false },
  ) {
    await this.addAllPages(option);
  }

  async addAllPages(
    option: UpdateOrInsertPagesOpts = { shouldEmitProgress: false },
  ) {
    const Page = this.getPageModel();
    return this.updateOrInsertPages(() => Page.find(), option);
  }

  async updateOrInsertPageById(pageId) {
    const Page = this.getPageModel();
    return this.updateOrInsertPages(() => Page.findById(pageId));
  }

  async updateOrInsertPages(
    queryFactory,
    option: UpdateOrInsertPagesOpts = {
      shouldEmitProgress: false,
      invokeGarbageCollection: false,
    },
  ): Promise<void> {
    const { shouldEmitProgress, invokeGarbageCollection } = option;

    const Page = this.getPageModel();
    const { PageQueryBuilder } = Page;

    const socket = shouldEmitProgress
      ? this.socketIoService.getAdminSocket()
      : null;

    const matchQuery = new PageQueryBuilder(queryFactory()).query;

    const countQuery = new PageQueryBuilder(queryFactory()).query;
    const totalCount = await countQuery.count();

    const maxBodyLengthToIndex = configManager.getConfig(
      'app:elasticsearchMaxBodyLengthToIndex',
    );

    const bulkSize: number =
      configManager.getConfig('app:meilisearchReindexBulkSize') ?? 100;

    const readStream = Page.aggregate(
      aggregatePipelineToIndex(maxBodyLengthToIndex, matchQuery),
    ).cursor();

    const batchStream = createBatchStream(bulkSize);

    const appendTagNamesStream = new Transform({
      objectMode: true,
      async transform(chunk, encoding, callback) {
        const pageIds = chunk.map((doc) => doc._id);

        const idToTagNamesMap =
          await PageTagRelation.getIdToTagNamesMap(pageIds);
        const idsHavingTagNames = Object.keys(idToTagNamesMap);

        chunk
          .filter((doc) => idsHavingTagNames.includes(doc._id.toString()))
          .forEach((doc) => {
            doc.tagNames = idToTagNamesMap[doc._id.toString()];
          });

        this.push(chunk);
        callback();
      },
    });

    const prepareDocument = this.prepareDocument.bind(this);
    const index = this.client.index(this.indexName);
    let count = 0;
    const writeStream = new Writable({
      objectMode: true,
      async write(batch, encoding, callback) {
        const documents = batch.map((doc) => prepareDocument(doc));

        try {
          await index.addDocuments(documents);
          count += documents.length;

          logger.info(
            `Adding pages progressing: (count=${count}/${totalCount})`,
          );

          if (shouldEmitProgress) {
            socket?.emit(SocketEventName.AddPageProgress, {
              totalCount,
              count,
            });
          }
        } catch (err) {
          logger.error('addAllPages error on add anyway: ', err);
        }

        if (invokeGarbageCollection) {
          try {
            gc();
          } catch (err) {
            logger.error('fail garbage collection: ', err);
          }
        }

        callback();
      },
      final(callback) {
        logger.info(`Adding pages has completed: (totalCount=${totalCount})`);

        if (shouldEmitProgress) {
          socket?.emit(SocketEventName.FinishAddPage, { totalCount, count });
        }

        callback();
      },
    });

    return pipeline(readStream, batchStream, appendTagNamesStream, writeStream);
  }

  prepareDocument(page) {
    return {
      id: page._id.toString(),
      path: page.path,
      body: page.revision?.body ?? '',
      username: page.creator?.username ?? '',
      comments: (page.comments ?? []).map((c) =>
        typeof c === 'string' ? c : (c.comment ?? ''),
      ),
      comment_count: page.commentsCount ?? 0,
      bookmark_count: page.bookmarksCount ?? 0,
      like_count: page.likeCount ?? 0,
      seenUsers_count: page.seenUsersCount ?? 0,
      created_at:
        page.createdAt instanceof Date ? page.createdAt.getTime() : Date.now(),
      updated_at:
        page.updatedAt instanceof Date ? page.updatedAt.getTime() : Date.now(),
      tag_names: page.tagNames ?? [],
      grant: page.grant ?? 1,
      granted_users: (page.grantedUsers ?? []).map((id) => id.toString()),
      granted_groups: (page.grantedGroups ?? []).map(
        (g) => g.item?.toString() ?? g.toString(),
      ),
    };
  }

  async deletePages(pages) {
    const index = this.client.index(this.indexName);
    const ids = pages.map((page) => page._id.toString());
    await index.deleteDocuments(ids);
    logger.debug(`Deleted ${ids.length} pages from index`);
  }

  // --- Sync methods ---

  async syncPageUpdated(page, user) {
    logger.debug('MeilisearchDelegator.syncPageUpdated', page.path);
    return this.updateOrInsertPageById(page._id);
  }

  syncPagesUpdated(pages, user) {
    // pages that should be deleted are handled separately
    return Promise.resolve();
  }

  async syncDescendantsPagesUpdated(parentPage, user) {
    const Page = this.getPageModel();
    const { PageQueryBuilder } = Page;
    const builder = new PageQueryBuilder(Page.find());
    builder.addConditionToListWithDescendants(parentPage.path);
    return this.updateOrInsertPages(() => builder.query);
  }

  async syncDescendantsPagesDeleted(pages, user) {
    return this.deletePages(pages);
  }

  async syncPageDeleted(page, user) {
    logger.debug('MeilisearchDelegator.syncPageDeleted', page.path);
    return this.deletePages([page]);
  }

  async syncBookmarkChanged(pageId) {
    logger.debug('MeilisearchDelegator.syncBookmarkChanged', pageId);
    return this.updateOrInsertPageById(pageId);
  }

  async syncCommentChanged(comment) {
    logger.debug('MeilisearchDelegator.syncCommentChanged', comment);
    return this.updateOrInsertPageById(comment.page);
  }

  async syncTagChanged(page) {
    logger.debug('MeilisearchDelegator.syncTagChanged', page.path);
    return this.updateOrInsertPageById(page._id);
  }

  // --- Search ---

  async search(
    data: SearchableData<MeiliQueryTerms>,
    user,
    userGroups,
    option?,
  ): Promise<ISearchResult<ISearchResultData>> {
    const { queryString, terms } = data;

    if (terms == null) {
      throw Error('Cannot process search since terms is undefined.');
    }

    const from = option?.offset ?? DEFAULT_OFFSET;
    const size = option?.limit ?? DEFAULT_LIMIT;
    const sort = option?.sort ?? null;
    const order = option?.order ?? null;

    const searchParams = this.buildSearchParams(terms, user, userGroups, {
      offset: from,
      limit: size,
      sort,
      order,
    });

    // Strip prefix:, tag:, and - prefix/tag markers from queryString
    // since they are handled via filters, not full-text search
    let cleanQuery = queryString
      .replace(/(^|\s+)-?(prefix:|tag:)\S+/g, '')
      .trim();

    // Append not_match and not_phrase words as negated terms in query string
    // Meilisearch uses - prefix for word exclusion in full-text search
    const negatedTerms: string[] = [];
    if (terms.not_match?.length > 0) {
      negatedTerms.push(...terms.not_match.map((w) => `-${w}`));
    }
    if (terms.not_phrase?.length > 0) {
      for (const phrase of terms.not_phrase) {
        const words = phrase.replace(/^"|"$/g, '').split(/\s+/);
        negatedTerms.push(...words.map((w) => `-${w}`));
      }
    }
    if (negatedTerms.length > 0) {
      cleanQuery = `${cleanQuery} ${negatedTerms.join(' ')}`.trim();
    }

    const index = this.client.index(this.indexName);
    const result = await index.search(cleanQuery, searchParams);

    return this.formatResult(result);
  }

  buildSearchParams(terms, user, userGroups, option) {
    const { offset, limit, sort, order } = option;
    const params: Record<string, any> = {};

    if (offset != null) params.offset = offset;
    if (limit != null) params.limit = limit;

    // Sort
    if (sort != null) {
      const sortField =
        sort === 'createdAt'
          ? 'created_at'
          : sort === 'updatedAt'
            ? 'updated_at'
            : null;
      if (sortField != null) {
        params.sort = [`${sortField}:${order === 'asc' ? 'asc' : 'desc'}`];
      }
    }

    // Filter (access control)
    const filter = this.buildFilter(user, userGroups);
    const filters = [filter];

    // not_match is handled via query string negation (-word) in search()

    // prefix filtering
    if (terms.prefix?.length > 0) {
      const prefixFilters = terms.prefix.map((p) => `path STARTS WITH "${p}"`);
      filters.push(`(${prefixFilters.join(' OR ')})`);
    }

    // not_prefix filtering
    if (terms.not_prefix?.length > 0) {
      const notPrefixFilters = terms.not_prefix.map(
        (p) => `path NOT STARTS WITH "${p}"`,
      );
      filters.push(notPrefixFilters.join(' AND '));
    }

    // tag filtering
    if (terms.tag?.length > 0) {
      const tagFilters = terms.tag.map((t) => `tag_names = "${t}"`);
      filters.push(tagFilters.join(' AND '));
    }

    // not_tag filtering
    if (terms.not_tag?.length > 0) {
      const notTagFilters = terms.not_tag.map((t) => `tag_names != "${t}"`);
      filters.push(notTagFilters.join(' AND '));
    }

    params.filter = filters;

    // Highlight
    params.attributesToHighlight = ['*'];
    params.highlightPreTag = "<em class='highlighted-keyword'>";
    params.highlightPostTag = '</em>';

    return params;
  }

  buildFilter(user, userGroups) {
    const parts = ['grant = 1'];

    if (user != null) {
      const userId = user._id.toString();
      parts.push(`granted_users IN [${userId}]`);
    }

    if (userGroups != null && userGroups.length > 0) {
      const groupIds = userGroups.map((g) => g._id.toString()).join(',');
      parts.push(`granted_groups IN [${groupIds}]`);
    }

    return parts.join(' OR ');
  }

  formatResult(result) {
    const hits = result.hits ?? [];
    const total = result.estimatedTotalHits ?? 0;

    return {
      meta: {
        total,
        took: result.processingTimeMs,
        hitsCount: hits.length,
      },
      data: hits.map((hit) => {
        const formatted = hit._formatted ?? {};
        const source = { ...hit };
        delete source._formatted;
        delete source._matchesPosition;

        return {
          _id: hit.id,
          _score: 1,
          _source: source,
          _highlight: {
            body: formatted.body ? [formatted.body] : undefined,
            'path.en': formatted.path ? [formatted.path] : undefined,
            'path.ja': formatted.path ? [formatted.path] : undefined,
            comments: formatted.comments ? [formatted.comments] : undefined,
            'comments.en': formatted.comments
              ? [formatted.comments]
              : undefined,
            'comments.ja': formatted.comments
              ? [formatted.comments]
              : undefined,
          },
        };
      }),
    };
  }

  isTermsNormalized(terms: Partial<QueryTerms>): terms is MeiliQueryTerms {
    const entries = Object.entries(terms);
    return !entries.some(
      ([key, val]) =>
        !AVAILABLE_KEYS.includes(key) &&
        typeof val?.length === 'number' &&
        val.length > 0,
    );
  }

  validateTerms(terms: QueryTerms): UnavailableTermsKey<MeiliTermsKey>[] {
    const entries = Object.entries(terms);
    return entries
      .filter(([key, val]) => !AVAILABLE_KEYS.includes(key) && val.length > 0)
      .map(([key]) => key as UnavailableTermsKey<MeiliTermsKey>);
  }
}

export default MeilisearchDelegator;
