const { app, BrowserWindow, clipboard, desktopCapturer, dialog, ipcMain, shell, session, systemPreferences } = require('electron');
const crypto = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const APP_SCHEME = 'meetbridge';
const MEET_HOST = 'meet.google.com';
const APP_HOME_URL = pathToFileURL(path.join(__dirname, 'index.html')).href;
const APP_HOME_MEDIA_ORIGIN = 'meetbridge://device-check';
const MEDIA_DECISIONS = new Map();
const REMEMBERED_MEET_APPROVALS = new Map();
const STREAM_DECK_PORT = 43187;
const STREAM_DECK_ACTIONS = [
  { id: 'microphone', label: 'Toggle microphone' },
  { id: 'camera', label: 'Toggle camera' },
  { id: 'hand', label: 'Raise or lower hand' },
  { id: 'reaction-thumbs-up', label: 'Send 👍 reaction' },
  { id: 'notes', label: 'Start Meet notes' },
  { id: 'leave', label: 'Leave meeting' },
  { id: 'record', label: 'Record / stop recording' }
];

let mainWindow = null;
let pendingURL = null;
let pendingStreamDeckAction = null;
let streamDeckServer = null;
let streamDeckSecret = null;
let streamDeckServerError = null;

function isMeetURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      url.hostname === MEET_HOST &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === '443');
  } catch {
    return false;
  }
}

function normalizeMeetURL(value) {
  const input = String(value || '').trim();
  const candidate = input.includes('://') ? input : `https://${input}`;
  return isMeetURL(candidate) ? new URL(candidate).href : null;
}

function isWebURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isStreamDeckControlURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' &&
      url.hostname === '127.0.0.1' &&
      url.port === String(STREAM_DECK_PORT) &&
      url.pathname.startsWith('/v1/control/');
  } catch {
    return false;
  }
}

function streamDeckActionFromURL(value) {
  if (!isStreamDeckControlURL(value)) return null;
  try {
    const url = new URL(value);
    if (!constantTimeKeyMatches(url.searchParams.get('key'))) return null;
    const actionId = /^\/v1\/control\/([a-z-]+)$/.exec(url.pathname)?.[1];
    return STREAM_DECK_ACTIONS.find((action) => action.id === actionId)?.id || null;
  } catch {
    return null;
  }
}

function dispatchStreamDeckAction(action) {
  if (!action) return;
  if (!app.isReady()) {
    pendingStreamDeckAction = action;
    return;
  }
  if (!mainWindow || mainWindow.isDestroyed() || !isMeetURL(mainWindow.webContents.getURL())) return;
  controlMeet(action).catch((error) => console.error('Could not run Stream Deck control:', error));
}

function parseAppURL(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== `${APP_SCHEME}:` || url.hostname !== 'open') return null;
    const meetingURL = url.searchParams.get('url');
    return isMeetURL(meetingURL) ? meetingURL : null;
  } catch {
    return null;
  }
}

function launchTargetFromArguments(args) {
  for (const arg of args) {
    if (isStreamDeckControlURL(arg)) {
      dispatchStreamDeckAction(streamDeckActionFromURL(arg));
      continue;
    }
    const appURL = parseAppURL(arg);
    if (appURL) return appURL;
    if (isMeetURL(arg) || isWebURL(arg)) return arg;
  }
  return null;
}

function getOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

function isMeetOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === MEET_HOST;
  } catch {
    return false;
  }
}

function isAppHome(webContents) {
  return Boolean(webContents && !webContents.isDestroyed() && webContents.getURL() === APP_HOME_URL);
}

function mediaPermissionKey(origin, mediaType) {
  return `${origin}:${mediaType}`;
}

function mediaApprovalsPath() {
  return path.join(app.getPath('userData'), 'media-approvals.json');
}

