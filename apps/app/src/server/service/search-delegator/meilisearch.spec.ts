import { Readable } from 'stream';
import { describe, expect, it, vi } from 'vitest';

import { SearchDelegatorName } from '~/interfaces/named-query';
import { SocketEventName } from '~/interfaces/websocket';
import { configManager } from '~/server/service/config-manager/config-manager';

import MeilisearchDelegator from './meilisearch';

// Mock config manager
vi.mock('~/server/service/config-manager/config-manager', () => {
  const mockConfig = {
    getConfig: vi.fn((key: string) => {
      if (key === 'app:meilisearchUri') return undefined;
      if (key === 'app:meilisearchApiKey') return undefined;
      if (key === 'app:meilisearchReindexBulkSize') return 100;
      if (key === 'app:elasticsearchMaxBodyLengthToIndex') return 100000;
      return undefined;
    }),
    loadConfigs: vi.fn(),
  };
  return {
    default: mockConfig,
    configManager: mockConfig,
  };
});

// Mock the meilisearch module
vi.mock('meilisearch', () => {
  const mockIndex = {
    search: vi.fn(),
    addDocuments: vi.fn(),
    deleteDocument: vi.fn(),
    deleteDocuments: vi.fn(),
    getRawInfo: vi.fn(),
    getStats: vi.fn(),
    updateSettings: vi.fn(),
    getSettings: vi.fn(),
  };

  const mockClient = {
    index: vi.fn().mockReturnValue(mockIndex),
    getKeys: vi.fn(),
    health: vi.fn(),
    version: vi.fn(),
    createIndex: vi.fn(),
    getIndex: vi.fn(),
  };

  return {
    Meilisearch: vi.fn().mockImplementation(() => mockClient),
  };
});

// Mock the aggregate pipeline
vi.mock('./aggregate-to-index', () => ({
  aggregatePipelineToIndex: vi.fn().mockReturnValue([]),
}));

// Mock PageTagRelation
vi.mock('~/server/models/page-tag-relation', () => ({
  default: {
    getIdToTagNamesMap: vi.fn().mockResolvedValue({}),
  },
}));

const mockSocketIoService = {
  getAdminSocket: vi.fn(),
} as any;

