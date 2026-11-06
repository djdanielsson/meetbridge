# MeetBridge

MeetBridge is for people who want Google Meet in a dedicated Mac app instead of another browser tab. It runs Meet in its own Chromium-based window, can route meeting links from Safari and other apps into that window, and adds Stream Deck shortcuts for common meeting controls. MeetBridge does not launch Google Chrome and keeps its own browser profile and sign-in.

## Build and run

Requires macOS 12 or later, Xcode command-line tools, Node.js, and npm.

```sh
npm install
npm start
```

To package an Apple silicon DMG and ZIP with the Safari extension embedded:

```sh
npm run package:mac
```

The `.dmg` and `.zip` are written to `dist/` and target Apple silicon (`arm64`) only. Published GitHub releases attach the `.zip` so it can be downloaded directly from the release page. The person testing it does not need Node.js or npm: open the disk image, drag MeetBridge to Applications, then launch it once so macOS registers its URL handlers and Safari discovers the embedded extension. The app uses Chromium from Electron 45. This is an unsigned development build; wider distribution requires signing and notarization.

### Open an unsigned download

Because the release build is unsigned, macOS may block it as damaged or from an unidentified developer. After moving MeetBridge to Applications, remove the download quarantine attribute with:

```sh
xattr -dr com.apple.quarantine /Applications/MeetBridge.app
```

Then open MeetBridge from Applications. If you placed it elsewhere, replace `/Applications/MeetBridge.app` with the app's full path. Only do this for a copy of MeetBridge you trust.

## Code checks

Install the Git hooks once with `brew install pre-commit` and `pre-commit install`. Before the first commit, run `pre-commit run --all-files` and stage any files it formats. The hooks check JavaScript with ESLint, format supported source and configuration files with Prettier, lint Swift with SwiftLint, validate Xcode property lists and scheme XML, and check common file hygiene issues. The GitHub Actions build runs the same checks for pushes and pull requests to `main`.

## Link routing

- On the home screen, choose **go to the Google Meet homepage** to open `meet.google.com` inside MeetBridge, or paste a specific meeting link in the join field.

### Enable the bundled Safari extension

1. Move MeetBridge to Applications and open it once. Safari discovers the extension bundled inside the app after the app has been launched.
2. In Safari, open **Safari → Settings → Advanced** and enable **Show Develop menu in menu bar** (the wording may be **Show features for web developers** on newer macOS versions).
3. In the menu bar, choose **Develop → Allow Unsigned Extensions**.
4. Open **Safari → Settings → Extensions** and check **MeetBridge**. If you use Safari profiles, make sure it is enabled for the profile you browse with.
5. Grant MeetBridge website access. Allow `meet.google.com` for direct Meet links. To intercept a Meet link clicked on another site, such as Slack, also allow access to that site. Choose **Always Allow on Every Website** if you want it to catch Meet links wherever they appear; this lets the extension inspect link destinations on those pages.
6. Reload any Safari pages that were already open.

The extension only checks whether link destinations are Google Meet URLs; it does not send browsing data to a service. **Allow Unsigned Extensions** is needed for this unsigned testing build.

### Fallback: load the extension temporarily from the repository

If MeetBridge does not appear in Safari's Extensions settings or the bundled extension does not work, load the extension source directly:

1. In Safari, choose **Develop → Add Temporary Extension…**.
2. In the file picker, select the repository's `SafariExtension/` folder (the folder containing `manifest.json`), then choose **Select**.
3. Grant the extension website access as described above, then reload the page you want to test.

This is a temporary development install. Safari removes temporary extensions when you quit Safari, so repeat these steps after restarting Safari. Keep the repository folder in place while using the temporary extension.

- Clicked Google Meet links in Safari and direct visits to `meet.google.com` are forwarded to MeetBridge. This also covers a Meet link opened from Slack when Safari is the default browser; Safari closes the temporary tab after forwarding a direct Meet navigation.
- To have links from other apps open MeetBridge directly, select it as the default browser in **System Settings → Desktop & Dock**. Non-Meet links then open in MeetBridge's normal browser window.
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
