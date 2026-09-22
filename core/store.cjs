const fs = require('node:fs');
const path = require('node:path');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
}

class Store {
  constructor(root) {
    this.root = root;
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    const tasks = this.tasks();
    let changed = false;
    for (const task of tasks) {
      if (task.status === 'running' || task.status === 'applying') {
        task.status = task.status === 'applying' ? 'needs-verification' : 'interrupted';
        task.updatedAt = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) writeJson(this.file('tasks.json'), tasks);
  }
  file(name) { return path.join(this.root, name); }
  settings() { return readJson(this.file('settings.json'), { connection: null, model: '', externalInferenceBlocked: false, keepOnTop: false, compactBounds: null, expandedBounds: null }); }
  saveSettings(settings) { writeJson(this.file('settings.json'), settings); }
  tasks() { return readJson(this.file('tasks.json'), []); }
  saveTask(task) {
    const tasks = this.tasks();
    const index = tasks.findIndex(item => item.id === task.id);
    const next = { ...task, updatedAt: new Date().toISOString() };
    if (index < 0) tasks.unshift(next); else tasks[index] = next;
    writeJson(this.file('tasks.json'), tasks);
    return next;
  }
  getTask(id) { return this.tasks().find(task => task.id === id) || null; }
  deleteTask(id) { writeJson(this.file('tasks.json'), this.tasks().filter(task => task.id !== id)); }
}

module.exports = { Store, readJson, writeJson };