describe('MeilisearchDelegator', () => {
  let delegator: MeilisearchDelegator;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset config mock to default implementation to prevent test pollution
    configManager.getConfig.mockImplementation((key: string) => {
      if (key === 'app:meilisearchUri') return undefined;
      if (key === 'app:meilisearchApiKey') return undefined;
      if (key === 'app:meilisearchReindexBulkSize') return 100;
      if (key === 'app:elasticsearchMaxBodyLengthToIndex') return 100000;
      return undefined;
    });
    delegator = new MeilisearchDelegator(mockSocketIoService);
    // Initialize the client with properly set up mock return values
    const { Meilisearch } = require('meilisearch');
    const rawClient = new Meilisearch({
      host: 'http://localhost:7700',
      apiKey: '',
    });
    // Re-setup mock return values that were cleared by clearAllMocks
    const mockIndex = {
      search: vi.fn(),
      addDocuments: vi.fn(),
      deleteDocument: vi.fn(),
      deleteDocuments: vi.fn(),
      getRawInfo: vi.fn(),
      getStats: vi.fn(),
      updateSettings: vi.fn(),
      getSettings: vi.fn(),
    };
    rawClient.index = vi.fn().mockReturnValue(mockIndex);
    (delegator as any).client = rawClient;
  });

  describe('config manager', () => {
    it('should return default bulk size for meilisearch reindex', () => {
      const bulkSize = configManager.getConfig(
        'app:meilisearchReindexBulkSize',
      );
      expect(bulkSize).toBe(100);
    });
  });

  describe('constructor', () => {
    it('should set name to DEFAULT', () => {
      expect(delegator.name).toBe(SearchDelegatorName.DEFAULT);
    });

    it('should set indexName to growi', () => {
      expect((delegator as any).indexName).toBe('growi');
    });
  });

  describe('init', () => {
    it('should call initClient and normalizeIndices', async () => {
      const mockClient = (delegator as any).client;
      mockClient.getIndex = vi.fn().mockResolvedValue({});
      mockClient.index('growi').updateFilterableAttributes = vi.fn();
      mockClient.index('growi').updateSortableAttributes = vi.fn();

      const initClientSpy = vi.spyOn(delegator, 'initClient');
      const normalizeSpy = vi.spyOn(delegator, 'normalizeIndices');

      await delegator.init();

      expect(initClientSpy).toHaveBeenCalled();
      expect(normalizeSpy).toHaveBeenCalled();
    });
  });

  describe('isTermsNormalized', () => {
    it('should return true when all terms are available keys', () => {
      const result = delegator.isTermsNormalized({
        match: ['hello'],
        not_match: [],
        phrase: [],
        not_phrase: [],
        prefix: [],
        not_prefix: [],
        tag: [],
        not_tag: [],
      });
      expect(result).toBe(true);
    });

    it('should return false when terms include unavailable keys', () => {
      const result = delegator.isTermsNormalized({
        match: ['hello'],
        unknown_key: ['value'],
      } as any);
      expect(result).toBe(false);
    });
  });

  describe('validateTerms', () => {
    it('should return empty array when all terms are valid', () => {
      const result = delegator.validateTerms({
        match: ['hello'],
        not_match: ['world'],
        phrase: [],
        not_phrase: [],
        prefix: [],
        not_prefix: [],
        tag: ['tag1'],
        not_tag: [],
      });
      expect(result).toEqual([]);
    });

    it('should return unavailable keys for unknown terms', () => {
      const result = delegator.validateTerms({
        match: ['hello'],
        not_match: [],
        phrase: [],
        not_phrase: [],
        prefix: [],
        not_prefix: [],
        tag: [],
        not_tag: [],
        unknown: ['value'],
      } as any);
      expect(result).toContain('unknown');
    });
  });

  describe('search - query string cleansing', () => {
    it('should strip prefix: markers from query string', async () => {
      const mockClient = (delegator as any).client;
      mockClient
        .index('growi')
        .search.mockResolvedValue({ hits: [], estimatedTotalHits: 0 });

      await delegator.search(
        {
          queryString: 'test prefix:/Sandbox',
          terms: {
            match: ['test'],
            prefix: ['/Sandbox'],
            not_match: [],
            phrase: [],
            not_phrase: [],
            not_prefix: [],
            tag: [],
            not_tag: [],
          },
        },
        null,
        null,
        {},
      );

      const searchCall = mockClient.index('growi').search.mock.calls[0];
      expect(searchCall[0]).toBe('test');
    });

    it('should strip -prefix: markers from query string', async () => {
      const mockClient = (delegator as any).client;
      mockClient
        .index('growi')
        .search.mockResolvedValue({ hits: [], estimatedTotalHits: 0 });

      await delegator.search(
        {
          queryString: 'test -prefix:/trash',
          terms: {
            match: ['test'],
            not_prefix: ['/trash'],
            not_match: [],
            phrase: [],
            not_phrase: [],
            prefix: [],
            tag: [],
            not_tag: [],
          },
        },
        null,
        null,
        {},
      );

      const searchCall = mockClient.index('growi').search.mock.calls[0];
      expect(searchCall[0]).toBe('test');
    });

    it('should strip tag: markers from query string', async () => {
      const mockClient = (delegator as any).client;
      mockClient
        .index('growi')
        .search.mockResolvedValue({ hits: [], estimatedTotalHits: 0 });

      await delegator.search(
        {
          queryString: 'test tag:important',
          terms: {
            match: ['test'],
            tag: ['important'],
            not_match: [],
            phrase: [],
            not_phrase: [],
            prefix: [],
            not_prefix: [],
            not_tag: [],
          },
        },
        null,
        null,
        {},
      );

      const searchCall = mockClient.index('growi').search.mock.calls[0];
      expect(searchCall[0]).toBe('test');
    });

    it('should strip -tag: markers from query string', async () => {
      const mockClient = (delegator as any).client;
      mockClient
        .index('growi')
        .search.mockResolvedValue({ hits: [], estimatedTotalHits: 0 });

      await delegator.search(
        {
          queryString: 'test -tag:old',
          terms: {
            match: ['test'],
            not_tag: ['old'],
            not_match: [],
            phrase: [],
            not_phrase: [],
            prefix: [],
            not_prefix: [],
            tag: [],
          },
        },
        null,
        null,
        {},
      );

      const searchCall = mockClient.index('growi').search.mock.calls[0];
      expect(searchCall[0]).toBe('test');
    });

    it('should append not_phrase words as -prefix negations in query string', async () => {
      const mockClient = (delegator as any).client;
      mockClient
        .index('growi')
        .search.mockResolvedValue({ hits: [], estimatedTotalHits: 0 });

      await delegator.search(
        {
          queryString: 'test',
          terms: {
            match: ['test'],
            not_phrase: ['"exact phrase"'],
            not_match: [],
            phrase: [],
            prefix: [],
            not_prefix: [],
            tag: [],
            not_tag: [],
          },
        },
        null,
        null,
        {},
      );

      const searchCall = mockClient.index('growi').search.mock.calls[0];
      expect(searchCall[0]).toBe('test -exact -phrase');
    });

    it('should handle not_phrase alongside not_match', async () => {
      const mockClient = (delegator as any).client;
      mockClient
        .index('growi')
        .search.mockResolvedValue({ hits: [], estimatedTotalHits: 0 });

      await delegator.search(
        {
          queryString: 'hello',
          terms: {
            match: ['hello'],
            not_phrase: ['"bad stuff"'],
            not_match: ['world'],
            phrase: [],
            prefix: [],
            not_prefix: [],
            tag: [],
            not_tag: [],
          },
        },
        null,
        null,
        {},
      );

      const searchCall = mockClient.index('growi').search.mock.calls[0];
      expect(searchCall[0]).toBe('hello -world -bad -stuff');
    });
  });

  describe('search - not_match as query negation', () => {
    it('should append not_match words as -prefix in query string', async () => {
      const mockClient = (delegator as any).client;
      mockClient
        .index('growi')
        .search.mockResolvedValue({ hits: [], estimatedTotalHits: 0 });

      await delegator.search(
        {
          queryString: 'hello world',
          terms: {
            match: ['hello'],
            not_match: ['world'],
            phrase: [],
            not_phrase: [],
            prefix: [],
            not_prefix: [],
            tag: [],
            not_tag: [],
          },
        },
        null,
        null,
        {},
      );

      const searchCall = mockClient.index('growi').search.mock.calls[0];
      expect(searchCall[0]).toContain('-world');
    });

    it('should not use NOT IN filter for not_match', async () => {
      const mockClient = (delegator as any).client;
      mockClient
        .index('growi')
        .search.mockResolvedValue({ hits: [], estimatedTotalHits: 0 });

      await delegator.search(
        {
          queryString: 'hello',
          terms: {
            match: ['hello'],
            not_match: ['world'],
            phrase: [],
            not_phrase: [],
            prefix: [],
            not_prefix: [],
            tag: [],
            not_tag: [],
          },
        },
        null,
        null,
        {},
      );

      const searchCall = mockClient.index('growi').search.mock.calls[0];
      const filter = searchCall[1]?.filter;
      if (filter != null) {
        expect(filter.join(' ')).not.toContain('NOT IN');
      }
    });
  });

  describe('search - filter construction', () => {
    it('should build prefix filter with STARTS WITH syntax', async () => {
      const mockClient = (delegator as any).client;
      mockClient
        .index('growi')
        .search.mockResolvedValue({ hits: [], estimatedTotalHits: 0 });

      await delegator.search(
        {
          queryString: 'prefix:/Sandbox',
          terms: {
            match: [],
            prefix: ['/Sandbox'],
            not_match: [],
            phrase: [],
            not_phrase: [],
            not_prefix: [],
            tag: [],
            not_tag: [],
          },
        },
        null,
        null,
        {},
      );

      const searchCall = mockClient.index('growi').search.mock.calls[0];
      const filter = (searchCall[1]?.filter ?? []).join(' ');
      expect(filter).toContain('STARTS WITH');
      expect(filter).not.toContain('path ^');
    });

    it('should build prefix filter with quoted path', async () => {
      const mockClient = (delegator as any).client;
      mockClient
        .index('growi')
        .search.mockResolvedValue({ hits: [], estimatedTotalHits: 0 });

      await delegator.search(
        {
          queryString: 'prefix:/Sandbox',
          terms: {
            match: [],
            prefix: ['/Sandbox'],
            not_match: [],
            phrase: [],
            not_phrase: [],
            not_prefix: [],
            tag: [],
            not_tag: [],
          },
        },
        null,
        null,
        {},
      );

      const searchCall = mockClient.index('growi').search.mock.calls[0];
      const filter = (searchCall[1]?.filter ?? []).join(' ');
      expect(filter).toContain('"/Sandbox"');
    });

    it('should build not_prefix filter with NOT STARTS WITH syntax', async () => {
      const mockClient = (delegator as any).client;
      mockClient
        .index('growi')
        .search.mockResolvedValue({ hits: [], estimatedTotalHits: 0 });

      await delegator.search(
        {
          queryString: 'admin -prefix:/trash -prefix:/user',
          terms: {
            match: ['admin'],
            not_prefix: ['/trash', '/user'],
            not_match: [],
            phrase: [],
            not_phrase: [],
            prefix: [],
            tag: [],
            not_tag: [],
          },
        },
        null,
        null,
        {},
      );

      const searchCall = mockClient.index('growi').search.mock.calls[0];
      const filter = (searchCall[1]?.filter ?? []).join(' ');
      expect(filter).toContain('NOT STARTS WITH');
      expect(filter).not.toContain('NOT ^');
    });

    it('should build tag filter with quoted value', async () => {
      const mockClient = (delegator as any).client;
      mockClient
        .index('growi')
        .search.mockResolvedValue({ hits: [], estimatedTotalHits: 0 });

      await delegator.search(
        {
          queryString: 'tag:important',
          terms: {
            match: [],
            tag: ['important'],
            not_match: [],
            phrase: [],
            not_phrase: [],
            prefix: [],
            not_prefix: [],
            not_tag: [],
          },
        },
        null,
        null,
        {},
      );

      const searchCall = mockClient.index('growi').search.mock.calls[0];
      const filter = (searchCall[1]?.filter ?? []).join(' ');
      expect(filter).toContain('tag_names = "important"');
    });

    it('should build not_tag filter with != syntax', async () => {
      const mockClient = (delegator as any).client;
      mockClient
        .index('growi')
        .search.mockResolvedValue({ hits: [], estimatedTotalHits: 0 });

      await delegator.search(
        {
          queryString: '-tag:old',
          terms: {
            match: [],
            not_tag: ['old'],
            not_match: [],
            phrase: [],
            not_phrase: [],
            prefix: [],
            not_prefix: [],
            tag: [],
          },
        },
        null,
        null,
        {},
      );

      const searchCall = mockClient.index('growi').search.mock.calls[0];
      const filter = (searchCall[1]?.filter ?? []).join(' ');
      expect(filter).toContain('tag_names != "old"');
    });
  });

  describe('formatResult', () => {
    it('should map _formatted.body to _highlight.body', () => {
      const meiliResult = {
        hits: [
          {
            id: 'page1',
            path: '/test',
            body: 'content',
            _formatted: { body: '<em>content</em>', path: '/<em>test</em>' },
          },
        ],
        estimatedTotalHits: 1,
        processingTimeMs: 5,
      };
      const result = (delegator as any).formatResult(meiliResult);
      expect(result.data[0]._highlight.body).toEqual(['<em>content</em>']);
    });

    it('should map _formatted.path to _highlight.path.*', () => {
      const meiliResult = {
        hits: [
          {
            id: 'page1',
            path: '/test',
            body: 'content',
            _formatted: { path: '/<em>test</em>' },
          },
        ],
        estimatedTotalHits: 1,
        processingTimeMs: 5,
      };
      const result = (delegator as any).formatResult(meiliResult);
      expect(result.data[0]._highlight['path.en']).toEqual(['/<em>test</em>']);
    });

    it('should preserve original source fields', () => {
      const meiliResult = {
        hits: [
          {
            id: 'page1',
            path: '/test',
            body: 'content',
            bookmark_count: 5,
            tag_names: ['tag1'],
          },
        ],
        estimatedTotalHits: 1,
        processingTimeMs: 5,
      };
      const result = (delegator as any).formatResult(meiliResult);
      expect(result.data[0]._source.path).toBe('/test');
      expect(result.data[0]._source.bookmark_count).toBe(5);
      expect(result.data[0]._source.tag_names).toEqual(['tag1']);
    });

    it('should strip _formatted and _matchesPosition from source', () => {
      const meiliResult = {
        hits: [
          {
            id: 'page1',
            path: '/test',
            _formatted: { body: '<em>test</em>' },
            _matchesPosition: {},
          },
        ],
        estimatedTotalHits: 1,
        processingTimeMs: 5,
      };
      const result = (delegator as any).formatResult(meiliResult);
      expect(result.data[0]._source._formatted).toBeUndefined();
      expect(result.data[0]._source._matchesPosition).toBeUndefined();
    });

    it('should return meta with total and took', () => {
      const meiliResult = {
        hits: [],
        estimatedTotalHits: 10,
        processingTimeMs: 3,
      };
      const result = (delegator as any).formatResult(meiliResult);
      expect(result.meta.total).toBe(10);
      expect(result.meta.took).toBe(3);
      expect(result.meta.hitsCount).toBe(0);
    });

    it('should handle empty results', () => {
      const meiliResult = {
        hits: [],
        estimatedTotalHits: 0,
        processingTimeMs: 1,
      };
      const result = (delegator as any).formatResult(meiliResult);
      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
    });
  });

  describe('buildFilter - access control', () => {
    it('should build public-only filter when user is null', () => {
      const filter = (delegator as any).buildFilter(null, null);
      expect(filter).toBe('grant = 1');
    });

    it('should include owner/specified grants for authenticated user', () => {
      const filter = (delegator as any).buildFilter({ _id: 'user123' }, null);
      expect(filter).toContain('grant = 1');
      expect(filter).toContain('granted_users IN [user123]');
    });

    it('should include user group grants when userGroups provided', () => {
      const userGroups = [{ _id: 'group1' }, { _id: 'group2' }];
      const filter = (delegator as any).buildFilter(
        { _id: 'user123' },
        userGroups,
      );
      expect(filter).toContain('granted_groups IN [group1,group2]');
    });
  });

  describe('getConnectionInfo', () => {
    it('should return default values when no env is set', () => {
      const info = (delegator as any).getConnectionInfo();
      expect(info.uri).toBe('http://localhost:7700');
      expect(info.apiKey).toBe('');
    });
  });

  describe('normalizeIndices', () => {
    it('should configure filterable attributes', async () => {
      const mockClient = (delegator as any).client;
      mockClient.getIndex = vi.fn().mockResolvedValue({});
      mockClient.index('growi').updateFilterableAttributes = vi.fn();
      mockClient.index('growi').updateSortableAttributes = vi.fn();

      await delegator.normalizeIndices();

      expect(
        mockClient.index('growi').updateFilterableAttributes,
      ).toHaveBeenCalledWith([
        'grant',
        'granted_users',
        'granted_groups',
        'path',
        'tag_names',
      ]);
    });

    it('should configure sortable attributes', async () => {
      const mockClient = (delegator as any).client;
      mockClient.getIndex = vi.fn().mockResolvedValue({});
      mockClient.index('growi').updateFilterableAttributes = vi.fn();
      mockClient.index('growi').updateSortableAttributes = vi.fn();

      await delegator.normalizeIndices();

      expect(
        mockClient.index('growi').updateSortableAttributes,
      ).toHaveBeenCalledWith(['created_at', 'updated_at']);
    });
  });

  describe('getInfoForAdmin', () => {
    it('should return documentCount for Meilisearch', async () => {
      const mockClient = (delegator as any).client;
      mockClient.index('growi').getStats = vi
        .fn()
        .mockResolvedValue({ numberOfDocuments: 7 });
      mockClient.index('growi').getSettings = vi.fn().mockResolvedValue({});

      const info = await delegator.getInfoForAdmin();
      expect(info.documentCount).toBe(7);
    });
  });

  describe('prepareDocument', () => {
    it('should include tag_names from enriched page data', () => {
      const page = {
        _id: { toString: () => 'page1' },
        path: '/test',
        revision: { body: 'hello' },
        creator: null,
        comments: [],
        commentsCount: 0,
        bookmarksCount: 0,
        likeCount: 0,
        seenUsersCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        tagNames: ['tag1', 'tag2'],
        grant: 1,
        grantedUsers: [],
        grantedGroups: [],
      };
      const doc = (delegator as any).prepareDocument(page);
      expect(doc.tag_names).toEqual(['tag1', 'tag2']);
    });

    it('should handle empty tag_names', () => {
      const page = {
        _id: { toString: () => 'page1' },
        path: '/test',
        revision: { body: 'hello' },
        creator: null,
        comments: [],
        commentsCount: 0,
        bookmarksCount: 0,
        likeCount: 0,
        seenUsersCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        grant: 1,
        grantedUsers: [],
        grantedGroups: [],
      };
      const doc = (delegator as any).prepareDocument(page);
      expect(doc.tag_names).toEqual([]);
    });

    it('should convert granted user ids to strings', () => {
      const page = {
        _id: { toString: () => 'page1' },
        path: '/test',
        revision: { body: 'hello' },
        creator: null,
        comments: [],
        commentsCount: 0,
        bookmarksCount: 0,
        likeCount: 0,
        seenUsersCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        grant: 4,
        grantedUsers: [
          { toString: () => 'user1' },
          { toString: () => 'user2' },
        ],
        grantedGroups: [],
      };
      const doc = (delegator as any).prepareDocument(page);
      expect(doc.granted_users).toEqual(['user1', 'user2']);
    });

    it('should convert timestamps to numbers', () => {
      const date = new Date('2024-01-01');
      const page = {
        _id: { toString: () => 'page1' },
        path: '/test',
        revision: { body: 'hello' },
        creator: null,
        comments: [],
        commentsCount: 0,
        bookmarksCount: 0,
        likeCount: 0,
        seenUsersCount: 0,
        createdAt: date,
        updatedAt: date,
        grant: 1,
        grantedUsers: [],
        grantedGroups: [],
      };
      const doc = (delegator as any).prepareDocument(page);
      expect(typeof doc.created_at).toBe('number');
      expect(typeof doc.updated_at).toBe('number');
    });
  });

  describe('search - sort order', () => {
    it('should pass sort parameter for createdAt', async () => {
      const mockClient = (delegator as any).client;
      mockClient
        .index('growi')
        .search.mockResolvedValue({ hits: [], estimatedTotalHits: 0 });

      await delegator.search(
        {
          queryString: 'test',
          terms: {
            match: ['test'],
            not_match: [],
            phrase: [],
            not_phrase: [],
            prefix: [],
            not_prefix: [],
            tag: [],
            not_tag: [],
          },
        },
        null,
        null,
        { sort: 'createdAt', order: 'desc' },
      );

      const searchCall = mockClient.index('growi').search.mock.calls[0];
      expect(searchCall[1]?.sort).toEqual(['created_at:desc']);
    });

    it('should pass sort parameter for updatedAt', async () => {
      const mockClient = (delegator as any).client;
      mockClient
        .index('growi')
        .search.mockResolvedValue({ hits: [], estimatedTotalHits: 0 });

      await delegator.search(
        {
          queryString: 'test',
          terms: {
            match: ['test'],
            not_match: [],
            phrase: [],
            not_phrase: [],
            prefix: [],
            not_prefix: [],
            tag: [],
            not_tag: [],
          },
        },
        null,
        null,
        { sort: 'updatedAt', order: 'asc' },
      );

      const searchCall = mockClient.index('growi').search.mock.calls[0];
      expect(searchCall[1]?.sort).toEqual(['updated_at:asc']);
    });
  });

  describe('search - pagination', () => {
    it('should pass offset and limit', async () => {
      const mockClient = (delegator as any).client;
      mockClient
        .index('growi')
        .search.mockResolvedValue({ hits: [], estimatedTotalHits: 0 });

      await delegator.search(
        {
          queryString: 'test',
          terms: {
            match: ['test'],
            not_match: [],
            phrase: [],
            not_phrase: [],
            prefix: [],
            not_prefix: [],
            tag: [],
            not_tag: [],
          },
        },
        null,
        null,
        { offset: 10, limit: 20 },
      );

      const searchCall = mockClient.index('growi').search.mock.calls[0];
      expect(searchCall[1]?.offset).toBe(10);
      expect(searchCall[1]?.limit).toBe(20);
    });
  });

  describe('sync methods', () => {
    it('syncPageUpdated should call updateOrInsertPageById', async () => {
      const spy = vi
        .spyOn(delegator, 'updateOrInsertPageById')
        .mockResolvedValue();
      await delegator.syncPageUpdated({ _id: 'page1' }, null);
      expect(spy).toHaveBeenCalledWith('page1');
    });

    it('syncPageDeleted should call deletePages', async () => {
      const spy = vi.spyOn(delegator, 'deletePages').mockResolvedValue();
      await delegator.syncPageDeleted({ _id: 'page1' }, null);
      expect(spy).toHaveBeenCalled();
    });

    it('syncBookmarkChanged should call updateOrInsertPageById', async () => {
      const spy = vi
        .spyOn(delegator, 'updateOrInsertPageById')
        .mockResolvedValue();
      await delegator.syncBookmarkChanged('page1');
      expect(spy).toHaveBeenCalledWith('page1');
    });

    it('syncCommentChanged should call updateOrInsertPageById with comment.page', async () => {
      const spy = vi
        .spyOn(delegator, 'updateOrInsertPageById')
        .mockResolvedValue();
      await delegator.syncCommentChanged({ page: 'page1' });
      expect(spy).toHaveBeenCalledWith('page1');
    });

    it('syncTagChanged should call updateOrInsertPageById', async () => {
      const spy = vi
        .spyOn(delegator, 'updateOrInsertPageById')
        .mockResolvedValue();
      await delegator.syncTagChanged({ _id: 'page1' });
      expect(spy).toHaveBeenCalledWith('page1');
    });
  });

  describe('updateOrInsertPages - streaming', () => {
    const makePage = (id: string) => ({
      _id: { toString: () => id },
      path: `/test${id}`,
      revision: { body: `body${id}` },
      creator: null,
      comments: [],
      commentsCount: 0,
      bookmarksCount: 0,
      likeCount: 0,
      seenUsersCount: 0,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
      tagNames: [],
      grant: 1,
      grantedUsers: [],
      grantedGroups: [],
    });

    function setupPageModel(pages: Record<string, unknown>[]) {
      const cursorStream = Readable.from(pages);
      const mockModel = {
        aggregate: vi.fn().mockReturnValue({ cursor: () => cursorStream }),
        find: vi.fn().mockReturnValue({}),
        PageQueryBuilder: vi.fn(() => ({
          query: { count: vi.fn().mockResolvedValue(pages.length) },
        })),
      };
      (delegator as any).pageModel = mockModel;
      return mockModel;
    }

    it('should use cursor-based streaming and prepare documents', async () => {
      const pages = [makePage('p1'), makePage('p2')];
      setupPageModel(pages);

      const mockIndex = (delegator as any).client.index('growi');
      await delegator.updateOrInsertPages(() =>
        (delegator as any).pageModel.find(),
      );

      expect(mockIndex.addDocuments).toHaveBeenCalled();
      const docs = mockIndex.addDocuments.mock.calls[0][0];
      expect(docs).toHaveLength(2);
      expect(docs[0].id).toBe('p1');
      expect(docs[1].id).toBe('p2');
    });

    it('should split documents into batches of configured size', async () => {
      const pages = Array.from({ length: 5 }, (_, i) => makePage(`p${i + 1}`));
      setupPageModel(pages);

      const getConfigMock = vi.mocked(configManager.getConfig);
      getConfigMock.mockImplementation((key: string) => {
        if (key === 'app:meilisearchReindexBulkSize') return 2;
        if (key === 'app:elasticsearchMaxBodyLengthToIndex') return 100000;
        return undefined;
      });

      const mockIndex = (delegator as any).client.index('growi');
      await delegator.updateOrInsertPages(() =>
        (delegator as any).pageModel.find(),
      );

      expect(mockIndex.addDocuments).toHaveBeenCalledTimes(3);
      expect(mockIndex.addDocuments.mock.calls[0][0]).toHaveLength(2);
      expect(mockIndex.addDocuments.mock.calls[1][0]).toHaveLength(2);
      expect(mockIndex.addDocuments.mock.calls[2][0]).toHaveLength(1);
    });

    it('should enrich documents with tag names per batch', async () => {
      const { default: PageTagRelation } = await import(
        '~/server/models/page-tag-relation'
      );
      const tagNamesMap = { p1: ['tag1', 'tag2'], p2: ['tag3'] };
      const getIdToTagNamesMapMock = vi.mocked(
        PageTagRelation.getIdToTagNamesMap,
      );
      getIdToTagNamesMapMock.mockResolvedValue(tagNamesMap);

      const pages = [
        { ...makePage('p1'), tagNames: undefined },
        { ...makePage('p2'), tagNames: undefined },
      ];
      setupPageModel(pages);

      const mockIndex = (delegator as any).client.index('growi');
      await delegator.updateOrInsertPages(() =>
        (delegator as any).pageModel.find(),
      );

      expect(getIdToTagNamesMapMock).toHaveBeenCalled();
      const docs = mockIndex.addDocuments.mock.calls[0][0];
      expect(docs[0].tag_names).toEqual(['tag1', 'tag2']);
      expect(docs[1].tag_names).toEqual(['tag3']);
    });

    it('should emit AddPageProgress and FinishAddPage when shouldEmitProgress is true', async () => {
      const mockSocket = { emit: vi.fn() };
      mockSocketIoService.getAdminSocket.mockReturnValue(mockSocket);

      const pages = Array.from({ length: 3 }, (_, i) => makePage(`p${i + 1}`));
      setupPageModel(pages);

      const getConfigMock = vi.mocked(configManager.getConfig);
      getConfigMock.mockImplementation((key: string) => {
        if (key === 'app:meilisearchReindexBulkSize') return 2;
        if (key === 'app:elasticsearchMaxBodyLengthToIndex') return 100000;
        return undefined;
      });

      const mockIndex = (delegator as any).client.index('growi');
      mockIndex.addDocuments.mockResolvedValue({});

      await delegator.updateOrInsertPages(
        () => (delegator as any).pageModel.find(),
        { shouldEmitProgress: true },
      );

      expect(mockSocket.emit).toHaveBeenCalledWith(
        SocketEventName.AddPageProgress,
        { totalCount: 3, count: 2 },
      );
      expect(mockSocket.emit).toHaveBeenCalledWith(
        SocketEventName.AddPageProgress,
        { totalCount: 3, count: 3 },
      );
      expect(mockSocket.emit).toHaveBeenCalledWith(
        SocketEventName.FinishAddPage,
        { totalCount: 3, count: 3 },
      );
    });

    it('should continue processing on addDocuments error', async () => {
      const pages = Array.from({ length: 4 }, (_, i) => makePage(`p${i + 1}`));
      setupPageModel(pages);

      const getConfigMock = vi.mocked(configManager.getConfig);
      getConfigMock.mockImplementation((key: string) => {
        if (key === 'app:meilisearchReindexBulkSize') return 2;
        if (key === 'app:elasticsearchMaxBodyLengthToIndex') return 100000;
        return undefined;
      });

      const mockIndex = (delegator as any).client.index('growi');
      mockIndex.addDocuments
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({});

      await delegator.updateOrInsertPages(() =>
        (delegator as any).pageModel.find(),
      );

      expect(mockIndex.addDocuments).toHaveBeenCalledTimes(2);
    });

    it('should handle empty result gracefully', async () => {
      setupPageModel([]);

      const mockIndex = (delegator as any).client.index('growi');
      await delegator.updateOrInsertPages(() =>
        (delegator as any).pageModel.find(),
      );

      expect(mockIndex.addDocuments).not.toHaveBeenCalled();
    });
  });

  describe('addAllPages', () => {
    const makePage = (id: string) => ({
      _id: { toString: () => id },
      path: `/test${id}`,
      revision: { body: `body${id}` },
      creator: null,
      comments: [],
      commentsCount: 0,
      bookmarksCount: 0,
      likeCount: 0,
      seenUsersCount: 0,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
      tagNames: [],
      grant: 1,
      grantedUsers: [],
      grantedGroups: [],
    });

    it('should call updateOrInsertPages with Page.find()', async () => {
      const pages = [makePage('p1')];
      const cursorStream = Readable.from(pages);
      const mockModel = {
        aggregate: vi.fn().mockReturnValue({ cursor: () => cursorStream }),
        find: vi.fn().mockReturnValue({}),
        PageQueryBuilder: vi.fn(() => ({
          query: { count: vi.fn().mockResolvedValue(1) },
        })),
      };
      (delegator as any).pageModel = mockModel;

      const spy = vi.spyOn(delegator, 'updateOrInsertPages');
      await delegator.addAllPages();

      expect(spy).toHaveBeenCalled();
      expect(mockModel.find).toHaveBeenCalled();
    });

    it('should pass shouldEmitProgress option to updateOrInsertPages', async () => {
      const pages = [makePage('p1')];
      const cursorStream = Readable.from(pages);
      const mockModel = {
        aggregate: vi.fn().mockReturnValue({ cursor: () => cursorStream }),
        find: vi.fn().mockReturnValue({}),
        PageQueryBuilder: vi.fn(() => ({
          query: { count: vi.fn().mockResolvedValue(1) },
        })),
      };
      (delegator as any).pageModel = mockModel;

      const mockSocket = { emit: vi.fn() };
      mockSocketIoService.getAdminSocket.mockReturnValue(mockSocket);

      const mockIndex = (delegator as any).client.index('growi');
      await delegator.addAllPages({ shouldEmitProgress: true });

      expect(mockSocket.emit).toHaveBeenCalledWith(
        SocketEventName.FinishAddPage,
        {
          totalCount: 1,
          count: 1,
        },
      );
    });
  });

  describe('getInfo', () => {
    it('should return version and stats', async () => {
      const mockClient = (delegator as any).client;
      mockClient.index('growi').getStats = vi
        .fn()
        .mockResolvedValue({ numberOfDocuments: 10 });
      mockClient.version = vi.fn().mockResolvedValue({ pkgVersion: '1.8.0' });

      const info = await delegator.getInfo();

      expect(info.meiliVersion).toEqual({ pkgVersion: '1.8.0' });
      expect(info.stats).toEqual({ numberOfDocuments: 10 });
    });
  });

  describe('getInfoForHealth', () => {
    it('should return health status', async () => {
      const mockClient = (delegator as any).client;
      mockClient.health = vi.fn().mockResolvedValue({ status: 'available' });

      const health = await delegator.getInfoForHealth();

      expect(health.meiliHealth).toEqual({ status: 'available' });
    });
  });

  describe('getConnectionInfo', () => {
    it('should return configured values when env is set', () => {
      const getConfigMock = vi.mocked(configManager.getConfig);
      getConfigMock.mockImplementation((key: string) => {
        if (key === 'app:meilisearchUri') return 'http://meili:7700';
        if (key === 'app:meilisearchApiKey') return 'secret-key';
        return undefined;
      });

      const info = (delegator as any).getConnectionInfo();

      expect(info.uri).toBe('http://meili:7700');
      expect(info.apiKey).toBe('secret-key');
    });
  });

  describe('deletePages', () => {
    it('should call index.deleteDocuments with page IDs', async () => {
      const mockIndex = (delegator as any).client.index('growi');

      const pages = [
        { _id: { toString: () => 'page1' } },
        { _id: { toString: () => 'page2' } },
      ];
      await delegator.deletePages(pages);

      expect(mockIndex.deleteDocuments).toHaveBeenCalledWith([
        'page1',
        'page2',
      ]);
    });
  });

  describe('updateOrInsertPageById', () => {
    it('should call updateOrInsertPages with Page.findById', async () => {
      const mockModel = {
        findById: vi.fn().mockReturnValue({}),
        aggregate: vi.fn().mockReturnValue({ cursor: () => Readable.from([]) }),
        PageQueryBuilder: vi.fn(() => ({
          query: { count: vi.fn().mockResolvedValue(0) },
        })),
      };
      (delegator as any).pageModel = mockModel;

      const spy = vi.spyOn(delegator, 'updateOrInsertPages');
      await delegator.updateOrInsertPageById('page1');

      expect(spy).toHaveBeenCalled();
      expect(mockModel.findById).toHaveBeenCalledWith('page1');
    });
  });

  describe('rebuildIndex', () => {
    it('should call addAllPages with shouldEmitProgress option', async () => {
      const spy = vi.spyOn(delegator, 'addAllPages').mockResolvedValue();
      await delegator.rebuildIndex({ shouldEmitProgress: true });
      expect(spy).toHaveBeenCalledWith({ shouldEmitProgress: true });
    });
  });

  describe('syncDescendantsPagesUpdated', () => {
    it('should call updateOrInsertPages with descendant query', async () => {
      const mockQuery = {
        count: vi.fn().mockResolvedValue(0),
      };
      const mockBuilder = {
        query: mockQuery,
        addConditionToListWithDescendants: vi.fn(),
      };
      const mockPageModel = {
        find: vi.fn().mockReturnValue({}),
        PageQueryBuilder: vi.fn(() => mockBuilder),
        aggregate: vi.fn().mockReturnValue({ cursor: () => Readable.from([]) }),
      };
      (delegator as any).pageModel = mockPageModel;

      const spy = vi.spyOn(delegator, 'updateOrInsertPages');
      await delegator.syncDescendantsPagesUpdated({ path: '/parent' }, null);

      expect(
        mockBuilder.addConditionToListWithDescendants,
      ).toHaveBeenCalledWith('/parent');
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('syncDescendantsPagesDeleted', () => {
    it('should call deletePages with pages array', async () => {
      const spy = vi.spyOn(delegator, 'deletePages').mockResolvedValue();
      const pages = [
        { _id: { toString: () => 'p1' } },
        { _id: { toString: () => 'p2' } },
      ];

      await delegator.syncDescendantsPagesDeleted(pages, null);

      expect(spy).toHaveBeenCalledWith(pages);
    });
  });

  describe('syncPagesUpdated', () => {
    it('should return resolved promise (no-op)', async () => {
      const result = delegator.syncPagesUpdated([], null);
      await expect(result).resolves.toBeUndefined();
    });
  });

  describe('prepareDocument - edge cases', () => {
    it('should extract username from creator', () => {
      const page = {
        _id: { toString: () => 'page1' },
        path: '/test',
        revision: { body: 'hello' },
        creator: { username: 'john_doe' },
        comments: [],
        commentsCount: 0,
        bookmarksCount: 0,
        likeCount: 0,
        seenUsersCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        tagNames: [],
        grant: 1,
        grantedUsers: [],
        grantedGroups: [],
      };
      const doc = (delegator as any).prepareDocument(page);
      expect(doc.username).toBe('john_doe');
    });

    it('should handle empty username when creator is null', () => {
      const page = {
        _id: { toString: () => 'page1' },
        path: '/test',
        revision: { body: 'hello' },
        creator: null,
        comments: [],
        commentsCount: 0,
        bookmarksCount: 0,
        likeCount: 0,
        seenUsersCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        tagNames: [],
        grant: 1,
        grantedUsers: [],
        grantedGroups: [],
      };
      const doc = (delegator as any).prepareDocument(page);
      expect(doc.username).toBe('');
    });

    it('should map comment bodies from populated comments', () => {
      const page = {
        _id: { toString: () => 'page1' },
        path: '/test',
        revision: { body: 'hello' },
        creator: null,
        comments: ['nice comment', 'another comment'],
        commentsCount: 2,
        bookmarksCount: 0,
        likeCount: 0,
        seenUsersCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        tagNames: [],
        grant: 1,
        grantedUsers: [],
        grantedGroups: [],
      };
      const doc = (delegator as any).prepareDocument(page);
      expect(doc.comments).toEqual(['nice comment', 'another comment']);
    });

    it('should handle mixed comment types (object with comment field)', () => {
      const page = {
        _id: { toString: () => 'page1' },
        path: '/test',
        revision: { body: 'hello' },
        creator: null,
        comments: [
          'plain string',
          { comment: 'object comment' },
          { comment: '' },
          { comment: undefined },
        ],
        commentsCount: 4,
        bookmarksCount: 0,
        likeCount: 0,
        seenUsersCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        tagNames: [],
        grant: 1,
        grantedUsers: [],
        grantedGroups: [],
      };
      const doc = (delegator as any).prepareDocument(page);
      expect(doc.comments[0]).toBe('plain string');
      expect(doc.comments[1]).toBe('object comment');
      expect(doc.comments[2]).toBe('');
      expect(doc.comments[3]).toBe('');
    });

    it('should handle grantedGroups with item objects', () => {
      const page = {
        _id: { toString: () => 'page1' },
        path: '/test',
        revision: { body: 'hello' },
        creator: null,
        comments: [],
        commentsCount: 0,
        bookmarksCount: 0,
        likeCount: 0,
        seenUsersCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        tagNames: [],
        grant: 1,
        grantedUsers: [],
        grantedGroups: [
          { item: { toString: () => 'group1' } },
          { item: { toString: () => 'group2' } },
        ],
      };
      const doc = (delegator as any).prepareDocument(page);
      expect(doc.granted_groups).toEqual(['group1', 'group2']);
    });

    it('should handle grantedGroups with direct ObjectId strings', () => {
      const page = {
        _id: { toString: () => 'page1' },
        path: '/test',
        revision: { body: 'hello' },
        creator: null,
        comments: [],
        commentsCount: 0,
        bookmarksCount: 0,
        likeCount: 0,
        seenUsersCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        tagNames: [],
        grant: 1,
        grantedUsers: [],
        grantedGroups: [
          { toString: () => 'group1' },
          { toString: () => 'group2' },
        ],
      };
      const doc = (delegator as any).prepareDocument(page);
      expect(doc.granted_groups).toEqual(['group1', 'group2']);
    });

    it('should handle null grantedGroups gracefully', () => {
      const page = {
        _id: { toString: () => 'page1' },
        path: '/test',
        revision: { body: 'hello' },
        creator: null,
        comments: [],
        commentsCount: 0,
        bookmarksCount: 0,
        likeCount: 0,
        seenUsersCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        tagNames: [],
        grant: 1,
        grantedUsers: [],
        grantedGroups: null,
      };
      const doc = (delegator as any).prepareDocument(page);
      expect(doc.granted_groups).toEqual([]);
    });
  });

  describe('search - edge cases', () => {
    it('should handle empty query string with only negations', async () => {
      const mockClient = (delegator as any).client;
      mockClient
        .index('growi')
        .search.mockResolvedValue({ hits: [], estimatedTotalHits: 0 });

      await delegator.search(
        {
          queryString: '',
          terms: {
            match: [],
            not_match: ['exclude'],
            phrase: [],
            not_phrase: [],
            prefix: [],
            not_prefix: [],
            tag: [],
            not_tag: [],
          },
        },
        null,
        null,
        {},
      );

      const searchCall = mockClient.index('growi').search.mock.calls[0];
      expect(searchCall[0]).toBe('-exclude');
    });

    it('should handle only not_match terms without match', async () => {
      const mockClient = (delegator as any).client;
      mockClient
        .index('growi')
        .search.mockResolvedValue({ hits: [], estimatedTotalHits: 0 });

      await delegator.search(
        {
          queryString: 'prefix:/Sandbox',
          terms: {
            match: [],
            not_match: ['world'],
            phrase: [],
            not_phrase: [],
            prefix: ['/Sandbox'],
            not_prefix: [],
            tag: [],
            not_tag: [],
          },
        },
        null,
        null,
        {},
      );

      const searchCall = mockClient.index('growi').search.mock.calls[0];
      expect(searchCall[0]).toBe('-world');
    });

    it('should default to DEFAULT_OFFSET and DEFAULT_LIMIT when option is empty', async () => {
      const mockClient = (delegator as any).client;
      mockClient
        .index('growi')
        .search.mockResolvedValue({ hits: [], estimatedTotalHits: 0 });

      await delegator.search(
        {
          queryString: 'test',
          terms: {
            match: ['test'],
            not_match: [],
            phrase: [],
            not_phrase: [],
            prefix: [],
            not_prefix: [],
            tag: [],
            not_tag: [],
          },
        },
        null,
        null,
        {},
      );

      const searchCall = mockClient.index('growi').search.mock.calls[0];
      expect(searchCall[1]?.offset).toBe(0);
      expect(searchCall[1]?.limit).toBe(50);
    });

    it('should pass highlights params to Meilisearch', async () => {
      const mockClient = (delegator as any).client;
      mockClient
        .index('growi')
        .search.mockResolvedValue({ hits: [], estimatedTotalHits: 0 });

      await delegator.search(
        {
          queryString: 'test',
          terms: {
            match: ['test'],
            not_match: [],
            phrase: [],
            not_phrase: [],
            prefix: [],
            not_prefix: [],
            tag: [],
            not_tag: [],
          },
        },
        null,
        null,
        {},
      );

      const searchCall = mockClient.index('growi').search.mock.calls[0];
      expect(searchCall[1]?.attributesToHighlight).toEqual(['*']);
      expect(searchCall[1]?.highlightPreTag).toBe(
        "<em class='highlighted-keyword'>",
      );
      expect(searchCall[1]?.highlightPostTag).toBe('</em>');
    });

    it('should handle multiple prefix filters combined', async () => {
      const mockClient = (delegator as any).client;
      mockClient
        .index('growi')
        .search.mockResolvedValue({ hits: [], estimatedTotalHits: 0 });

      await delegator.search(
        {
          queryString: 'prefix:/A prefix:/B',
          terms: {
            match: [],
            prefix: ['/A', '/B'],
            not_match: [],
            phrase: [],
            not_phrase: [],
            not_prefix: [],
            tag: [],
            not_tag: [],
          },
        },
        null,
        null,
        {},
      );

      const searchCall = mockClient.index('growi').search.mock.calls[0];
      const filter = (searchCall[1]?.filter ?? []).join(' ');
      expect(filter).toContain('path STARTS WITH "/A"');
      expect(filter).toContain('path STARTS WITH "/B"');
    });
  });
});