function loadRememberedMeetApprovals() {
  try {
    const saved = JSON.parse(fs.readFileSync(mediaApprovalsPath(), 'utf8'));
    if (saved.version !== 1 || !saved.meet) return;

    for (const [savedOrigin, savedTypes] of Object.entries(saved.meet)) {
      const origin = getOrigin(savedOrigin);
      if (!isMeetOrigin(origin) || !Array.isArray(savedTypes)) continue;
      const types = new Set(savedTypes.filter((type) => type === 'audio' || type === 'video'));
      if (types.size === 0) continue;

      REMEMBERED_MEET_APPROVALS.set(origin, types);
      for (const type of types) MEDIA_DECISIONS.set(mediaPermissionKey(origin, type), true);
    }
  } catch {
    // No saved approval yet, or an unreadable preferences file; the normal prompt remains available.
  }
}

function saveRememberedMeetApproval(origin, mediaTypes) {
  if (!isMeetOrigin(origin)) return false;

  const normalizedOrigin = getOrigin(origin);
  const types = REMEMBERED_MEET_APPROVALS.get(normalizedOrigin) || new Set();
  for (const type of mediaTypes) types.add(type);
  REMEMBERED_MEET_APPROVALS.set(normalizedOrigin, types);

  const saved = {
    version: 1,
    meet: Object.fromEntries([...REMEMBERED_MEET_APPROVALS].map(([meetOrigin, approvedTypes]) => [meetOrigin, [...approvedTypes]]))
  };
  const filePath = mediaApprovalsPath();
  const temporaryPath = `${filePath}.tmp`;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(temporaryPath, `${JSON.stringify(saved, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(temporaryPath, 0o600);
    fs.renameSync(temporaryPath, filePath);
    return true;
  } catch (error) {
    console.error('Could not save MeetBridge media approval:', error);
    try { fs.rmSync(temporaryPath, { force: true }); } catch {}
    return false;
  }
}

function forgetRememberedMeetApprovals() {
  for (const origin of REMEMBERED_MEET_APPROVALS.keys()) {
    MEDIA_DECISIONS.delete(mediaPermissionKey(origin, 'audio'));
    MEDIA_DECISIONS.delete(mediaPermissionKey(origin, 'video'));
  }
  REMEMBERED_MEET_APPROVALS.clear();
  try {
    fs.rmSync(mediaApprovalsPath(), { force: true });
  } catch (error) {
    console.error('Could not remove saved MeetBridge media approval:', error);
    return false;
  }
  return true;
}

function streamDeckSecretPath() {
  return path.join(app.getPath('userData'), 'stream-deck-key');
}

function loadStreamDeckSecret() {
  const secretPath = streamDeckSecretPath();
  try {
    const existing = fs.readFileSync(secretPath, 'utf8').trim();
    if (/^[a-f0-9]{64}$/.test(existing)) {
      streamDeckSecret = existing;
      return;
    }
  } catch {
    // Generate a key on first launch.
  }

  streamDeckSecret = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(secretPath), { recursive: true });
  fs.writeFileSync(secretPath, `${streamDeckSecret}\n`, { mode: 0o600 });
  fs.chmodSync(secretPath, 0o600);
}

function streamDeckControlURLs() {
  if (!streamDeckServer || !streamDeckServer.listening || !streamDeckSecret) return [];
  return STREAM_DECK_ACTIONS.map((action) => ({
    ...action,
    url: `http://127.0.0.1:${STREAM_DECK_PORT}/v1/control/${action.id}?key=${streamDeckSecret}`
  }));
}

