(() => {
  const meetHost = 'meet.google.com';
  const appScheme = 'meetbridge://open?url=';

  function getMeetURL(value) {
    try {
      const url = new URL(value, window.location.href);
      if (
        url.protocol !== 'https:' ||
        url.hostname !== meetHost ||
        url.username ||
        url.password ||
        (url.port && url.port !== '443')
      ) {
        return null;
      }
      return url.href;
    } catch {
      return null;
    }
  }

  function forwardToMeetBridge(value, closeSafariTab = false) {
    const meetURL = getMeetURL(value);
    if (!meetURL) return false;

    if (closeSafariTab) {
      try {
        browser.runtime.sendMessage({ type: 'meetbridge:close-forwarded-tab' }).catch(() => {});
      } catch {
        // Opening the meeting should still work if Safari cannot close this tab.
      }
    }

    window.location.replace(`${appScheme}${encodeURIComponent(meetURL)}`);
    return true;
  }

  // Slack and other apps open a Meet URL as a direct Safari navigation, so there
  // is no link click inside the page for the click handler below to intercept.
  if (window.top === window && forwardToMeetBridge(window.location.href, true)) {
    return;
  }

  function meetURLFromTarget(target) {
    const anchor = target instanceof Element ? target.closest('a[href]') : null;
    if (!anchor) return null;
    return getMeetURL(anchor.href);
  }

  document.addEventListener(
    'click',
    (event) => {
      if (event.defaultPrevented || event.button !== 0) return;

      const meetURL = meetURLFromTarget(event.target);
      if (!meetURL) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      window.location.assign(`${appScheme}${encodeURIComponent(meetURL)}`);
    },
    true,
  );
})();
