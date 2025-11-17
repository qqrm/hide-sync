const browserApi = typeof browser !== 'undefined' ? browser : chrome;
const domain = window.location.hostname;
let siteState = { threads: [] };

const buttonClass = 'hide-sync-control';
const hiddenClass = 'hide-sync-hidden';
const placeholderClass = 'hide-sync-placeholder';

function keyFromEntry(entry) {
  return `${entry.board_id}:${entry.thread_id}`;
}

function isHidden(entry) {
  return siteState.threads.some(
    (item) => item.thread_id === entry.thread_id && item.board_id === entry.board_id
  );
}

function injectStyles() {
  if (document.getElementById('hide-sync-style')) return;
  const style = document.createElement('style');
  style.id = 'hide-sync-style';
  style.textContent = `
    .${buttonClass} {
      font-size: 12px;
      padding: 4px 6px;
      margin: 4px;
      background: #f5f5f5;
      border: 1px solid #ccc;
      border-radius: 4px;
      cursor: pointer;
    }
    .${buttonClass}:hover {
      background: #e5e5e5;
    }
    .${hiddenClass} {
      display: none !important;
    }
    .${placeholderClass} {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 12px;
      margin: 4px 0;
      border: 1px dashed #999;
      background: #fafafa;
      color: #555;
      font-size: 13px;
    }
  `;
  document.head.appendChild(style);
}

function getThreadEntryFromElement(element) {
  const threadId = element.dataset.threadId;
  const boardId = element.dataset.boardId || 'unknown';
  if (!threadId) return null;
  return {
    thread_id: threadId,
    board_id: boardId
  };
}

function ensureControls(element, entry) {
  if (element.querySelector(`.${buttonClass}`)) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = buttonClass;
  button.textContent = isHidden(entry) ? 'Показать тред' : 'Скрыть тред';
  button.addEventListener('click', () => toggleThread(entry));
  element.insertBefore(button, element.firstChild);
}

function ensurePlaceholder(element, entry) {
  const key = keyFromEntry(entry);
  if (element.dataset.hideSyncPlaceholderId === key) return;
  const placeholder = document.createElement('div');
  placeholder.className = placeholderClass;
  placeholder.textContent = `Тред ${entry.board_id}/${entry.thread_id} скрыт.`;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = buttonClass;
  btn.textContent = 'Показать';
  btn.addEventListener('click', () => toggleThread(entry, true));
  placeholder.appendChild(btn);
  element.insertAdjacentElement('beforebegin', placeholder);
  element.dataset.hideSyncPlaceholderId = key;
}

function removePlaceholder(element) {
  const placeholderId = element.dataset.hideSyncPlaceholderId;
  if (!placeholderId) return;
  const placeholder = element.previousElementSibling;
  if (placeholder && placeholder.classList.contains(placeholderClass)) {
    placeholder.remove();
  }
  delete element.dataset.hideSyncPlaceholderId;
}

function applyHiddenState(element, entry) {
  element.classList.add(hiddenClass);
  ensurePlaceholder(element, entry);
}

function applyVisibleState(element) {
  element.classList.remove(hiddenClass);
  removePlaceholder(element);
}

async function toggleThread(entry, forceShow = false) {
  const currentlyHidden = isHidden(entry);
  const shouldShow = forceShow || currentlyHidden;
  const action = shouldShow ? 'UNHIDE_THREAD' : 'HIDE_THREAD';
  try {
    const response = await browserApi.runtime.sendMessage({
      type: action,
      domain,
      entry
    });
    if (response?.site) {
      siteState = response.site;
      render();
    }
  } catch (error) {
    console.error('hide-sync: ошибка при отправке команды', error);
  }
}

function render() {
  const threads = document.querySelectorAll('[data-thread-id][data-board-id]');
  threads.forEach((element) => {
    const entry = getThreadEntryFromElement(element);
    if (!entry) return;
    ensureControls(element, entry);
    if (isHidden(entry)) {
      applyHiddenState(element, entry);
      const button = element.querySelector(`.${buttonClass}`);
      if (button) button.textContent = 'Показать тред';
    } else {
      applyVisibleState(element);
      const button = element.querySelector(`.${buttonClass}`);
      if (button) button.textContent = 'Скрыть тред';
    }
  });
}

async function bootstrap() {
  injectStyles();
  try {
    const response = await browserApi.runtime.sendMessage({
      type: 'GET_STATE',
      domain
    });
    if (response?.site) {
      siteState = response.site;
    }
  } catch (error) {
    console.error('hide-sync: не удалось загрузить состояние', error);
  }
  render();
  observeDom();
}

function observeDom() {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.matches && node.matches('[data-thread-id][data-board-id]')) {
          const entry = getThreadEntryFromElement(node);
          if (entry) {
            ensureControls(node, entry);
            if (isHidden(entry)) {
              applyHiddenState(node, entry);
            }
          }
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

browserApi.runtime.onMessage.addListener((message) => {
  if (message.type === 'STATE_UPDATED' && message.domain === domain) {
    siteState = message.site;
    render();
  }
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
