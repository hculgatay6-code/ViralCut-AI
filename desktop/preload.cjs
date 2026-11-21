const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('viralCutDesktop', {
  saveClip: (id, filename, language) => ipcRenderer.invoke('viralcut:save-clip', id, filename, language),
  chooseModel: language => ipcRenderer.invoke('viralcut:choose-model', language),
  registerSource: file => {
    const path = webUtils.getPathForFile(file)
    return path ? ipcRenderer.invoke('viralcut:source-file', path) : Promise.resolve({ error: 'badSource' })
  },
  diagnostics: () => ipcRenderer.invoke('viralcut:diagnostics-read'),
  exportDiagnostics: language => ipcRenderer.invoke('viralcut:diagnostics-export', language),
  beta: {
    read: () => ipcRenderer.invoke('viralcut:beta-settings-read'),
    save: settings => ipcRenderer.invoke('viralcut:beta-settings-save', settings),
    check: () => ipcRenderer.invoke('viralcut:beta-update-check'),
    open: target => ipcRenderer.invoke('viralcut:beta-github-open', target),
  },
  creator: {
    profiles: () => ipcRenderer.invoke('viralcut:creator-profiles'),
    start: request => ipcRenderer.invoke('viralcut:creator-start', request),
    status: () => ipcRenderer.invoke('viralcut:creator-status'),
    cancel: () => ipcRenderer.invoke('viralcut:creator-cancel'),
    reveal: () => ipcRenderer.invoke('viralcut:creator-reveal'),
    calendar: () => ipcRenderer.invoke('viralcut:creator-calendar-list'),
    save: row => ipcRenderer.invoke('viralcut:creator-calendar-save', row),
    youtube: {
      account: () => ipcRenderer.invoke('viralcut:creator-youtube-account'),
      connect: () => ipcRenderer.invoke('viralcut:creator-youtube-connect'),
      disconnect: () => ipcRenderer.invoke('viralcut:creator-youtube-disconnect'),
      start: data => ipcRenderer.invoke('viralcut:creator-youtube-start', data),
      status: () => ipcRenderer.invoke('viralcut:creator-youtube-status'),
      cancel: () => ipcRenderer.invoke('viralcut:creator-youtube-cancel'),
    },
  },
  microphone: allow => ipcRenderer.invoke('viralcut:copilot-microphone', allow),
  performance: {
    read: () => ipcRenderer.invoke('viralcut:performance-read'),
    profile: value => ipcRenderer.invoke('viralcut:performance-profile', value),
    clear: () => ipcRenderer.invoke('viralcut:performance-clear'),
    clearPreviews: () => ipcRenderer.invoke('viralcut:performance-clear-previews'),
  },
  studio: {
    templates: () => ipcRenderer.invoke('viralcut:studio-templates'),
    saveTemplate: item => ipcRenderer.invoke('viralcut:studio-template-save', item),
    saveCover: image => ipcRenderer.invoke('viralcut:studio-cover-save', image),
  },
  shorts: {
    chooseSource: language => ipcRenderer.invoke('viralcut:shorts-source', language),
    start: request => ipcRenderer.invoke('viralcut:shorts-batch', request),
    status: () => ipcRenderer.invoke('viralcut:shorts-status'),
    cancel: () => ipcRenderer.invoke('viralcut:shorts-cancel'),
  },
  director: {
    music: language => ipcRenderer.invoke('viralcut:director-music', language),
    folder: language => ipcRenderer.invoke('viralcut:director-folder', language),
    start: request => ipcRenderer.invoke('viralcut:director-start', request),
    reveal: file => ipcRenderer.invoke('viralcut:director-reveal', file),
    project: index => ipcRenderer.invoke('viralcut:director-project', index),
    status: () => ipcRenderer.invoke('viralcut:director-status'),
    cancel: () => ipcRenderer.invoke('viralcut:director-cancel'),
  },
  effectsLibrary: {
    read: () => ipcRenderer.invoke('viralcut:effects-library-read'),
    save: value => ipcRenderer.invoke('viralcut:effects-library-save', value),
  },
  projects: {
    workspace: () => ipcRenderer.invoke('viralcut:workspace-read'),
    saveLayout: layout => ipcRenderer.invoke('viralcut:workspace-save', layout),
    recent: id => ipcRenderer.invoke('viralcut:project-recent', id),
    confirmReplace: language => ipcRenderer.invoke('viralcut:project-replace-confirm', language),
    onClose: callback => {
      const listener = () => callback()
      ipcRenderer.on('viralcut:flush-recovery', listener)
      return () => ipcRenderer.removeListener('viralcut:flush-recovery', listener)
    },
    confirmClose: () => ipcRenderer.invoke('viralcut:close-confirmed'),
    addAudio: () => ipcRenderer.invoke('viralcut:layer-audio-add'),
    addMedia: () => ipcRenderer.invoke('viralcut:media-add'),
    relink: id => ipcRenderer.invoke('viralcut:media-relink', id),
    open: () => ipcRenderer.invoke('viralcut:project-open'),
    save: state => ipcRenderer.invoke('viralcut:project-save', state),
    autosave: state => ipcRenderer.invoke('viralcut:project-autosave', state),
    hasRecovery: () => ipcRenderer.invoke('viralcut:project-has-recovery'),
    recover: () => ipcRenderer.invoke('viralcut:project-recover'),
    prepare: (id, type, height, device) => ipcRenderer.invoke('viralcut:preview-start', { id, type, height, device }),
    previewStatus: (id, type, height) => ipcRenderer.invoke('viralcut:preview-status', { id, type, height }),
    cancelPreview: (id, type, height) => ipcRenderer.invoke('viralcut:preview-cancel', { id, type, height }),
  },
})