function runMeetBridgeControl(controlName) {
    const labelOf = (element) => ((element.getAttribute('aria-label') || '') + ' ' +
      (element.getAttribute('title') || '') + ' ' +
      (element.innerText || element.textContent || ''))
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    const controls = () => Array.from(document.querySelectorAll('button, [role="button"], [role="menuitem"], [role="option"], [role="gridcell"]'))
      .filter((element) => element.getClientRects().length > 0);
    const patterns = {
      microphone: /(?:turn off|turn on|mute|unmute).{0,24}(?:microphone|mic)|(?:microphone|mic).{0,24}(?:turn off|turn on|mute|unmute)/,
      camera: /(?:turn off|turn on|stop|start).{0,24}(?:camera|video)|(?:camera|video).{0,24}(?:turn off|turn on|stop|start)/,
      hand: /(?:raise|lower)(?: your)? hand/,
      leave: /\b(?:leave|end)(?: the)? (?:call|meeting)\b/,
      notes: /take notes|start taking notes|notes with gemini|meeting notes/,
      reaction: /send a reaction|reactions?/,
      recordStart: /start recording|record meeting/,
      recordStop: /stop recording/,
      meetingTools: /meeting tools/,
      moreOptions: /more options/
    };
    const findControl = (pattern) => controls().find((element) => pattern.test(labelOf(element)));
    const waitForControl = async (pattern, timeout = 1800) => {
      const deadline = Date.now() + timeout;
      let element = findControl(pattern);
      while (!element && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        element = findControl(pattern);
      }
      return element;
    };
    const click = (element) => {
      if (!element || element.disabled || element.getAttribute('aria-disabled') === 'true') return false;
      element.click();
      return true;
    };

    if (controlName === 'reaction-thumbs-up') {
      return (async () => {
        const picker = findControl(patterns.reaction);
        if (!click(picker)) return { ok: false, message: 'Meet does not show its reactions control right now.' };
        const thumbsUp = await waitForControl(/thumbs? up|like|👍|1f44d/i);
        if (!click(thumbsUp)) return { ok: false, message: 'Meet opened reactions, but a thumbs-up option was not found.' };
        return { ok: true, message: 'Sent a thumbs-up reaction.' };
      })();
    }

    if (controlName === 'notes') {
      return (async () => {
        let notesButton = findControl(patterns.notes);
        if (!notesButton) {
          const moreButton = findControl(patterns.moreOptions);
          if (click(moreButton)) notesButton = await waitForControl(patterns.notes, 1000);
        }
        if (!click(notesButton)) {
          return { ok: false, message: 'Meet did not expose its notes control. Notes may not be available for this account or meeting.' };
        }
        return { ok: true, message: 'Meet opened its notes flow. Review and confirm it in the meeting.' };
      })();
    }

    if (controlName === 'record') {
      return (async () => {
        const stopButton = findControl(patterns.recordStop);
        if (click(stopButton)) return { ok: true, message: 'MeetBridge selected Stop recording.' };

        let startButton = findControl(patterns.recordStart);
        if (!startButton) {
          const toolsButton = findControl(patterns.meetingTools);
          if (click(toolsButton)) {
            const recordingItem = await waitForControl(/\brecording\b(?!.*meeting tools)/);
            if (click(recordingItem)) {
              const stopAfterMenu = await waitForControl(patterns.recordStop, 300);
              if (click(stopAfterMenu)) return { ok: true, message: 'MeetBridge selected Stop recording.' };
              startButton = await waitForControl(patterns.recordStart);
            }
          }
        }

        if (!startButton) {
          const moreButton = findControl(patterns.moreOptions);
          if (click(moreButton)) {
            const recordItem = await waitForControl(/record meeting|\brecording\b/);
            if (click(recordItem)) {
              const stopAfterMenu = await waitForControl(patterns.recordStop, 300);
              if (click(stopAfterMenu)) return { ok: true, message: 'MeetBridge selected Stop recording.' };
              startButton = await waitForControl(patterns.recordStart);
            }
          }
        }

        if (!click(startButton)) {
          return { ok: false, message: 'Could not find Meet’s recording control. Check that recording is available for this meeting.' };
        }
        return { ok: true, message: 'Meet opened the recording confirmation. Review and confirm it in the meeting.' };
      })();
    }

    const pattern = controlName === 'leave' ? patterns.leave : patterns[controlName];
    const element = pattern && findControl(pattern);
    if (!click(element)) {
      const label = controlName === 'notes' ? 'Meet notes control' : controlName + ' control';
      return { ok: false, message: 'Could not find the ' + label + '.' };
    }
    return { ok: true, message: 'MeetBridge sent the ' + controlName + ' action.' };
}

