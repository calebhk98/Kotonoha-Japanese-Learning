import { useState, useEffect } from 'react';
import { Key, RefreshCw, CheckCircle, XCircle, Loader2, AlertCircle, Trash2, Zap } from 'lucide-react';
import { WK_STAGE_NAMES, loadCachedWaniKaniData } from '../lib/wanikani';
import { clearServerCache } from '../lib/api';

interface WaniKaniUser {
  username: string;
  level: number;
}

type TokenStatus = 'idle' | 'testing' | 'valid' | 'invalid';
type SyncStatus = 'idle' | 'syncing' | 'done' | 'error';
type ClearCacheStatus = 'idle' | 'clearing' | 'done' | 'error';

export function SettingsPage({ onWaniKaniSync }: { onWaniKaniSync?: () => void }) {
  const [token, setToken] = useState('');
  const [tokenStatus, setTokenStatus] = useState<TokenStatus>('idle');
  const [savedUser, setSavedUser] = useState<WaniKaniUser | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [syncInfo, setSyncInfo] = useState<{ kanjiCount: number; syncedAt: number } | null>(null);
  const [clearCacheStatus, setClearCacheStatus] = useState<ClearCacheStatus>('idle');

  useEffect(() => {
    const storedToken = localStorage.getItem('waniKaniToken');
    if (storedToken) setToken(storedToken);

    const storedUser = localStorage.getItem('waniKaniUser');
    if (storedUser) {
      try { setSavedUser(JSON.parse(storedUser)); } catch { /* ignore */ }
    }

    const cached = loadCachedWaniKaniData();
    if (cached) setSyncInfo({ kanjiCount: cached.kanjiCount, syncedAt: cached.syncedAt });
  }, []);

  const testToken = async () => {
    if (!token.trim()) return;
    setTokenStatus('testing');
    try {
      const res = await fetch('/api/wanikani/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      });
      const data = await res.json();
      if (data.valid) {
        localStorage.setItem('waniKaniToken', token.trim());
        const user = { username: data.username, level: data.level };
        localStorage.setItem('waniKaniUser', JSON.stringify(user));
        setSavedUser(user);
        setTokenStatus('valid');
      } else {
        setTokenStatus('invalid');
      }
    } catch {
      setTokenStatus('invalid');
    }
  };

  const syncData = async () => {
    const storedToken = localStorage.getItem('waniKaniToken');
    if (!storedToken) return;
    setSyncStatus('syncing');
    try {
      const res = await fetch('/api/wanikani/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: storedToken }),
      });
      if (!res.ok) throw new Error('Sync failed');
      const result = await res.json();
      // result: { data: Record<string,number>, kanjiCount: number }
      const syncedAt = Date.now();
      localStorage.setItem('waniKaniData', JSON.stringify({ data: result.data, syncedAt, kanjiCount: result.kanjiCount }));
      setSyncInfo({ kanjiCount: result.kanjiCount, syncedAt });
      setSyncStatus('done');
      onWaniKaniSync?.();
    } catch {
      setSyncStatus('error');
    }
  };

  const clearWaniKani = () => {
    localStorage.removeItem('waniKaniToken');
    localStorage.removeItem('waniKaniUser');
    localStorage.removeItem('waniKaniData');
    setToken('');
    setSavedUser(null);
    setSyncInfo(null);
    setTokenStatus('idle');
    setSyncStatus('idle');
    onWaniKaniSync?.();
  };

  const handleClearServerCache = async () => {
    setClearCacheStatus('clearing');
    try {
      await clearServerCache();
      setClearCacheStatus('done');
      setTimeout(() => setClearCacheStatus('idle'), 3000);
    } catch {
      setClearCacheStatus('error');
      setTimeout(() => setClearCacheStatus('idle'), 3000);
    }
  };

  const hasValidToken = tokenStatus === 'valid' || (savedUser !== null && tokenStatus === 'idle');

  return (
    <section className="space-y-6 max-w-2xl">
      <div className="mb-8">
        <h2 className="text-2xl font-semibold tracking-tight mb-1">Settings</h2>
        <p className="text-sm text-gray-500">Configure API integrations and personalization options.</p>
      </div>

      {/* WaniKani Integration */}
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-8 py-6 border-b border-gray-100 flex items-center gap-3">
          <div className="bg-rose-50 p-2 rounded-xl">
            <Key className="w-5 h-5 text-rose-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">WaniKani API Key</h3>
            <p className="text-xs text-gray-500 mt-0.5">Personalizes difficulty scores based on your SRS progress</p>
          </div>
          {savedUser && (
            <div className="ml-auto flex items-center gap-2 bg-green-50 border border-green-100 px-3 py-1.5 rounded-full">
              <CheckCircle className="w-3.5 h-3.5 text-green-600" />
              <span className="text-xs font-semibold text-green-700">
                {savedUser.username} · Level {savedUser.level}
              </span>
            </div>
          )}
        </div>

        <div className="px-8 py-6 space-y-5">
          <div>
            <p className="text-sm text-gray-600 mb-3">
              When connected, kanji difficulty scores are multiplied by your WaniKani SRS confidence level:
            </p>
            <div className="grid grid-cols-3 gap-2 text-xs text-gray-600 bg-gray-50 rounded-xl p-3">
              {Object.entries(WK_STAGE_NAMES).map(([stage, name]) => (
                <div key={stage} className="flex justify-between gap-1">
                  <span className="text-gray-500">{name}</span>
                  <span className="font-mono font-medium text-indigo-600">
                    ×{stage === '1' ? '0.95' : stage === '2' ? '0.90' : stage === '3' ? '0.80' :
                      stage === '4' ? '0.70' : stage === '5' ? '0.50' : stage === '6' ? '0.35' :
                      stage === '7' ? '0.25' : stage === '8' ? '0.15' : '0.05'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-700">API Token</label>
            <div className="flex gap-2">
              <input
                type="password"
                value={token}
                onChange={e => { setToken(e.target.value); setTokenStatus('idle'); }}
                onKeyDown={e => e.key === 'Enter' && testToken()}
                placeholder="Paste your WaniKani v2 API token..."
                className="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 font-mono"
              />
              <button
                onClick={testToken}
                disabled={!token.trim() || tokenStatus === 'testing'}
                className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                {tokenStatus === 'testing' ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Testing...</>
                ) : 'Test & Save'}
              </button>
            </div>

            {tokenStatus === 'valid' && (
              <div className="flex items-center gap-2 text-green-700 text-sm">
                <CheckCircle className="w-4 h-4" />
                Token saved! Sync your data to apply WaniKani adjustments.
              </div>
            )}
            {tokenStatus === 'invalid' && (
              <div className="flex items-center gap-2 text-red-600 text-sm">
                <XCircle className="w-4 h-4" />
                Invalid token. Check your WaniKani API settings and try again.
              </div>
            )}

            <p className="text-xs text-gray-400">
              Find your token at{' '}
              <span className="font-mono bg-gray-100 px-1 py-0.5 rounded">wanikani.com → Settings → API Tokens</span>
            </p>
          </div>

          {hasValidToken && (
            <div className="pt-4 border-t border-gray-100 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-700">Sync SRS Data</p>
                  {syncInfo ? (
                    <p className="text-xs text-gray-400 mt-0.5">
                      {syncInfo.kanjiCount} kanji synced · Last synced {new Date(syncInfo.syncedAt).toLocaleString()}
                    </p>
                  ) : (
                    <p className="text-xs text-gray-400 mt-0.5">Not yet synced — scores use static JLPT data</p>
                  )}
                </div>
                <button
                  onClick={syncData}
                  disabled={syncStatus === 'syncing'}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-700 text-sm font-medium rounded-xl hover:bg-indigo-100 border border-indigo-200 disabled:opacity-50 transition-colors"
                >
                  {syncStatus === 'syncing' ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Syncing...</>
                  ) : (
                    <><RefreshCw className="w-4 h-4" /> {syncInfo ? 'Re-sync' : 'Sync Now'}</>
                  )}
                </button>
              </div>

              {syncStatus === 'done' && (
                <div className="flex items-center gap-2 text-green-700 text-sm bg-green-50 border border-green-100 rounded-lg px-3 py-2">
                  <CheckCircle className="w-4 h-4 shrink-0" />
                  Sync complete! Difficulty scores now reflect your WaniKani progress.
                  Reload content to see updated scores.
                </div>
              )}
              {syncStatus === 'error' && (
                <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  Sync failed. Check your connection and try again.
                </div>
              )}

              <div className="pt-2">
                <button
                  onClick={clearWaniKani}
                  className="flex items-center gap-2 text-xs text-red-500 hover:text-red-700 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Remove WaniKani integration
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Server Cache Management */}
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-8 py-6 border-b border-gray-100 flex items-center gap-3">
          <div className="bg-amber-50 p-2 rounded-xl">
            <Zap className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">Cache Management</h3>
            <p className="text-xs text-gray-500 mt-0.5">Clear dictionary and definition caches</p>
          </div>
        </div>

        <div className="px-8 py-6 space-y-4">
          <p className="text-sm text-gray-600">
            Clear server-side caches to force fresh dictionary lookups. Use this when testing or troubleshooting.
          </p>
          <button
            onClick={handleClearServerCache}
            disabled={clearCacheStatus === 'clearing'}
            className="flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-700 text-sm font-medium rounded-xl hover:bg-amber-100 border border-amber-200 disabled:opacity-50 transition-colors w-full justify-center"
          >
            {clearCacheStatus === 'clearing' ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Clearing...</>
            ) : (
              <><Trash2 className="w-4 h-4" /> Clear Server Cache</>
            )}
          </button>
          {clearCacheStatus === 'done' && (
            <div className="flex items-center gap-2 text-green-700 text-sm bg-green-50 border border-green-100 rounded-lg px-3 py-2">
              <CheckCircle className="w-4 h-4 shrink-0" />
              Cache cleared! Next lookup will re-fetch from Jisho API.
            </div>
          )}
          {clearCacheStatus === 'error' && (
            <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              Failed to clear cache. Try again.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
