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
    this.p1Score = match.p1Score !== null ? match.p1Score : 0;
    this.p2Score = match.p2Score !== null ? match.p2Score : 0;

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
    const p1Seed = match.p1 && !match.p1.isBye ? `#${match.p1.seed}` : '';
    const p2Seed = match.p2 && !match.p2.isBye ? `#${match.p2.seed}` : '';

    this.modal.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-content glass-card">
        <button class="btn-close-modal" id="modal-close">&times;</button>
        <h2>${isEdit ? 'Edit Match Score' : 'Log Match Score'}</h2>
        <p class="match-info-subtitle">${match.id.toUpperCase()}: ${p1Name} vs ${p2Name}</p>

        <div class="steppers-container">
          <!-- Player 1 Stepper -->
          <div class="stepper-box">
            <span class="stepper-seed">${p1Seed}</span>
            <span class="stepper-name truncate">${p1Name}</span>
            <div class="stepper-controls">
              <button class="btn btn-stepper" id="p1-minus">-</button>
              <span class="stepper-val" id="p1-val">${this.p1Score}</span>
              <button class="btn btn-stepper" id="p1-plus">+</button>
            </div>
          </div>

          <div class="stepper-vs">VS</div>

          <!-- Player 2 Stepper -->
          <div class="stepper-box">
            <span class="stepper-seed">${p2Seed}</span>
            <span class="stepper-name truncate">${p2Name}</span>
            <div class="stepper-controls">
              <button class="btn btn-stepper" id="p2-minus">-</button>
              <span class="stepper-val" id="p2-val">${this.p2Score}</span>
              <button class="btn btn-stepper" id="p2-plus">+</button>
            </div>
          </div>
        </div>

        <div id="validation-error" class="validation-error hidden"></div>

        <div class="confirmation-checkbox-container">
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
    
    const p1Minus = document.getElementById('p1-minus');
    const p1Plus = document.getElementById('p1-plus');
    const p1Val = document.getElementById('p1-val');

    const p2Minus = document.getElementById('p2-minus');
    const p2Plus = document.getElementById('p2-plus');
    const p2Val = document.getElementById('p2-val');

    const errorDiv = document.getElementById('validation-error');
    const chkConfirm = document.getElementById('chk-confirm-lock');
    const saveBtn = document.getElementById('btn-save-score');
    const rollbackBtn = document.getElementById('btn-rollback-score');

    const updateUI = () => {
      p1Val.textContent = this.p1Score;
      p2Val.textContent = this.p2Score;

      let err = '';
      if (this.p1Score === this.p2Score) {
        err = "Ties are not allowed. One player must win.";
      } else if (this.p1Score < 0 || this.p2Score < 0) {
        err = "Scores cannot be negative.";
      }

      if (err) {
        errorDiv.textContent = err;
        errorDiv.classList.remove('hidden');
        saveBtn.disabled = true;
      } else {
        errorDiv.classList.add('hidden');
        saveBtn.disabled = !chkConfirm.checked;
      }
    };

    closeBtn.addEventListener('click', () => this.close());
    backdrop.addEventListener('click', () => this.close());

    // P1 Controls
    p1Minus.addEventListener('click', () => {
      if (this.p1Score > 0) {
        this.p1Score--;
        updateUI();
      }
    });
    p1Plus.addEventListener('click', () => {
      this.p1Score++;
      updateUI();
    });

    // P2 Controls
    p2Minus.addEventListener('click', () => {
      if (this.p2Score > 0) {
        this.p2Score--;
        updateUI();
      }
    });
    p2Plus.addEventListener('click', () => {
      this.p2Score++;
      updateUI();
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