async function controlMeet(action) {
  if (!mainWindow || mainWindow.isDestroyed() || !isMeetURL(mainWindow.webContents.getURL())) {
    return { ok: false, message: 'Open a Google Meet in MeetBridge first.' };
  }

  if (action === 'hand') {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.focus();
    const keyEvent = { keyCode: 'H', modifiers: ['control', 'meta'] };
    try {
      mainWindow.webContents.sendInputEvent({ ...keyEvent, type: 'keyDown' });
      await new Promise((resolve) => setTimeout(resolve, 40));
      mainWindow.webContents.sendInputEvent({ ...keyEvent, type: 'keyUp' });
      return { ok: true, message: 'Sent Meet’s raise/lower hand shortcut.' };
    } catch (error) {
      console.error('Could not send the Google Meet hand shortcut:', error);
      const result = { ok: false, message: 'MeetBridge could not send the hand shortcut.' };
      await showMeetControlFeedback(result.message);
      return result;
    }
  }

  if (action === 'record') {
    mainWindow.show();
    mainWindow.focus();
  }

  const code = `(${runMeetBridgeControl.toString()})(${JSON.stringify(action)})`;

  try {
    const result = await mainWindow.webContents.executeJavaScript(code, true);
    if (!result?.ok) await showMeetControlFeedback(result?.message || 'MeetBridge could not find that control.');
    return result;
  } catch (error) {
    console.error('Could not send Stream Deck control to Google Meet:', error);
    const result = { ok: false, message: 'MeetBridge could not reach the meeting controls.' };
    await showMeetControlFeedback(result.message);
    return result;
  }
}

async function showMeetControlFeedback(message) {
  if (!mainWindow || mainWindow.isDestroyed() || !isMeetURL(mainWindow.webContents.getURL())) return;
  const code = `(() => {
    const id = 'meetbridge-streamdeck-feedback';
    let toast = document.getElementById(id);
    if (!toast) {
      toast = document.createElement('div');
      toast.id = id;
      Object.assign(toast.style, {
        position: 'fixed',
        top: '16px',
        right: '16px',
        zIndex: '2147483647',
        maxWidth: '360px',
        padding: '12px 16px',
        borderRadius: '10px',
        background: '#202124',
        color: '#fff',
        boxShadow: '0 4px 18px rgba(0,0,0,.35)',
        font: '14px -apple-system, BlinkMacSystemFont, sans-serif'
      });
      document.documentElement.appendChild(toast);
    }
    toast.textContent = ${JSON.stringify('MeetBridge: ' + message)};
    clearTimeout(window.__meetBridgeStreamDeckFeedbackTimer);
    window.__meetBridgeStreamDeckFeedbackTimer = setTimeout(() => toast.remove(), 5500);
  })()`;
  try {
    await mainWindow.webContents.executeJavaScript(code, true);
  } catch (error) {
    console.error('Could not show Meet control feedback:', error);
  }
}

function constantTimeKeyMatches(candidate) {
  if (typeof candidate !== 'string' || !streamDeckSecret) return false;
  const expectedBuffer = Buffer.from(streamDeckSecret, 'utf8');
  const candidateBuffer = Buffer.from(candidate, 'utf8');
  return expectedBuffer.length === candidateBuffer.length && crypto.timingSafeEqual(expectedBuffer, candidateBuffer);
}

function respondToStreamDeck(response, status, body) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(JSON.stringify(body));
}

async function handleStreamDeckRequest(request, response) {
  const host = request.headers.host || '';
  if (host !== `127.0.0.1:${STREAM_DECK_PORT}`) return respondToStreamDeck(response, 403, { ok: false });
  if (request.method !== 'GET') return respondToStreamDeck(response, 405, { ok: false, message: 'GET only.' });

  let requestURL;
  try {
    requestURL = new URL(request.url, `http://127.0.0.1:${STREAM_DECK_PORT}`);
  } catch {
    return respondToStreamDeck(response, 400, { ok: false });
  }
  if (!constantTimeKeyMatches(requestURL.searchParams.get('key'))) {
    return respondToStreamDeck(response, 403, { ok: false });
  }

  const match = /^\/v1\/control\/([a-z-]+)$/.exec(requestURL.pathname);
  const action = STREAM_DECK_ACTIONS.find((entry) => entry.id === match?.[1]);
  if (!action) return respondToStreamDeck(response, 404, { ok: false, message: 'Unknown control.' });

  const result = await controlMeet(action.id);
  respondToStreamDeck(response, result.ok ? 200 : 409, result);
}

