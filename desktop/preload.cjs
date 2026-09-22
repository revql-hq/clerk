const { contextBridge, ipcRenderer } = require('electron');

const invoke = (name, value) => ipcRenderer.invoke(`clerk:${name}`, value);
contextBridge.exposeInMainWorld('clerk', {
  bootstrap: () => invoke('bootstrap'),
  connect: input => invoke('connect', input),
  disconnect: () => invoke('disconnect'),
  settings: input => invoke('settings', input),
  testNebius: () => invoke('test-nebius'),
  selectSource: () => invoke('select-source'),
  search: input => invoke('search', input),
  state: input => invoke('state', input),
  reports: input => invoke('reports', input),
  createTask: input => invoke('create-task', input),
  saveTask: input => invoke('save-task', input),
  deleteTask: id => invoke('delete-task', id),
  runTask: id => invoke('run-task', id),
  stopTask: id => invoke('stop-task', id),
  preview: input => invoke('preview', input),
  apply: id => invoke('apply', id),
  verifyOutcome: id => invoke('verify-outcome', id),
  setExpanded: expanded => invoke('set-expanded', expanded),
  onTask: callback => { const listener = (_event, task) => callback(task); ipcRenderer.on('clerk:task-update', listener); return () => ipcRenderer.removeListener('clerk:task-update', listener); }
});
