import { escapeHTML } from './domUtils.js';

export const BracketRenderer = {
  init(bracketContainerId, matchCenterContainerId, tournament, onMatchClickCallback, onStartMatchCallback) {
    this.bracketContainer = document.getElementById(bracketContainerId);
    this.matchCenterContainer = document.getElementById(matchCenterContainerId);
    this.tournament = tournament;
    this.onMatchClick = onMatchClickCallback;
    this.onStartMatch = onStartMatchCallback;
    this.isAdmin = false;
    this.activeMatchId = null;
    this.setupEventDelegation();
  },

  setAdmin(isAdmin) {
    this.isAdmin = isAdmin;
  },

  setActiveMatchId(activeMatchId) {
    this.activeMatchId = activeMatchId;
  },

  setupEventDelegation() {
    const handleDelegation = (e) => {
      // Check for round tab click
      const tabBtn = e.target.closest('.round-tab-btn');
      if (tabBtn) {
        e.stopPropagation();
        const roundId = tabBtn.getAttribute('data-round');
        this.selectedMobileRoundId = roundId;
        
        // Update tab buttons active class
        const buttons = this.bracketContainer.querySelectorAll('.round-tab-btn');
        buttons.forEach(btn => {
          if (btn.getAttribute('data-round') === roundId) {
            btn.classList.add('active');
          } else {
            btn.classList.remove('active');
          }
        });

        // Update rounds visibility class
        const rounds = this.bracketContainer.querySelectorAll('.bracket-round');
        rounds.forEach(round => {
          if (round.getAttribute('data-round') === roundId) {
            round.classList.add('mobile-active-round');
          } else {
            round.classList.remove('mobile-active-round');
          }
        });
        return;
      }

      // Check for Start Match button
      const btnStart = e.target.closest('.btn-action-start');
      if (btnStart) {
        e.stopPropagation();
        const matchId = btnStart.getAttribute('data-id');
        if (matchId && this.onStartMatch) {
          this.onStartMatch(matchId);
        }
        return;
      }

      // Check for standard log/edit clicks (only if Admin)
      if (!this.isAdmin) return;

      const card = e.target.closest('.match-card.scheduled:not(.locked-match), .match-card.completed.editable, .match-center-card.scheduled:not(.locked-match), .btn-action-log, .btn-action-edit');
      if (card) {
        e.stopPropagation();
        const matchId = card.getAttribute('data-id');
        if (matchId && this.onMatchClick) {
          this.onMatchClick(matchId);
        }
      }
    };

    this.bracketContainer.addEventListener('click', handleDelegation);
    this.matchCenterContainer.addEventListener('click', handleDelegation);
  },

  render() {
    this.renderVisualBracket();
    this.renderMatchCenter();
  },

  renderVisualBracket() {
    const matches = this.tournament.getMatches();
    const size = this.tournament.size;
    if (!size || size === 0) {
      this.bracketContainer.innerHTML = '<div class="empty-bracket">No active tournament to display.</div>';
      return;
    }

    const k = Math.log2(size);
    
    // Collect rounds for mobile tabs
    const rounds = [];
    for (let r = 1; r <= k; r++) {
      rounds.push({ id: `w-${r}`, label: `Winners R${r}` });
    }
    if (size > 2) {
      const losersRounds = 2 * k - 2;
      for (let lr = 1; lr <= losersRounds; lr++) {
        rounds.push({ id: `l-${lr}`, label: `Losers R${lr}` });
      }
    }
    rounds.push({ id: `gf`, label: `Finals` });

    // Set initial selected mobile round if not set or if not valid anymore
    const isValidRound = rounds.some(r => r.id === this.selectedMobileRoundId);
    if (!this.selectedMobileRoundId || !isValidRound) {
      const activeRound = rounds.find(round => {
        if (this.activeMatchId) {
          if (this.activeMatchId.startsWith('gf-') && round.id === 'gf') return true;
          return this.activeMatchId.startsWith(round.id + '-');
        }
        return false;
      });
      this.selectedMobileRoundId = activeRound ? activeRound.id : rounds[0].id;
    }

    let html = '<div class="bracket-round-tabs mobile-only">';
    rounds.forEach(round => {
      const isSelected = round.id === this.selectedMobileRoundId;
      html += `
        <button class="round-tab-btn ${isSelected ? 'active' : ''}" data-round="${round.id}">
          ${round.label}
        </button>
      `;
    });
    html += '</div>';

    html += '<div class="bracket-scroll-wrapper">';

    // --- WINNERS BRACKET ---
    html += `
      <div class="bracket-section">
        <h3 class="section-title text-neon-blue">Winner's Bracket</h3>
        <div class="bracket-tree winners-tree">
    `;

    for (let r = 1; r <= k; r++) {
      const matchCount = size / Math.pow(2, r);
      const isSelected = `w-${r}` === this.selectedMobileRoundId;
      const activeClass = isSelected ? 'mobile-active-round' : '';
      html += `
        <div class="bracket-round winners-round ${activeClass}" data-round="w-${r}">
          <h4 class="round-header">Round ${r}</h4>
          <div class="round-matches">
      `;

      for (let i = 1; i <= matchCount; i++) {
        const matchId = `w-${r}-${i}`;
        html += this.renderMatchCardHTML(matches[matchId]);
      }

      html += `
          </div>
        </div>
      `;
    }
    html += '</div></div>';

    // --- LOSERS BRACKET ---
    if (size > 2) {
      const losersRounds = 2 * k - 2;
      html += `
        <div class="bracket-section">
          <h3 class="section-title text-neon-purple">Loser's Bracket</h3>
          <div class="bracket-tree losers-tree">
      `;

      for (let lr = 1; lr <= losersRounds; lr++) {
        const m = Math.ceil(lr / 2);
        const matchCount = size / Math.pow(2, m + 1);
        const isSelected = `l-${lr}` === this.selectedMobileRoundId;
        const activeClass = isSelected ? 'mobile-active-round' : '';

        html += `
          <div class="bracket-round losers-round ${activeClass}" data-round="l-${lr}">
            <h4 class="round-header">L-Round ${lr}</h4>
            <div class="round-matches">
        `;

        for (let i = 1; i <= matchCount; i++) {
          const matchId = `l-${lr}-${i}`;
          html += this.renderMatchCardHTML(matches[matchId]);
        }

        html += `
            </div>
          </div>
        `;
      }
      html += '</div></div>';
    }

    // --- GRAND FINALS ---
    const isGfSelected = 'gf' === this.selectedMobileRoundId;
    const gfActiveClass = isGfSelected ? 'mobile-active-round' : '';
    html += `
      <div class="bracket-section">
        <h3 class="section-title text-neon-green">Grand Finals</h3>
        <div class="bracket-tree gf-tree">
          <div class="bracket-round gf-round ${gfActiveClass}" data-round="gf">
            <h4 class="round-header">Finals</h4>
            <div class="round-matches">
    `;
    
    html += this.renderMatchCardHTML(matches['gf-1-1']);

    if (matches['gf-1-2']) {
      html += this.renderMatchCardHTML(matches['gf-1-2']);
    }

    html += `
            </div>
          </div>
        </div>
      </div>
    `;

    html += '</div>';
    this.bracketContainer.innerHTML = html;
  },

  renderMatchCardHTML(match) {
    if (!match) return '';

    const p1 = match.p1;
    const p2 = match.p2;

    const p1Name = p1 ? escapeHTML(p1.name) : '? Pending';
    const p2Name = p2 ? escapeHTML(p2.name) : '? Pending';
    
    const p1Seed = p1 && !p1.isBye ? `#${p1.seed}` : '';
    const p2Seed = p2 && !p2.isBye ? `#${p2.seed}` : '';

    const p1Score = match.p1Score != null ? match.p1Score : '';
    const p2Score = match.p2Score != null ? match.p2Score : '';

    const isCompleted = match.status === 'completed';
    const isScheduled = match.status === 'scheduled';
    const isActive = this.activeMatchId && match.id === this.activeMatchId;
    const isLocked = this.activeMatchId && match.id !== this.activeMatchId && (match.status === 'scheduled' || match.status === 'pending');

    const p1Winner = isCompleted && match.winnerId === p1?.id;
    const p2Winner = isCompleted && match.winnerId === p2?.id;

    let matchLabel = match.id.toUpperCase();
    if (match.id === 'gf-1-1') matchLabel = 'FINALS 1';
    if (match.id === 'gf-1-2') matchLabel = 'FINALS 2 (RESET)';

    const canEdit = this.isAdmin && this.tournament.canEditMatch(match.id);

    let cardClasses = `match-card glass-card ${match.status}`;
    if (isActive) cardClasses += ' active-match';
    if (isLocked) cardClasses += ' locked-match';
    if (canEdit) cardClasses += ' editable';

    // Badge styling logic
    let badgeText = match.status;
    let badgeClass = match.status;
    if (isActive) {
      badgeText = 'active';
      badgeClass = 'active';
    } else if (match.status === 'scheduled') {
      badgeText = 'on deck';
      badgeClass = 'on_deck';
    } else if (match.status === 'pending_verification') {
      badgeText = 'verifying';
      badgeClass = 'pending_verification';
    }

    return `
      <div class="${cardClasses}" data-id="${match.id}">
        <div class="match-header">
          <span class="match-id">${matchLabel}</span>
          <span class="match-badge badge-${badgeClass}">${badgeText.toUpperCase()}</span>
        </div>
        <div class="player-row ${p1Winner ? 'winner' : ''} ${p1?.isBye ? 'bye-row' : ''}">
          <span class="seed">${p1Seed}</span>
          <span class="name truncate">${p1Name}</span>
          <span class="score">${p1Score}</span>
        </div>
        <div class="player-row ${p2Winner ? 'winner' : ''} ${p2?.isBye ? 'bye-row' : ''}">
          <span class="seed">${p2Seed}</span>
          <span class="name truncate">${p2Name}</span>
          <span class="score">${p2Score}</span>
        </div>
        ${canEdit ? '<div class="edit-overlay"><i class="edit-icon">✎ Edit Score</i></div>' : ''}
      </div>
    `;
  },

  renderMatchCenter() {
    const matches = this.tournament.getMatches();
    const size = this.tournament.size;
    if (!size || size === 0) {
      this.matchCenterContainer.innerHTML = '<div class="empty-bracket">No active tournament to display.</div>';
      return;
    }

    const active = [];
    const upcoming = [];
    const completed = [];

    const sortedKeys = Object.keys(matches).sort((a, b) => {
      if (a.startsWith('gf') && !b.startsWith('gf')) return -1;
      if (!a.startsWith('gf') && b.startsWith('gf')) return 1;
      if (a.startsWith('gf') && b.startsWith('gf')) return a.localeCompare(b);
      
      const partsA = a.split('-');
      const partsB = b.split('-');
      if (partsA[0] !== partsB[0]) {
        return partsA[0] === 'w' ? -1 : 1;
      }
      const rA = parseInt(partsA[1]);
      const rB = parseInt(partsB[1]);
      if (rA !== rB) return rA - rB;
      return parseInt(partsA[2]) - parseInt(partsB[2]);
    });

    for (const key of sortedKeys) {
      const match = matches[key];
      const isActive = this.activeMatchId && match.id === this.activeMatchId;
      
      if (isActive || match.status === 'scheduled') {
        active.push(match);
      } else if (match.status === 'pending' || match.status === 'pending_verification') {
        if (match.p1 || match.p2) {
          upcoming.push(match);
        }
      } else if (match.status === 'completed') {
        completed.push(match);
      }
    }

    let html = '<div class="match-center-layout">';

    // --- LIVE MATCHES SECTION ---
    html += `
      <div class="center-section">
        <h3 class="section-title text-neon-green">Live Matches (${active.length})</h3>
        <div class="center-list active-list">
          ${active.length === 0 ? '<div class="empty-state">No matches currently active.</div>' : ''}
          ${active.map(match => this.renderMatchCenterCard(match, true)).join('')}
        </div>
      </div>
    `;

    // --- UPCOMING / ON DECK ---
    html += `
      <div class="center-section">
        <h3 class="section-title text-neon-blue">Upcoming Matches (${upcoming.length})</h3>
        <div class="center-list upcoming-list">
          ${upcoming.length === 0 ? '<div class="empty-state">All matches scheduled or complete!</div>' : ''}
          ${upcoming.map(match => this.renderMatchCenterCard(match, false)).join('')}
        </div>
      </div>
    `;

    // --- COMPLETED ---
    html += `
      <div class="center-section">
        <h3 class="section-title text-neon-purple">Completed Matches (${completed.length})</h3>
        <div class="center-list completed-list">
          ${completed.length === 0 ? '<div class="empty-state">No completed matches yet.</div>' : ''}
          ${completed.map(match => this.renderMatchCenterCard(match, false)).join('')}
        </div>
      </div>
    `;

    html += '</div>';
    this.matchCenterContainer.innerHTML = html;
  },

  renderMatchCenterCard(match, isLiveSection) {
    const p1Name = match.p1 ? escapeHTML(match.p1.name) : 'Waiting for winner...';
    const p2Name = match.p2 ? escapeHTML(match.p2.name) : 'Waiting for winner...';
    const p1Seed = match.p1 ? `#${match.p1.seed}` : '';
    const p2Seed = match.p2 ? `#${match.p2.seed}` : '';

    const p1Winner = match.status === 'completed' && match.winnerId === match.p1?.id;
    const p2Winner = match.status === 'completed' && match.winnerId === match.p2?.id;

    const canEdit = this.isAdmin && this.tournament.canEditMatch(match.id);
    const isActive = this.activeMatchId && match.id === this.activeMatchId;
    const isLocked = this.activeMatchId && match.id !== this.activeMatchId && match.status === 'scheduled';

    let matchLabel = match.id.toUpperCase();
    if (match.id.startsWith('w-')) matchLabel = `Winners Round ${match.id.split('-')[1]} - Match ${match.id.split('-')[2]}`;
    if (match.id.startsWith('l-')) matchLabel = `Losers Round ${match.id.split('-')[1]} - Match ${match.id.split('-')[2]}`;
    if (match.id === 'gf-1-1') matchLabel = `Grand Finals - Match 1`;
    if (match.id === 'gf-1-2') matchLabel = `Grand Finals - Match 2 (Reset)`;

    let cardClasses = `match-center-card glass-card ${match.status}`;
    if (isActive) cardClasses += ' active-match';
    if (isLocked) cardClasses += ' locked-match';
    if (canEdit) cardClasses += ' editable';

    // Badge styling logic
    let badgeText = match.status;
    let badgeClass = match.status;
    if (isActive) {
      badgeText = 'active';
      badgeClass = 'active';
    } else if (match.status === 'scheduled') {
      badgeText = 'on deck';
      badgeClass = 'on_deck';
    } else if (match.status === 'pending_verification') {
      badgeText = 'verifying';
      badgeClass = 'pending_verification';
    }

    return `
      <div class="${cardClasses}" data-id="${match.id}">
        <div class="center-card-header">
          <span class="center-match-label">${matchLabel}</span>
          <span class="match-badge badge-${badgeClass}">${badgeText.toUpperCase()}</span>
        </div>
        
        <div class="center-card-body">
          <div class="center-player-slot ${p1Winner ? 'winner' : ''}">
            <span class="seed">${p1Seed}</span>
            <span class="name truncate">${p1Name}</span>
            <span class="score">${match.p1Score != null ? match.p1Score : '-'}</span>
          </div>
          <div class="versus">VS</div>
          <div class="center-player-slot ${p2Winner ? 'winner' : ''}">
            <span class="seed">${p2Seed}</span>
            <span class="name truncate">${p2Name}</span>
            <span class="score">${match.p2Score != null ? match.p2Score : '-'}</span>
          </div>
        </div>

        ${this.isAdmin && isLiveSection ? `
          ${isActive ? `
            <button class="btn btn-success btn-action-log" data-id="${match.id}">Log Match Score</button>
          ` : `
            <button class="btn btn-primary btn-action-start" data-id="${match.id}">Start Match (Lock Active)</button>
          `}
        ` : ''}

        ${this.isAdmin && match.status === 'completed' && canEdit ? `
          <button class="btn btn-warning btn-action-edit" data-id="${match.id}">✎ Edit Score</button>
        ` : ''}
      </div>
    `;
  }
};