function startStreamDeckServer() {
  loadStreamDeckSecret();
  return new Promise((resolve) => {
    streamDeckServer = http.createServer((request, response) => {
      handleStreamDeckRequest(request, response).catch((error) => {
        console.error('Stream Deck request failed:', error);
        if (!response.headersSent) respondToStreamDeck(response, 500, { ok: false, message: 'MeetBridge could not run this control.' });
        else response.destroy();
      });
    });

    streamDeckServer.on('listening', () => {
      streamDeckServerError = null;
      resolve(true);
    });
    streamDeckServer.on('error', (error) => {
      streamDeckServerError = error;
      console.error('MeetBridge Stream Deck server could not start:', error);
      resolve(false);
    });
    streamDeckServer.listen(STREAM_DECK_PORT, '127.0.0.1');
  });
}

function requestedMediaTypes(details) {
  const mediaTypes = [...new Set((details?.mediaTypes || []).filter((type) => type === 'audio' || type === 'video'))];
  if (mediaTypes.length > 0) return mediaTypes;
  if (details?.mediaType === 'audio' || details?.mediaType === 'video') return [details.mediaType];
  return ['audio', 'video'];
}

async function requestMacOSMediaAccess(mediaTypes) {
  if (process.platform !== 'darwin') return true;

  for (const mediaType of mediaTypes) {
    const macOSMediaType = mediaType === 'audio' ? 'microphone' : 'camera';
    try {
      if (systemPreferences.getMediaAccessStatus(macOSMediaType) === 'granted') continue;
      if (!await systemPreferences.askForMediaAccess(macOSMediaType)) return false;
    } catch {
      return false;
    }
  }

  return true;
}

