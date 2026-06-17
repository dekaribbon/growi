import type { SearchDelegatorName } from '~/interfaces/named-query';
import type { ISearchResult } from '~/interfaces/search';

export type QueryTerms = {
  match: string[];
  not_match: string[];
  phrase: string[];
  not_phrase: string[];
  prefix: string[];
  not_prefix: string[];
  tag: string[];
  not_tag: string[];
};

export type ParsedQuery = {
  queryString: string;
  terms: QueryTerms;
  delegatorName?: string;
};

export interface SearchQueryParser {
  parseSearchQuery(
    queryString: string,
    nqName: string | null,
  ): Promise<ParsedQuery>;
}

export interface SearchResolver {
  resolve(
    parsedQuery: ParsedQuery,
  ): Promise<[SearchDelegator, SearchableData | null]>;
}

export interface SearchDelegator<
  T = unknown,
  KEY extends AllTermsKey = AllTermsKey,
  QTERMS = QueryTerms,
> {
  name?: SearchDelegatorName;
  search(
    data: SearchableData | null,
    user,
    userGroups,
    option,
  ): Promise<ISearchResult<T>>;
  isTermsNormalized(terms: Partial<QueryTerms>): terms is Partial<QTERMS>;
  validateTerms(terms: QueryTerms): UnavailableTermsKey<KEY>[];
}

export type UpdateOrInsertPagesOpts = {
  shouldEmitProgress?: boolean;
  invokeGarbageCollection?: boolean;
};

export type RebuildIndexOption = {
  shouldEmitProgress?: boolean;
};

export interface FullTextSearchDelegator<
  T = unknown,
  KEY extends AllTermsKey = AllTermsKey,
  QTERMS = QueryTerms,
> extends SearchDelegator<T, KEY, QTERMS> {
  init(): Promise<void>;
  initClient(): Promise<void>;
  getInfo(): Promise<any>;
  getInfoForHealth(): Promise<any>;
  getInfoForAdmin(): Promise<any>;
  normalizeIndices(): Promise<any>;
  rebuildIndex(option?: RebuildIndexOption): Promise<void>;
  syncPageUpdated(page, user): Promise<any>;
  syncPageDeleted(page, user): Promise<any>;
  syncPagesUpdated(pages, user): Promise<any>;
  syncDescendantsPagesUpdated(parentPage, user): Promise<any>;
  syncDescendantsPagesDeleted(pages, user): Promise<any>;
  syncBookmarkChanged(pageId): Promise<any>;
  syncCommentChanged(comment): Promise<any>;
  syncTagChanged(page): Promise<any>;
}

export type SearchableData<T = Partial<QueryTerms>> = {
  queryString: string;
  terms: T;
};

// Terms Key types
export type AllTermsKey = keyof QueryTerms;
export type UnavailableTermsKey<K extends AllTermsKey> = Exclude<
  AllTermsKey,
  K
>;
export type ESTermsKey =
  | 'match'
  | 'not_match'
  | 'phrase'
  | 'not_phrase'
  | 'prefix'
  | 'not_prefix'
  | 'tag'
  | 'not_tag';
export type MongoTermsKey = 'match' | 'not_match' | 'prefix' | 'not_prefix';
export type MeiliTermsKey =
  | 'match'
  | 'not_match'
  | 'phrase'
  | 'not_phrase'
  | 'prefix'
  | 'not_prefix'
  | 'tag'
  | 'not_tag';

// Query Terms types
export type ESQueryTerms = Pick<QueryTerms, ESTermsKey>;
export type MongoQueryTerms = Pick<QueryTerms, MongoTermsKey>;
export type MeiliQueryTerms = Pick<QueryTerms, MeiliTermsKey>;
