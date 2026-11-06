const status = document.querySelector('#status');
const openButton = document.querySelector('#open');
let currentMeetURL = null;

browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  try {
    const url = new URL(tab.url);
    if (url.protocol === 'https:' && url.hostname === 'meet.google.com') {
      currentMeetURL = url.href;
      status.textContent = 'This is a Google Meet link.';
      openButton.disabled = false;
    } else {
      status.textContent = 'Open a Meet link in this tab, or click a Meet link on a website.';
    }
  } catch {
    status.textContent = 'This tab does not contain a Google Meet link.';
  }
});

openButton.addEventListener('click', () => {
  if (!currentMeetURL) return;
  window.location.assign(`meetbridge://open?url=${encodeURIComponent(currentMeetURL)}`);
  window.close();
});
