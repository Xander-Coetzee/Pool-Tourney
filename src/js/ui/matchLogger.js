import { escapeHTML } from './domUtils.js';

export const MatchLogger = {
  init(modalId, tournament, onSaveCallback) {
    this.modal = document.getElementById(modalId);
    this.tournament = tournament;
    this.onSave = onSaveCallback;
    this.currentMatchId = null;
    this.p1Score = 0;
    this.p2Score = 0;
  },

  open(matchId) {
    const match = this.tournament.getMatches()[matchId];
    if (!match) return;

    this.currentMatchId = matchId;
    this.p1Score = match.p1Score != null ? match.p1Score : 0;
    this.p2Score = match.p2Score != null ? match.p2Score : 0;

    this.render(match);
    this.modal.classList.remove('hidden');
    this.bindEvents(match);
  },

  close() {
    this.modal.classList.add('hidden');
    this.currentMatchId = null;
  },

  render(match) {
    const isEdit = match.status === 'completed';
    const p1Name = match.p1 ? escapeHTML(match.p1.name) : 'Unknown';
    const p2Name = match.p2 ? escapeHTML(match.p2.name) : 'Unknown';
    const matchFormat = this.tournament.matchFormat || 'bo1';

    let outcomesHTML = '';
    if (matchFormat === 'bo3') {
      outcomesHTML = `
        <div class="result-options-container">
          <button class="result-option-card ${this.p1Score === 2 && this.p2Score === 0 ? 'active' : ''}" data-p1="2" data-p2="0">
            <span class="option-team">${p1Name} Wins</span>
            <span class="option-score">2 - 0</span>
          </button>
          <button class="result-option-card ${this.p1Score === 2 && this.p2Score === 1 ? 'active' : ''}" data-p1="2" data-p2="1">
            <span class="option-team">${p1Name} Wins</span>
            <span class="option-score">2 - 1</span>
          </button>
          <button class="result-option-card ${this.p1Score === 0 && this.p2Score === 2 ? 'active' : ''}" data-p1="0" data-p2="2">
            <span class="option-team">${p2Name} Wins</span>
            <span class="option-score">0 - 2</span>
          </button>
          <button class="result-option-card ${this.p1Score === 1 && this.p2Score === 2 ? 'active' : ''}" data-p1="1" data-p2="2">
            <span class="option-team">${p2Name} Wins</span>
            <span class="option-score">1 - 2</span>
          </button>
        </div>
      `;
    } else {
      outcomesHTML = `
        <div class="result-options-container">
          <button class="result-option-card ${this.p1Score === 1 && this.p2Score === 0 ? 'active' : ''}" data-p1="1" data-p2="0">
            <span class="option-team">${p1Name} Wins</span>
            <span class="option-score">1 - 0</span>
          </button>
          <button class="result-option-card ${this.p1Score === 0 && this.p2Score === 1 ? 'active' : ''}" data-p1="0" data-p2="1">
            <span class="option-team">${p2Name} Wins</span>
            <span class="option-score">0 - 1</span>
          </button>
        </div>
      `;
    }

    this.modal.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-content glass-card">
        <button class="btn-close-modal" id="modal-close">&times;</button>
        <h2>${isEdit ? 'Edit Match Score' : 'Log Match Score'}</h2>
        <p class="match-info-subtitle">${match.id.toUpperCase()}: ${p1Name} vs ${p2Name}</p>
        <p class="format-badge" style="display: inline-block; font-size: 0.75rem; text-transform: uppercase; color: var(--neon-blue); border: 1px solid rgba(102, 252, 241, 0.2); padding: 0.15rem 0.5rem; border-radius: 4px; margin-bottom: 1rem; background: rgba(102, 252, 241, 0.05);">${matchFormat === 'bo3' ? 'Best of 3' : 'Best of 1'}</p>

        ${outcomesHTML}

        <div class="confirmation-checkbox-container" style="margin-top: 1rem;">
          <label class="custom-checkbox">
            <input type="checkbox" id="chk-confirm-lock">
            <span class="checkmark"></span>
            I confirm these scores are correct.
          </label>
          <p class="lock-warning">Once saved, this match will lock when downstream matches begin.</p>
        </div>

        <div class="modal-actions">
          ${isEdit ? `
            <button id="btn-rollback-score" class="btn btn-danger">Reset Match (Rollback)</button>
          ` : ''}
          <button id="btn-save-score" class="btn btn-success" disabled>Save & Advance</button>
        </div>
      </div>
    `;
  },

  bindEvents(match) {
    const closeBtn = document.getElementById('modal-close');
    const backdrop = this.modal.querySelector('.modal-backdrop');
    const chkConfirm = document.getElementById('chk-confirm-lock');
    const saveBtn = document.getElementById('btn-save-score');
    const rollbackBtn = document.getElementById('btn-rollback-score');
    const optionCards = this.modal.querySelectorAll('.result-option-card');

    const updateUI = () => {
      // Check if any option is selected
      const hasSelection = (this.p1Score > 0 || this.p2Score > 0);
      saveBtn.disabled = !hasSelection || !chkConfirm.checked;
    };

    closeBtn.addEventListener('click', () => this.close());
    backdrop.addEventListener('click', () => this.close());

    // Result Card Clicks
    optionCards.forEach(card => {
      card.addEventListener('click', () => {
        optionCards.forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        
        this.p1Score = parseInt(card.getAttribute('data-p1'), 10);
        this.p2Score = parseInt(card.getAttribute('data-p2'), 10);
        
        updateUI();
      });
    });

    chkConfirm.addEventListener('change', () => {
      updateUI();
    });

    saveBtn.addEventListener('click', () => {
      if (this.p1Score === this.p2Score) return;
      if (this.onSave) {
        this.onSave(this.currentMatchId, this.p1Score, this.p2Score);
      }
      this.close();
    });

    if (rollbackBtn) {
      rollbackBtn.addEventListener('click', () => {
        if (confirm("Are you sure you want to rollback this match? This resets scores and removes advanced players from subsequent rounds.")) {
          try {
            this.tournament.rollbackMatch(this.currentMatchId);
            if (this.onSave) {
              this.onSave(null, null, null, true);
            }
            this.close();
          } catch (e) {
            alert(e.message);
          }
        }
      });
    }

    updateUI();
  }
};
