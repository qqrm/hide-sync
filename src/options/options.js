const browserApi = typeof browser !== 'undefined' ? browser : chrome;
const AUTH_KEY = 'hideSync:auth';
const STATUS_KEY = 'hideSync:status';

const tokenInput = document.getElementById('token');
const saveButton = document.getElementById('save');
const validateButton = document.getElementById('validate');
const forceSyncButton = document.getElementById('force-sync');
const messageBox = document.getElementById('message');

const syncEnabledEl = document.getElementById('sync-enabled');
const lastSyncEl = document.getElementById('last-sync');
const gistIdEl = document.getElementById('gist-id');
const lastErrorEl = document.getElementById('last-error');

function showMessage(text, type = 'success') {
  messageBox.textContent = text;
  messageBox.className = type;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

async function loadAuth() {
  const stored = await browserApi.storage.local.get(AUTH_KEY);
  if (stored[AUTH_KEY]?.token) {
    tokenInput.value = stored[AUTH_KEY].token;
  }
}

async function loadStatus() {
  const stored = await browserApi.storage.local.get(STATUS_KEY);
  const status = stored[STATUS_KEY];
  if (status) {
    renderStatus(status);
  } else {
    syncEnabledEl.textContent = 'Отключена';
  }
}

function renderStatus(status) {
  syncEnabledEl.textContent = status.syncEnabled ? 'Включена' : 'Отключена';
  lastSyncEl.textContent = formatDate(status.lastSync);
  gistIdEl.textContent = status.gistId || '—';
  lastErrorEl.textContent = status.lastError || '—';
}

async function handleSave() {
  const token = tokenInput.value.trim();
  await browserApi.runtime.sendMessage({ type: 'SET_TOKEN', token });
  renderStatus({
    syncEnabled: Boolean(token),
    lastSync: null,
    lastError: null,
    gistId: null
  });
  showMessage(token ? 'Токен сохранён. Проверьте соединение.' : 'Токен удалён. Синхронизация отключена.');
}

async function handleValidate() {
  const token = tokenInput.value.trim();
  if (!token) {
    showMessage('Введите PAT с правом gist', 'error');
    return;
  }
  toggleButtons(true);
  try {
    const response = await browserApi.runtime.sendMessage({
      type: 'VALIDATE_CONNECTION',
      token
    });
    renderStatus(response.status);
    showMessage('Соединение успешно. Gist готов к работе.');
  } catch (error) {
    console.error(error);
    showMessage(`Ошибка проверки: ${error.message}`, 'error');
  } finally {
    toggleButtons(false);
  }
}

async function handleForceSync() {
  toggleButtons(true);
  try {
    const response = await browserApi.runtime.sendMessage({ type: 'FORCE_SYNC' });
    if (response?.status) {
      renderStatus(response.status);
    }
    showMessage('Состояние отправлено в Gist.');
  } catch (error) {
    showMessage(`Не удалось синхронизировать: ${error.message}`, 'error');
  } finally {
    toggleButtons(false);
  }
}

function toggleButtons(disabled) {
  saveButton.disabled = disabled;
  validateButton.disabled = disabled;
  forceSyncButton.disabled = disabled;
}

function init() {
  loadAuth();
  loadStatus();
  saveButton.addEventListener('click', handleSave);
  validateButton.addEventListener('click', handleValidate);
  forceSyncButton.addEventListener('click', handleForceSync);
}

init();
