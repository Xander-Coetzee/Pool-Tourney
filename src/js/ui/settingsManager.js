import { StorageService } from '../storage.js';
import { CloudDb } from '../cloudDb.js';

export const SettingsManager = {
  init(containerId, onSettingsChangedCallback) {
    this.container = document.getElementById(containerId);
    this.onSettingsChanged = onSettingsChangedCallback;
    this.render();
    this.bindEvents();
  },

  render() {
    const settings = StorageService.getSettings();
    const isFirebase = settings.mode === 'firebase';
    const config = settings.firebaseConfig || {
      apiKey: '',
      authDomain: '',
      databaseURL: '',
      projectId: '',
      appId: ''
    };

    this.container.innerHTML = `
      <div class="settings-card glass-card">
        <h2>Tournament Settings</h2>
        <p class="description">Choose where to store tournament data. Local mode stores data offline in this browser. Party Sync Mode lets everyone see brackets live on their phone!</p>
        
        <div class="mode-selector">
          <button id="btn-mode-local" class="btn btn-secondary ${!isFirebase ? 'active' : ''}">Local Mode (Offline)</button>
          <button id="btn-mode-sync" class="btn btn-secondary ${isFirebase ? 'active' : ''}">Party Sync Mode (Firebase)</button>
        </div>

        <div id="firebase-config-panel" class="config-panel ${isFirebase ? '' : 'hidden'}">
          <h3>Firebase Configuration</h3>
          <p class="panel-desc">Paste your Firebase web config credentials below (Realtime Database recommended):</p>
          
          <div class="form-group">
            <label for="cfg-tournamentId">Room/Tournament Name</label>
            <input type="text" id="cfg-tournamentId" value="${settings.tournamentId || 'party-room'}" placeholder="e.g. pool-party-2026">
            <span class="help-text">Use a unique name. Guests will connect using this name.</span>
          </div>

          <div class="form-group">
            <label for="cfg-apiKey">API Key</label>
            <input type="text" id="cfg-apiKey" value="${config.apiKey || ''}" placeholder="AIzaSy...">
          </div>

          <div class="form-group">
            <label for="cfg-databaseURL">Database URL</label>
            <input type="text" id="cfg-databaseURL" value="${config.databaseURL || ''}" placeholder="https://your-project.firebaseio.com">
          </div>

          <div class="form-group">
            <label for="cfg-projectId">Project ID</label>
            <input type="text" id="cfg-projectId" value="${config.projectId || ''}" placeholder="your-project-id">
          </div>

          <div class="form-group">
            <label for="cfg-authDomain">Auth Domain (Optional)</label>
            <input type="text" id="cfg-authDomain" value="${config.authDomain || ''}" placeholder="your-project.firebaseapp.com">
          </div>

          <div class="form-group">
            <label for="cfg-appId">App ID (Optional)</label>
            <input type="text" id="cfg-appId" value="${config.appId || ''}" placeholder="1:123:web:abc">
          </div>

          <div class="actions">
            <button id="btn-test-connection" class="btn btn-info">Test Connection</button>
            <span id="conn-test-status" class="test-status"></span>
          </div>
        </div>

        <div class="save-actions">
          <button id="btn-save-settings" class="btn btn-primary">Apply & Save Settings</button>
          <span id="save-status" class="save-status"></span>
        </div>
      </div>
    `;
  },

  bindEvents() {
    const btnLocal = document.getElementById('btn-mode-local');
    const btnSync = document.getElementById('btn-mode-sync');
    const configPanel = document.getElementById('firebase-config-panel');
    const btnSave = document.getElementById('btn-save-settings');
    const btnTest = document.getElementById('btn-test-connection');
    const testStatus = document.getElementById('conn-test-status');
    const saveStatus = document.getElementById('save-status');

    let selectedMode = StorageService.getSettings().mode;

    btnLocal.addEventListener('click', () => {
      selectedMode = 'local';
      btnLocal.classList.add('active');
      btnSync.classList.remove('active');
      configPanel.classList.add('hidden');
    });

    btnSync.addEventListener('click', () => {
      selectedMode = 'firebase';
      btnSync.classList.add('active');
      btnLocal.classList.remove('active');
      configPanel.classList.remove('hidden');
    });

    btnTest.addEventListener('click', async () => {
      const config = this.getFormConfig();
      testStatus.textContent = "Connecting...";
      testStatus.className = "test-status pending";
      
      const success = await CloudDb.testConnection(config);
      if (success) {
        testStatus.textContent = "Success! Connection Verified.";
        testStatus.className = "test-status success";
      } else {
        testStatus.textContent = "Failed. Check config / database rules.";
        testStatus.className = "test-status error";
      }
    });

    btnSave.addEventListener('click', () => {
      const settings = {
        mode: selectedMode,
        tournamentId: document.getElementById('cfg-tournamentId').value.trim() || 'party-tournament',
        firebaseConfig: selectedMode === 'firebase' ? this.getFormConfig() : null
      };

      if (selectedMode === 'firebase' && (!settings.firebaseConfig.apiKey || !settings.firebaseConfig.databaseURL)) {
        saveStatus.textContent = "API Key and Database URL are required.";
        saveStatus.className = "save-status error";
        return;
      }

      StorageService.saveSettings(settings);
      saveStatus.textContent = "Settings saved successfully!";
      saveStatus.className = "save-status success";
      
      setTimeout(() => {
        saveStatus.textContent = "";
      }, 3000);

      if (this.onSettingsChanged) {
        this.onSettingsChanged(settings);
      }
    });
  },

  getFormConfig() {
    return {
      apiKey: document.getElementById('cfg-apiKey').value.trim(),
      databaseURL: document.getElementById('cfg-databaseURL').value.trim(),
      projectId: document.getElementById('cfg-projectId').value.trim(),
      authDomain: document.getElementById('cfg-authDomain').value.trim(),
      appId: document.getElementById('cfg-appId').value.trim()
    };
  }
};