function configurePermissions() {
  const meetSession = session.defaultSession;

  meetSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    const requestingOriginURL = getOrigin(requestingOrigin);
    const embeddingOrigin = getOrigin(details?.embeddingOrigin || '');
    const topLevelOrigin = getOrigin(webContents?.getURL?.() || '');
    const meetOrigin = [requestingOriginURL, embeddingOrigin, topLevelOrigin].find(isMeetOrigin);
    const isDeviceCheck = isAppHome(webContents);
    if (!meetOrigin && !isDeviceCheck) return false;
    if (permission === 'media') {
      const origin = meetOrigin || APP_HOME_MEDIA_ORIGIN;
      const mediaType = details?.mediaType === 'audio' || details?.mediaType === 'video'
        ? details.mediaType
        : null;
      if (mediaType) return MEDIA_DECISIONS.get(mediaPermissionKey(origin, mediaType)) === true;
      return ['audio', 'video'].every((type) => MEDIA_DECISIONS.get(mediaPermissionKey(origin, type)) === true);
    }
    if (permission === 'display-capture') return Boolean(meetOrigin);
    return false;
  });

  meetSession.setPermissionRequestHandler(async (webContents, permission, callback, details) => {
    const requestingURL = details?.securityOrigin || details?.requestingUrl || webContents.getURL();
    const origin = getOrigin(requestingURL);
    const topLevelOrigin = getOrigin(webContents.getURL());
    const meetOrigin = isMeetOrigin(origin) ? origin : isMeetOrigin(topLevelOrigin) ? topLevelOrigin : null;
    const isDeviceCheck = isAppHome(webContents);
    if (!meetOrigin && !isDeviceCheck) return callback(false);

    if (permission === 'display-capture') return callback(Boolean(meetOrigin));
    if (permission !== 'media') return callback(false);

    const decisionOrigin = meetOrigin || APP_HOME_MEDIA_ORIGIN;
    const mediaTypes = requestedMediaTypes(details);
    const pendingTypes = mediaTypes.filter((type) => MEDIA_DECISIONS.get(mediaPermissionKey(decisionOrigin, type)) !== true);

    const requested = [
      pendingTypes.includes('audio') ? 'microphone' : null,
      pendingTypes.includes('video') ? 'camera' : null
    ].filter(Boolean).join(' and ') || 'camera or microphone';

    if (pendingTypes.length > 0) {
      let userAllowed = false;
      try {
        const prompt = {
          type: 'question',
          title: 'Allow MeetBridge to use your devices?',
          message: `${meetOrigin ? 'Google Meet' : 'The MeetBridge device check'} is requesting access to your ${requested}.`,
          detail: meetOrigin
            ? 'After macOS grants access, MeetBridge will remember this approval for Google Meet on this Mac. You can clear it from the home screen.'
            : 'macOS may also ask you to allow access in System Settings.',
          buttons: ['Allow', 'Don’t Allow'],
          defaultId: 1,
          cancelId: 1
        };
        const result = mainWindow
          ? await dialog.showMessageBox(mainWindow, prompt)
          : await dialog.showMessageBox(prompt);
        userAllowed = result.response === 0;
      } catch {
        userAllowed = false;
      }
      if (!userAllowed) return callback(false);
    }

    const systemAllowed = await requestMacOSMediaAccess(mediaTypes);
    if (!systemAllowed) {
      const options = {
        type: 'warning',
        title: 'Camera or microphone access is off',
        message: `macOS has not granted MeetBridge access to your ${requested}.`,
        detail: 'Open System Settings > Privacy & Security, allow MeetBridge under Camera and Microphone, then quit and reopen MeetBridge.',
        buttons: ['OK'],
        defaultId: 0
      };
      if (mainWindow) await dialog.showMessageBox(mainWindow, options);
      else await dialog.showMessageBox(options);
      return callback(false);
    }

    for (const type of mediaTypes) MEDIA_DECISIONS.set(mediaPermissionKey(decisionOrigin, type), true);
    if (meetOrigin && pendingTypes.length > 0 && !saveRememberedMeetApproval(decisionOrigin, pendingTypes)) {
      const options = {
        type: 'warning',
        title: 'Approval could not be saved',
        message: 'MeetBridge can use your devices for this session, but could not remember the approval for next time.',
        buttons: ['OK'],
        defaultId: 0
      };
      if (mainWindow) await dialog.showMessageBox(mainWindow, options);
      else await dialog.showMessageBox(options);
    }
    callback(true);
  });

  meetSession.setDisplayMediaRequestHandler((request, callback) => {
    if (!isMeetOrigin(request.frame?.url || request.securityOrigin || '')) {
      callback(null);
      return;
    }

    desktopCapturer.getSources({ types: ['screen', 'window'] }).then(async (sources) => {
      if (sources.length === 0) return callback(null);
      const choices = sources.map((source) => source.name).concat('Cancel');
      const picked = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        title: 'Choose what to share',
        message: 'Select a screen or window to share with Google Meet.',
        buttons: choices,
        cancelId: choices.length - 1,
        defaultId: 0,
        noLink: true
      });
      const source = sources[picked.response];
      callback(source ? { video: source } : null);
    }).catch(() => callback(null));
  }, { useSystemPicker: true });
}

function createWindow(targetURL = null) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    if (targetURL) mainWindow.loadURL(targetURL);
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 900,
    minHeight: 650,
    title: 'MeetBridge',
    backgroundColor: '#f4f7fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isStreamDeckControlURL(url)) return { action: 'deny' };
    if (isWebURL(url) && (isMeetURL(url) || isGoogleAuthURL(url))) return { action: 'allow' };
    if (isWebURL(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file:') || url.startsWith('devtools:')) return;
    if (isStreamDeckControlURL(url)) {
      event.preventDefault();
      return;
    }
    if (!isWebURL(url)) event.preventDefault();
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  if (targetURL) mainWindow.loadURL(targetURL);
  else mainWindow.loadFile(path.join(__dirname, 'index.html'));

  return mainWindow;
}

function isGoogleAuthURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (
      url.hostname === 'accounts.google.com' ||
      url.hostname === 'consent.google.com'
    );
  } catch {
    return false;
  }
}

