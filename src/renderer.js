const form = document.querySelector('#join-form');
const input = document.querySelector('#meeting-link');
const status = document.querySelector('#status');
const mainMeetLink = document.querySelector('#main-meet-link');
const deviceCheckButton = document.querySelector('#device-check-button');
const deviceCheckStatus = document.querySelector('#device-check-status');
const forgetMeetApprovalButton = document.querySelector('#forget-meet-approval-button');
const streamDeckStatus = document.querySelector('#streamdeck-status');
const streamDeckActions = document.querySelector('#streamdeck-actions');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const result = await window.meetBridge.openMeeting(input.value);
  status.textContent = result.message;
  status.dataset.error = result.ok ? 'false' : 'true';
});

mainMeetLink.addEventListener('click', async (event) => {
  event.preventDefault();
  const result = await window.meetBridge.openMeeting(mainMeetLink.href);
  status.textContent = result.message;
  status.dataset.error = result.ok ? 'false' : 'true';
});

async function checkInputDevice(name, kind) {
  const constraints = kind === 'camera' ? { video: true } : { audio: true };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    const devices = await navigator.mediaDevices.enumerateDevices();
    const deviceKind = kind === 'camera' ? 'videoinput' : 'audioinput';
    const inputs = devices.filter((device) => device.kind === deviceKind);
    const activeLabels = stream
      .getTracks()
      .map((track) => track.label)
      .filter(Boolean);
    const labels = activeLabels.length ? activeLabels : inputs.map((device) => device.label).filter(Boolean);
    return { ok: true, message: `${name}: ${labels.join(', ') || `${inputs.length} device(s) found`}` };
  } catch (error) {
    const reason =
      error.name === 'NotFoundError'
        ? 'no device was returned'
        : error.name === 'NotReadableError'
          ? 'device is busy or could not be opened'
          : error.name === 'NotAllowedError'
            ? 'access was denied'
            : error.message || error.name || 'unknown error';
    return { ok: false, message: `${name}: ${reason} (${error.name || 'Error'})` };
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
  }
}

deviceCheckButton.addEventListener('click', async () => {
  deviceCheckButton.disabled = true;
  deviceCheckStatus.textContent = 'Requesting access and checking devices…';
  deviceCheckStatus.dataset.error = 'false';

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Chromium does not expose media device access on this page.');
    }
    const camera = await checkInputDevice('Camera', 'camera');
    const microphone = await checkInputDevice('Microphone', 'microphone');
    deviceCheckStatus.textContent = `${camera.message}. ${microphone.message}.`;
    deviceCheckStatus.dataset.error = camera.ok && microphone.ok ? 'false' : 'true';
  } catch (error) {
    deviceCheckStatus.textContent = `Device check failed: ${error.message || error.name || 'unknown error'}`;
    deviceCheckStatus.dataset.error = 'true';
  } finally {
    deviceCheckButton.disabled = false;
  }
});

forgetMeetApprovalButton.addEventListener('click', async () => {
  forgetMeetApprovalButton.disabled = true;
  try {
    const result = await window.meetBridge.forgetMeetMediaApproval();
    deviceCheckStatus.textContent = result.message;
    deviceCheckStatus.dataset.error = result.ok ? 'false' : 'true';
  } catch (error) {
    deviceCheckStatus.textContent = `Could not change the saved approval: ${error.message || 'unknown error'}`;
    deviceCheckStatus.dataset.error = 'true';
  } finally {
    forgetMeetApprovalButton.disabled = false;
  }
});

function addStreamDeckAction(action) {
  const row = document.createElement('div');
  row.className = 'streamdeck-action';

  const label = document.createElement('label');
  label.textContent = action.label;

  const url = document.createElement('input');
  url.type = 'text';
  url.readOnly = true;
  url.value = action.url;
  url.setAttribute('aria-label', `${action.label} Stream Deck URL`);

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = 'Copy URL';
  copy.addEventListener('click', async () => {
    try {
      const result = await window.meetBridge.copyStreamDeckControlURL(action.id);
      if (!result.ok) throw new Error(result.message || 'Could not copy this URL.');
      copy.textContent = 'Copied';
      setTimeout(() => {
        copy.textContent = 'Copy URL';
      }, 1200);
    } catch (error) {
      streamDeckStatus.textContent = error.message || 'Could not copy the URL.';
      streamDeckStatus.dataset.error = 'true';
    }
  });

  row.append(label, url, copy);
  streamDeckActions.append(row);
}

async function loadStreamDeckControls() {
  try {
    const result = await window.meetBridge.getStreamDeckControls();
    streamDeckStatus.textContent = result.message;
    streamDeckStatus.dataset.error = result.ok ? 'false' : 'true';
    streamDeckActions.replaceChildren();
    for (const action of result.actions || []) addStreamDeckAction(action);
  } catch (error) {
    streamDeckStatus.textContent = `Stream Deck setup could not load: ${error.message || 'unknown error'}`;
    streamDeckStatus.dataset.error = 'true';
  }
}

loadStreamDeckControls();
