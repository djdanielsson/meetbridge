const TAB_CLOSE_DELAY_MS = 1200;

browser.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'meetbridge:close-forwarded-tab') return;

  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId)) return;

  setTimeout(() => {
    browser.tabs.remove(tabId).catch(() => {});
  }, TAB_CLOSE_DELAY_MS);
});
