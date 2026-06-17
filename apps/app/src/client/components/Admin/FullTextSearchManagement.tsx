import React, { type JSX, useEffect, useState } from 'react';
import { useTranslation } from 'next-i18next';

import { apiv3Get } from '~/client/util/apiv3-client';

import ElasticsearchManagement from './ElasticsearchManagement/ElasticsearchManagement';
import MeilisearchManagement from './MeilisearchManagement/MeilisearchManagement';

export const FullTextSearchManagement = (): JSX.Element => {
  const { t } = useTranslation('admin');

  const [provider, setProvider] = useState<string | null>(null);

  useEffect(() => {
    apiv3Get('/search/indices')
      .then(({ data }) => {
        if (data.provider != null) {
          setProvider(data.provider);
        }
      })
      .catch(() => {
        // ignore
      });
  }, []);

  return (
    <div data-testid="admin-full-text-search">
      <h2 className="mb-4">
        {t('full_text_search_management.full_text_search_management')}
        {provider && (
          <span className="ms-2 badge bg-secondary">{provider}</span>
        )}
      </h2>
      {provider === 'meilisearch' ? (
        <MeilisearchManagement />
      ) : (
        <ElasticsearchManagement />
      )}
    </div>
  );
};
