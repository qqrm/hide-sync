importScripts('syncStorage.js');

const browserApi = typeof browser !== 'undefined' ? browser : chrome;
const syncStorage = new self.SyncStorage();

// Первичная инициализация для сервис-воркера, который может подниматься без событий.
let initPromise = syncStorage.init();

function ensureInit() {
  return initPromise;
}

const DOMAIN_MATCH = '*://*.2ch.su/*';

async function broadcastState(domain) {
  const site = await syncStorage.getSiteState(domain);
  const tabs = await browserApi.tabs.query({ url: DOMAIN_MATCH });
  for (const tab of tabs) {
    if (tab.id) {
      browserApi.tabs.sendMessage(tab.id, {
        type: 'STATE_UPDATED',
        domain,
        site
      }).catch(() => {});
    }
  }
}

browserApi.runtime.onInstalled.addListener(() => {
  initPromise = syncStorage.init();
});

browserApi.runtime.onStartup.addListener(() => {
  initPromise = syncStorage.init();
});

browserApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = async () => {
    await ensureInit();
    const domain = message.domain;
    switch (message.type) {
      case 'GET_STATE': {
        const site = await syncStorage.getSiteState(domain);
        const status = await syncStorage.getStatus();
        return { site, status };
      }
      case 'HIDE_THREAD': {
        const site = await syncStorage.hideThread(domain, message.entry);
        await broadcastState(domain);
        return { site };
      }
      case 'UNHIDE_THREAD': {
        const site = await syncStorage.unhideThread(domain, message.entry);
        await broadcastState(domain);
        return { site };
      }
      case 'SET_TOKEN': {
        await syncStorage.setToken(message.token);
        return { status: await syncStorage.getStatus() };
      }
      case 'VALIDATE_CONNECTION': {
        const result = await syncStorage.validateConnection(message.token);
        await broadcastState('2ch.su');
        return { result, status: await syncStorage.getStatus() };
      }
      case 'FORCE_SYNC': {
        await syncStorage.syncNow();
        return { status: await syncStorage.getStatus() };
      }
      case 'GET_STATUS': {
        return { status: await syncStorage.getStatus() };
      }
      default:
        return { error: 'unknown_action' };
    }
  };

  handler()
    .then((result) => sendResponse(result))
    .catch((error) => sendResponse({ error: error.message }));
  return true;
});
