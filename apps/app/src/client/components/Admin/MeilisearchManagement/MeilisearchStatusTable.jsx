import React from 'react';
import { useTranslation } from 'next-i18next';
import PropTypes from 'prop-types';

class MeilisearchStatusTable extends React.PureComponent {
  renderPreInitializedLabel() {
    return <span className="badge text-bg-default">――</span>;
  }

  renderConnectionStatusLabels() {
    const { t } = this.props;
    const { isErrorOccuredOnSearchService, isConnected, isConfigured } =
      this.props;

    const errorOccuredLabel = isErrorOccuredOnSearchService ? (
      <span className="badge text-bg-danger ms-2">
        {t('full_text_search_management.connection_status_label_erroroccured')}
      </span>
    ) : null;

    let connectionStatusLabel = null;
    if (!isConfigured) {
      connectionStatusLabel = (
        <span className="badge text-bg-default">
          {t(
            'full_text_search_management.connection_status_label_unconfigured',
          )}
        </span>
      );
    } else {
      connectionStatusLabel = isConnected ? (
        <span
          data-testid="connection-status-badge-connected"
          className="badge text-bg-success"
        >
          {t('full_text_search_management.connection_status_label_connected')}
        </span>
      ) : (
        <span className="badge text-bg-danger">
          {t(
            'full_text_search_management.connection_status_label_disconnected',
          )}
        </span>
      );
    }

    return (
      <>
        {connectionStatusLabel}
        {errorOccuredLabel}
      </>
    );
  }

  renderIndicesStatusLabel() {
    const { t, isNormalized } = this.props;

    return isNormalized ? (
      <span className="badge text-bg-info">
        {t('full_text_search_management.indices_status_label_normalized')}
      </span>
    ) : (
      <span className="badge text-bg-warning">
        {t('full_text_search_management.indices_status_label_unnormalized')}
      </span>
    );
  }

  renderMeilisearchInfo() {
    const { t, documentCount } = this.props;

    return (
      <div>
        <div className="mb-2">
          <span className="fw-bold me-2">{t('search_engine')}:</span>
          <span className="badge text-bg-secondary">meilisearch</span>
        </div>
        {documentCount != null && (
          <div className="mb-2">
            <span className="fw-bold me-2">{t('number_of_documents')}:</span>
            <span className="badge text-bg-info">{documentCount}</span>
          </div>
        )}
      </div>
    );
  }

  render() {
    const { t } = this.props;
    const { isInitialized } = this.props;

    return (
      <table className="table table-bordered">
        <tbody>
          <tr>
            <th className="w-25">
              {t('full_text_search_management.connection_status')}
            </th>
            <td className="w-75">
              {isInitialized
                ? this.renderConnectionStatusLabels()
                : this.renderPreInitializedLabel()}
            </td>
          </tr>
          <tr>
            <th className="w-25">
              {t('full_text_search_management.indices_status')}
            </th>
            <td className="w-75">
              {isInitialized
                ? this.renderIndicesStatusLabel()
                : this.renderPreInitializedLabel()}
            </td>
          </tr>
          <tr>
            <th className="w-25">
              {t('full_text_search_management.indices_summary')}
            </th>
            <td className="p-4 w-75">
              {isInitialized ? this.renderMeilisearchInfo() : null}
            </td>
          </tr>
        </tbody>
      </table>
    );
  }
}

const MeilisearchStatusTableWrapperFC = (props) => {
  const { t } = useTranslation('admin');

  return <MeilisearchStatusTable t={t} {...props} />;
};

MeilisearchStatusTable.propTypes = {
  t: PropTypes.func.isRequired,

  isInitialized: PropTypes.bool,
  isErrorOccuredOnSearchService: PropTypes.bool,

  isConnected: PropTypes.bool,
  isConfigured: PropTypes.bool,
  isNormalized: PropTypes.bool,
  documentCount: PropTypes.number,
};

export default MeilisearchStatusTableWrapperFC;
