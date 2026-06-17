import { StorageService } from '../storage.js';
import { escapeHTML } from './domUtils.js';

export const PlayerManager = {
  init(containerId, onStartTournamentCallback, onResetTournamentCallback, onRenamePlayerCallback) {
    this.container = document.getElementById(containerId);
    this.onStart = onStartTournamentCallback;
    this.onReset = onResetTournamentCallback;
    this.onRename = onRenamePlayerCallback;
    this.players = StorageService.getPlayers();
    this.isTournamentActive = false;
    this.setupEventDelegation();
  },

  setTournamentActive(active) {
    this.isTournamentActive = active;
    this.render();
  },

  setPlayers(players) {
    this.players = players;
    StorageService.savePlayers(players);
    this.render();
  },

  render() {
    // Determine what text was in the input box so we don't clear it during sync redraws
    const oldInput = document.getElementById('new-player-name');
    const oldInputValue = oldInput ? oldInput.value : '';

    // Track which player name input currently has focus and its cursor position
    const activeEl = document.activeElement;
    const activeId = activeEl && activeEl.classList.contains('player-name-input') ? activeEl.getAttribute('data-id') : null;
    const selectionStart = activeEl ? activeEl.selectionStart : null;
    const selectionEnd = activeEl ? activeEl.selectionEnd : null;

    this.container.innerHTML = `
      <div class="player-manager-card glass-card">
        <h2>Player / Team Manager</h2>
        
        ${!this.isTournamentActive ? `
          <p class="description">Add players below. We recommend shuffling/randomizing seeds before starting the tournament!</p>
          <div class="add-player-form">
            <input type="text" id="new-player-name" placeholder="Enter player or team name..." autocomplete="off" value="${escapeHTML(oldInputValue)}">
            <button id="btn-add-player" class="btn btn-primary">Add Player</button>
          </div>
          <div class="bulk-actions">
            <button id="btn-randomize-seeds" class="btn btn-secondary">Randomize Seeds</button>
            <button id="btn-clear-players" class="btn btn-danger">Clear All</button>
          </div>
        ` : `
          <div class="active-banner">
            <span class="pulse-dot"></span>
            <span>Tournament in progress! You can still edit player names below.</span>
          </div>
        `}

        <div class="player-list-container">
          <ul id="player-list" class="player-list">
            ${this.players.length === 0 ? '<li class="empty-list">No players added yet.</li>' : ''}
            ${this.players.map((p, idx) => `
              <li class="player-item" data-id="${p.id}">
                <span class="player-seed">#${idx + 1}</span>
                <input type="text" class="player-name-input" value="${escapeHTML(p.name)}" data-id="${p.id}">
                ${!this.isTournamentActive ? `
                  <button class="btn-delete-player" data-id="${p.id}" title="Remove Player">&times;</button>
                ` : ''}
              </li>
            `).join('')}
          </ul>
        </div>

        <div class="manager-actions">
          ${!this.isTournamentActive ? `
            <button id="btn-start-tournament" class="btn btn-success" ${this.players.length < 2 ? 'disabled' : ''}>
              Start Tournament (${this.players.length} Players)
            </button>
          ` : `
            <button id="btn-reset-tournament" class="btn btn-danger">
              Reset & End Tournament
            </button>
          `}
        </div>
      </div>
    `;

    // Restore focus and cursor positions to prevent input focus theft during sync updates
    if (activeId) {
      const restoredInput = this.container.querySelector(`.player-name-input[data-id="${activeId}"]`);
      if (restoredInput) {
        restoredInput.focus();
        if (selectionStart !== null && selectionEnd !== null) {
          restoredInput.setSelectionRange(selectionStart, selectionEnd);
        }
      }
    } else if (oldInput && activeEl && activeEl.id === 'new-player-name') {
      const restoredInput = document.getElementById('new-player-name');
      if (restoredInput) {
        restoredInput.focus();
      }
    }
  },

  setupEventDelegation() {
    // Click Delegation
    this.container.addEventListener('click', (e) => {
      // Delete player
      const btnDelete = e.target.closest('.btn-delete-player');
      if (btnDelete) {
        const id = btnDelete.getAttribute('data-id');
        this.players = this.players.filter(p => p.id !== id);
        this.players.forEach((p, idx) => p.seed = idx + 1);
        this.setPlayers(this.players);
        return;
      }

      // Add player
      if (e.target.id === 'btn-add-player') {
        this.addPlayerFromInput();
        return;
      }

      // Randomize Seeds
      if (e.target.id === 'btn-randomize-seeds') {
        if (this.players.length < 2) return;
        const shuffled = [...this.players];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        shuffled.forEach((p, idx) => p.seed = idx + 1);
        this.players = shuffled;
        this.setPlayers(shuffled);
        return;
      }

      // Clear All
      if (e.target.id === 'btn-clear-players') {
        if (confirm("Are you sure you want to clear all players?")) {
          this.players = [];
          this.setPlayers([]);
        }
        return;
      }

      // Start Tournament
      if (e.target.id === 'btn-start-tournament') {
        if (this.players.length < 2) return;
        if (this.onStart) this.onStart(this.players);
        return;
      }

      // Reset Tournament
      if (e.target.id === 'btn-reset-tournament') {
        if (confirm("Are you sure you want to end and reset the active tournament? All current progress and scores will be permanently deleted.")) {
          if (this.onReset) this.onReset();
        }
        return;
      }
    });

    // Keydown Delegation (for Enter key shortcut)
    this.container.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (e.target.id === 'new-player-name') {
          this.addPlayerFromInput();
        } else if (e.target.classList.contains('player-name-input')) {
          e.target.blur(); // triggers the change event
        }
      }
    });

    // Change Delegation (for player inline rename inputs)
    this.container.addEventListener('change', (e) => {
      if (e.target.classList.contains('player-name-input')) {
        const id = e.target.getAttribute('data-id');
        const newName = e.target.value.trim();
        if (!newName) {
          const original = this.players.find(p => p.id === id);
          if (original) e.target.value = original.name;
          return;
        }

        if (this.players.some(p => p.id !== id && p.name.toLowerCase() === newName.toLowerCase())) {
          alert("Another player already has this name!");
          const original = this.players.find(p => p.id === id);
          if (original) e.target.value = original.name;
          return;
        }

        this.players = this.players.map(p => p.id === id ? { ...p, name: newName } : p);
        StorageService.savePlayers(this.players);

        if (this.onRename) {
          this.onRename(id, newName);
        }
      }
    });
  },

  addPlayerFromInput() {
    const input = document.getElementById('new-player-name');
    if (!input) return;
    const name = input.value.trim();
    if (!name) return;

    if (this.players.some(p => p.name.toLowerCase() === name.toLowerCase())) {
      alert("A player with that name already exists!");
      return;
    }

    const newPlayer = {
      id: `p-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: name,
      seed: this.players.length + 1
    };

    this.players.push(newPlayer);
    this.setPlayers(this.players);
    
    // Maintain focus on input box after adding
    const newInput = document.getElementById('new-player-name');
    if (newInput) {
      newInput.value = '';
      newInput.focus();
    }
  }
};
