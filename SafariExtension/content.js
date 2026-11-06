(() => {
  const meetHost = "meet.google.com";
  const appScheme = "meetbridge://open?url=";

  function meetURLFrom(target) {
    const anchor = target instanceof Element ? target.closest("a[href]") : null;
    if (!anchor) return null;

    try {
      const url = new URL(anchor.href, window.location.href);
      if (url.protocol !== "https:" || url.hostname !== meetHost) return null;
      return url.href;
    } catch {
      return null;
    }
  }

  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0) return;

    const meetURL = meetURLFrom(event.target);
    if (!meetURL) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    window.location.assign(`${appScheme}${encodeURIComponent(meetURL)}`);
  }, true);
})();
