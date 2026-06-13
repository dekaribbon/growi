import React, { useCallback, useState } from 'react';
import useSWR from 'swr';

import { apiv3Get, apiv3Put } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';

interface Rule {
  pattern: string;
  users?: string[];
  groups?: string[];
}

interface Config {
  rules: Rule[];
}

const fetchConfig = async (): Promise<Config> => {
  const res = await apiv3Get<{ config: Config }>('/page-write-permissions/');
  return res.data.config;
};

export const PageWritePermissions: React.FC = () => {
  const { data, mutate, error } = useSWR(
    '/page-write-permissions/',
    fetchConfig,
  );
  const [rules, setRules] = useState<Rule[]>([]);
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (data?.rules) {
      setRules(data.rules);
    }
  }, [data]);

  const addRule = useCallback(() => {
    setRules((prev) => [...prev, { pattern: '', users: [], groups: [] }]);
  }, []);

  const removeRule = useCallback((index: number) => {
    setRules((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updatePattern = useCallback((index: number, value: string) => {
    setRules((prev) => prev.map((r, i) => (i === index ? { ...r, pattern: value } : r)));
  }, []);

  const updateUsers = useCallback((index: number, value: string) => {
    const users = value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    setRules((prev) => prev.map((r, i) => (i === index ? { ...r, users } : r)));
  }, []);

  const updateGroups = useCallback((index: number, value: string) => {
    const groups = value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    setRules((prev) => prev.map((r, i) => (i === index ? { ...r, groups } : r)));
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await apiv3Put('/page-write-permissions/', { config: { rules } });
      mutate();
      toastSuccess('Saved');
    }
    catch {
      toastError('Failed to save');
    }
    finally {
      setSaving(false);
    }
  }, [rules, mutate]);

  if (error && !data) {
    return (
      <div className="alert alert-danger">Failed to load configuration.</div>
    );
  }

  if (!data && !error) {
    return <div className="text-muted">Loading...</div>;
  }

  return (
    <div>
      <p className="form-text mb-3">
        Restrict page write access to specific users or groups.
        Pages matching a pattern can only be edited by the listed users or
        group members.
      </p>

      {rules.length === 0 && (
        <div className="alert alert-info">
          No rules configured. All users can edit all pages.
        </div>
      )}

      {rules.map((rule, index) => (
        <div
          key={index}
          className="card mb-3"
        >
          <div className="card-header d-flex justify-content-between align-items-center">
            <strong>Rule #{index + 1}</strong>
            <button
              type="button"
              className="btn btn-sm btn-outline-danger"
              onClick={() => removeRule(index)}
            >
              Remove
            </button>
          </div>
          <div className="card-body">
            <div className="mb-2">
              <label className="form-label" htmlFor={`pattern-${index}`}>
                Page Pattern
              </label>
              <input
                id={`pattern-${index}`}
                type="text"
                className="form-control"
                placeholder="/restricted/*"
                value={rule.pattern}
                onChange={(e) => updatePattern(index, e.target.value)}
              />
              <small className="form-text text-muted">
                Use <code>*</code> as wildcard (e.g. <code>/docs/internal/*</code>)
              </small>
            </div>
            <div className="mb-2">
              <label className="form-label" htmlFor={`users-${index}`}>
                Allowed Users
              </label>
              <input
                id={`users-${index}`}
                type="text"
                className="form-control"
                placeholder="username1, username2"
                value={rule.users?.join(', ') ?? ''}
                onChange={(e) => updateUsers(index, e.target.value)}
              />
              <small className="form-text text-muted">Comma-separated usernames</small>
            </div>
            <div className="mb-2">
              <label className="form-label" htmlFor={`groups-${index}`}>
                Allowed Groups
              </label>
              <input
                id={`groups-${index}`}
                type="text"
                className="form-control"
                placeholder="admin-group, editors"
                value={rule.groups?.join(', ') ?? ''}
                onChange={(e) => updateGroups(index, e.target.value)}
              />
              <small className="form-text text-muted">
                Comma-separated group names
              </small>
            </div>
          </div>
        </div>
      ))}

      <div className="d-flex gap-2">
        <button type="button" className="btn btn-outline-primary" onClick={addRule}>
          Add Rule
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={save}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
};