ipcMain.handle('open-meeting', (event, value) => {
  if (!event.senderFrame.url.startsWith('file:')) {
    return { ok: false, message: 'Only the MeetBridge home screen can open a link.' };
  }
  const targetURL = normalizeMeetURL(value);
  if (!targetURL) {
    return { ok: false, message: 'Enter an https://meet.google.com meeting link.' };
  }
  createWindow(targetURL);
  return { ok: true, message: 'Opening the meeting in MeetBridge…' };
});

ipcMain.handle('forget-meet-media-approval', (event) => {
  if (!isAppHome(event.sender)) return { ok: false, message: 'Open the MeetBridge home screen to change saved approvals.' };
  if (!forgetRememberedMeetApprovals()) {
    return { ok: false, message: 'MeetBridge could not clear the saved approval.' };
  }
  return { ok: true, message: 'Saved Google Meet approval cleared. MeetBridge will ask again next time; macOS access remains enabled.' };
});

ipcMain.handle('get-stream-deck-controls', (event) => {
  if (!isAppHome(event.sender)) return { ok: false, message: 'Open the MeetBridge home screen to view Stream Deck setup.' };
  if (!streamDeckServer || !streamDeckServer.listening) {
    return {
      ok: false,
      message: streamDeckServerError?.code === 'EADDRINUSE'
        ? 'MeetBridge could not start Stream Deck controls because its local port is already in use.'
        : 'MeetBridge could not start its local Stream Deck controls.',
      actions: []
    };
  }
  return { ok: true, message: 'Local controls are ready while MeetBridge is open.', actions: streamDeckControlURLs() };
});

ipcMain.handle('copy-stream-deck-control-url', (event, actionId) => {
  if (!isAppHome(event.sender)) return { ok: false, message: 'Open the MeetBridge home screen to copy a Stream Deck URL.' };
  const matchingURL = streamDeckControlURLs().find((action) => action.id === actionId)?.url;
  if (!matchingURL) return { ok: false, message: 'That Stream Deck action is unavailable.' };
  clipboard.writeText(matchingURL);
  return { ok: true };
});

function handleOpenURL(value) {
  if (isStreamDeckControlURL(value)) {
    dispatchStreamDeckAction(streamDeckActionFromURL(value));
    return;
  }

  const appURL = parseAppURL(value);
  if (appURL) {
    if (app.isReady()) createWindow(appURL);
    else pendingURL = appURL;
    return;
  }

  if (isMeetURL(value)) {
    if (app.isReady()) createWindow(value);
    else pendingURL = value;
    return;
  }

  if (isWebURL(value)) {
    if (app.isReady()) createWindow(value);
    else pendingURL = value;
  }
}

// macOS delivers URL events during launch, so register before app.whenReady().
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleOpenURL(url);
});

if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient(APP_SCHEME, process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient(APP_SCHEME);
}

const hasSingleInstance = app.requestSingleInstanceLock();
if (!hasSingleInstance) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const targetURL = launchTargetFromArguments(argv);
    if (targetURL) createWindow(targetURL);
    else if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    loadRememberedMeetApprovals();
    configurePermissions();
    await startStreamDeckServer();
    const targetURL = pendingURL || launchTargetFromArguments(process.argv);
    createWindow(targetURL);
    if (pendingStreamDeckAction) {
      const action = pendingStreamDeckAction;
      pendingStreamDeckAction = null;
      setTimeout(() => dispatchStreamDeckAction(action), 1000);
    }
  });

  app.on('before-quit', () => {
    if (streamDeckServer?.listening) streamDeckServer.close();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
