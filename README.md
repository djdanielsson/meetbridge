# MeetBridge

MeetBridge is a macOS app built with Electron. Google Meet runs inside the Chromium browser bundled with MeetBridge; the app does not launch Google Chrome. MeetBridge keeps its own browser profile and sign-in.

## Build and run

Requires macOS 12 or later, Xcode command-line tools, Node.js, and npm.

```sh
npm install
npm start
```

To package a local macOS installer image with the Safari extension embedded:

```sh
npm run package:mac
```

The `.dmg` is written to `dist/`. The person testing it does not need Node.js or npm: open the disk image, drag MeetBridge to Applications, then launch it once so macOS registers its URL handlers and Safari discovers the embedded extension. The app uses Chromium from Electron 45. This is an unsigned development build; wider distribution requires signing and notarization.

## Link routing

- On the home screen, choose **go to the Google Meet homepage** to open `meet.google.com` inside MeetBridge, or paste a specific meeting link in the join field.
- In Safari, enable the Develop menu and choose **Develop → Allow Unsigned Extensions** for this local development build. Then enable **MeetBridge** under **Safari → Settings → Extensions**. Safari asks for website access so the extension can find Meet links on pages you visit. It inspects link destinations and does not send browsing data to a service.
- Clicked Google Meet links in Safari open in MeetBridge. On a Meet page entered directly in Safari, use the extension button and choose **Open in MeetBridge**.
- Links from other apps can be routed through MeetBridge by selecting it as the default browser in **System Settings → Desktop & Dock**. Non-Meet links then open in MeetBridge's normal browser window.
- The app validates custom-scheme links and only opens `https://meet.google.com` in the meeting window.

## Camera, microphone, and screen sharing

MeetBridge asks before granting Google Meet access to camera or microphone, then remembers that approval on this Mac. Use **Forget saved Meet approval** on the home screen to make MeetBridge ask again; this clears MeetBridge's approval while leaving macOS's separate privacy setting unchanged. The home screen's **Check devices** button verifies macOS authorization and whether Chromium can open each input. If macOS access was previously denied, enable MeetBridge under **System Settings → Privacy & Security → Camera** and **Microphone**, then quit and reopen the app. The app uses macOS's screen picker when available; otherwise it asks you to select a screen or window.

## Stream Deck controls

MeetBridge exposes a small authenticated control service on `127.0.0.1` while the app is running. On the home screen, copy the URL beside each action. In Stream Deck, add **System → Website**, paste the URL, and enable **GET request in background**. The controls target the Google Meet open inside MeetBridge, even when its window is not focused.

Available actions are microphone, camera, hand raise/lower, thumbs-up reaction, Meet notes, leaving the meeting, and recording (the final action). Recording brings MeetBridge forward and opens Meet's recording flow; review and confirm the recording in Meet. Google controls recording eligibility and participant notifications. Notes and recording depend on your account and meeting permissions. The app stores the random control key in its private application data folder, so keep the copied URLs private. Google may change its page labels, which can require updating the control matchers.

## Sign-in limitation

MeetBridge has a separate Chromium profile from Google Chrome, so it cannot reuse Chrome's saved Google session. Google policy prohibits sending OAuth authorization requests through an app-controlled embedded user agent, and a fresh Google sign-in may be blocked in an embedded browser. [Google's OAuth policy](https://developers.google.com/identity/protocols/oauth2/policies) describes this restriction. Sign-in and a full Meet call still need to be confirmed against the actual Google account flows before claiming Chrome parity.

## Project layout

- `src/` contains the Electron main process, preload bridge, and app start page.
- `SafariExtension/` contains the Safari Web Extension resources.
- `MeetBridge.xcodeproj/` builds the `.appex` embedded into the Electron app. Its small `SafariExtensionBuildHost` target is only an Xcode packaging host and is not distributed.
- `scripts/embed-safari-extension.cjs` copies the built extension into the macOS app before packaging/signing.
