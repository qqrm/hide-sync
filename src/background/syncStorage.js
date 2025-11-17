(() => {
  const browserApi = typeof browser !== 'undefined' ? browser : chrome;

  const STORAGE_KEYS = {
    data: 'hideSync:data',
    auth: 'hideSync:auth',
    status: 'hideSync:status'
  };

  const DEFAULT_PROFILE = 'default';
  const GIST_FILE_NAME = 'hide-sync.json';
  const BOARD_LIMIT = 150;
  const SYNC_DEBOUNCE_MS = 5000;

  const defaultData = () => ({
    version: 1,
    profiles: {
      [DEFAULT_PROFILE]: {
        last_updated: new Date().toISOString(),
        sites: {}
      }
    }
  });

  const safeLog = (...args) => {
    if (typeof console !== 'undefined') {
      console.log('[hide-sync]', ...args);
    }
  };

  class SyncStorage {
    constructor() {
      this.data = defaultData();
      this.status = {
        syncEnabled: false,
        lastSync: null,
        lastError: null,
        gistId: null
      };
      this.auth = {
        token: null,
        gistId: null
      };
      this.syncTimeout = null;
    }

    async init() {
      const stored = await this._getFromStorage(STORAGE_KEYS.data);
      if (stored) {
        this.data = stored;
      }
      const storedStatus = await this._getFromStorage(STORAGE_KEYS.status);
      if (storedStatus) {
        this.status = storedStatus;
      }
      const storedAuth = await this._getFromStorage(STORAGE_KEYS.auth);
      if (storedAuth) {
        this.auth = storedAuth;
      }

      if (this.auth.token) {
        await this.pullRemoteState();
      } else {
        this.status.syncEnabled = false;
        this.status.lastError = null;
        await this._persistStatus();
      }
    }

    async setToken(token) {
      this.auth.token = token || null;
      await this._persistAuth();
      if (!token) {
        this.status.syncEnabled = false;
        this.status.lastError = null;
        await this._persistStatus();
      }
    }

    async getStatus() {
      return this.status;
    }

    async getSiteState(domain) {
      const profile = this._getProfile();
      if (!profile.sites[domain]) {
        profile.sites[domain] = { threads: [] };
        await this._persistData();
      }
      return profile.sites[domain];
    }

    async hideThread(domain, entry) {
      const site = await this.getSiteState(domain);
      site.threads = site.threads.filter(
        (item) => !(item.thread_id === entry.thread_id && item.board_id === entry.board_id)
      );
      site.threads.push({ thread_id: entry.thread_id, board_id: entry.board_id });
      this._enforceLimit(site, entry.board_id);
      this._updateTimestamp();
      await this._persistData();
      await this._scheduleSync();
      return site;
    }

    async unhideThread(domain, entry) {
      const site = await this.getSiteState(domain);
      site.threads = site.threads.filter(
        (item) => !(item.thread_id === entry.thread_id && item.board_id === entry.board_id)
      );
      this._updateTimestamp();
      await this._persistData();
      await this._scheduleSync();
      return site;
    }

    async validateConnection(token) {
      if (!token) {
        throw new Error('Токен не задан');
      }
      await this.setToken(token);
      const userResponse = await this._fetchGitHub('/user');
      if (!userResponse.ok) {
        const message = `PAT невалиден: ${userResponse.status}`;
        throw new Error(message);
      }

      await this._ensureGist();
      await this.pullRemoteState();
      return { gistId: this.auth.gistId };
    }

    async pullRemoteState() {
      if (!this.auth.token || !this.auth.gistId) {
        return;
      }
      try {
        const gistResponse = await this._fetchGitHub(`/gists/${this.auth.gistId}`);
        if (!gistResponse.ok) {
          throw new Error(`Не удалось загрузить Gist: ${gistResponse.status}`);
        }
        const gistData = await gistResponse.json();
        const file = gistData.files[GIST_FILE_NAME];
        if (!file || !file.content) {
          safeLog('Gist найден, но файл отсутствует — создаём файл');
          await this._pushRemoteState();
          return;
        }
        try {
          const parsed = JSON.parse(file.content);
          this.data = parsed;
          this.status.lastSync = new Date().toISOString();
          this.status.syncEnabled = true;
          this.status.lastError = null;
          this.status.gistId = this.auth.gistId;
          await this._persistData();
          await this._persistStatus();
        } catch (err) {
          this.status.lastError = 'Некорректный JSON в Gist';
          await this._persistStatus();
          safeLog('Ошибка парсинга JSON из Gist', err);
        }
      } catch (err) {
        this.status.lastError = err.message;
        await this._persistStatus();
        safeLog('Ошибка загрузки из Gist', err);
      }
    }

    async syncNow() {
      if (this.syncTimeout) {
        clearTimeout(this.syncTimeout);
        this.syncTimeout = null;
      }
      await this._pushRemoteState();
    }

    async _scheduleSync() {
      if (!this.auth.token) {
        this.status.syncEnabled = false;
        await this._persistStatus();
        return;
      }
      if (this.syncTimeout) {
        clearTimeout(this.syncTimeout);
      }
      this.syncTimeout = setTimeout(() => {
        this._pushRemoteState();
      }, SYNC_DEBOUNCE_MS);
    }

    _getProfile() {
      if (!this.data.profiles[DEFAULT_PROFILE]) {
        this.data.profiles[DEFAULT_PROFILE] = {
          last_updated: new Date().toISOString(),
          sites: {}
        };
      }
      return this.data.profiles[DEFAULT_PROFILE];
    }

    _enforceLimit(site, boardId) {
      const boardEntries = site.threads.filter((entry) => entry.board_id === boardId);
      const overflow = boardEntries.length - BOARD_LIMIT;
      if (overflow <= 0) return;
      let removed = 0;
      site.threads = site.threads.filter((entry) => {
        if (entry.board_id !== boardId) return true;
        if (removed < overflow) {
          removed += 1;
          return false;
        }
        return true;
      });
    }

    _updateTimestamp() {
      const profile = this._getProfile();
      profile.last_updated = new Date().toISOString();
    }

    async _ensureGist() {
      if (this.auth.gistId) {
        return this.auth.gistId;
      }
      const response = await this._fetchGitHub('/gists', {
        method: 'POST',
        body: JSON.stringify({
          description: 'Hide Sync storage',
          public: false,
          files: {
            [GIST_FILE_NAME]: { content: JSON.stringify(this.data, null, 2) }
          }
        })
      });
      if (!response.ok) {
        throw new Error(`Не удалось создать Gist: ${response.status}`);
      }
      const body = await response.json();
      this.auth.gistId = body.id;
      this.status.gistId = body.id;
      this.status.syncEnabled = true;
      this.status.lastError = null;
      await this._persistAuth();
      await this._persistStatus();
      return body.id;
    }

    async _pushRemoteState() {
      if (!this.auth.token) {
        return;
      }
      try {
        await this._ensureGist();
        const response = await this._fetchGitHub(`/gists/${this.auth.gistId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            files: {
              [GIST_FILE_NAME]: { content: JSON.stringify(this.data, null, 2) }
            }
          })
        });
        if (!response.ok) {
          throw new Error(`Не удалось обновить Gist: ${response.status}`);
        }
        this.status.lastSync = new Date().toISOString();
        this.status.syncEnabled = true;
        this.status.lastError = null;
        await this._persistStatus();
      } catch (err) {
        this.status.lastError = err.message;
        await this._persistStatus();
        safeLog('Ошибка синхронизации с Gist', err);
      }
    }

    async _persistData() {
      await browserApi.storage.local.set({ [STORAGE_KEYS.data]: this.data });
    }

    async _persistStatus() {
      await browserApi.storage.local.set({ [STORAGE_KEYS.status]: this.status });
    }

    async _persistAuth() {
      await browserApi.storage.local.set({ [STORAGE_KEYS.auth]: this.auth });
    }

    async _getFromStorage(key) {
      const result = await browserApi.storage.local.get(key);
      return result[key];
    }

    _fetchGitHub(path, options = {}) {
      return fetch(`https://api.github.com${path}`, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `token ${this.auth.token}`
        },
        ...options
      });
    }
  }

  self.SyncStorage = SyncStorage;
})();
