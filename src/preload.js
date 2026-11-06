const { contextBridge, ipcRenderer } = require('electron');

if (window.location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('meetBridge', {
    openMeeting: (value) => ipcRenderer.invoke('open-meeting', value),
    forgetMeetMediaApproval: () => ipcRenderer.invoke('forget-meet-media-approval'),
    getStreamDeckControls: () => ipcRenderer.invoke('get-stream-deck-controls'),
    copyStreamDeckControlURL: (actionId) => ipcRenderer.invoke('copy-stream-deck-control-url', actionId)
  });
}
