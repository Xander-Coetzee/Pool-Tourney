import { StorageService } from './storage.js';
import { CloudDb } from './cloudDb.js';
import { DoubleElimination } from './tournaments/doubleElimination.js';
import { BracketRenderer } from './ui/bracketRenderer.js';
import { MatchLogger } from './ui/matchLogger.js';
import { SettingsManager } from './ui/settingsManager.js';
import { PlayerManager } from './ui/playerManager.js';
import { escapeHTML } from './ui/domUtils.js';

// Global instances
const tournament = new DoubleElimination();
let currentSettings = StorageService.getSettings();
let isRemoteUpdating = false;

// Guest identity locks
let guestPlayerId = localStorage.getItem('guest_player_id');
let guestPlayerName = localStorage.getItem('guest_player_name');
const isAdmin = new URLSearchParams(window.location.search).get('admin') === 'true';

const App = {
  init() {
    this.previousPhase = 1;
    this.activeMatchId = null;
    this.pendingPairPlayerId = null;
    this.setupTabs();
    this.setupSettings();
    this.setupLocalPlayerManager();
    this.setupTournamentUI();
    
    // Set admin view privileges
    BracketRenderer.setAdmin(isAdmin);

    // Initial connection hook
    this.initializeConnection();
  },

  setupTabs() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabPanels = document.querySelectorAll('.tab-panel');

    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-tab');

        tabButtons.forEach(b => b.classList.remove('active'));
        tabPanels.forEach(p => p.classList.remove('active'));

        btn.classList.add('active');
        document.getElementById(targetTab).classList.add('active');
      });
    });
  },

  switchTab(tabId) {
    const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
    if (tabBtn) tabBtn.click();
  },

  updateTabVisibility(phase) {
    const playersTabBtn = document.querySelector('.tab-btn[data-tab="tab-players"]');
    const settingsTabBtn = document.querySelector('.tab-btn[data-tab="tab-settings"]');
    
    if (!isAdmin) {
      if (settingsTabBtn) settingsTabBtn.style.display = 'none';
      
      if (phase === 2) {
        if (playersTabBtn) playersTabBtn.style.display = 'none';
      } else {
        if (playersTabBtn) {
          playersTabBtn.style.display = '';
          playersTabBtn.innerHTML = '👤 Lobby';
        }
      }
    } else {
      if (settingsTabBtn) settingsTabBtn.style.display = '';
      if (playersTabBtn) {
        playersTabBtn.style.display = '';
        playersTabBtn.innerHTML = phase === 2 ? '👤 Players' : '👤 Lobby';
      }
    }
  },

  setupSettings() {
    SettingsManager.init('settings-view', (newSettings) => {
      currentSettings = newSettings;
      this.initializeConnection();
    });
  },

  setupLocalPlayerManager() {
    PlayerManager.init(
      'player-manager-view',
      // Start tournament callback
      (players) => {
        tournament.initialize(players);
        this.saveAndSyncState();
        this.renderTournamentPanel();
      },
      // Reset tournament callback
      () => {
        StorageService.clearTournamentState();
        tournament.loadState(null);
        if (currentSettings.mode === 'firebase' && CloudDb.isConfigured()) {
          CloudDb.resetTournament(currentSettings.tournamentId)
            .catch(err => console.error("Error resetting remote tournament:", err));
        } else {
          this.renderLocalPlayersManager();
        }
      },
      // Rename player callback
      (id, name) => {
        if (tournament.isStarted) {
          this.saveAndSyncState();
        }
      }
    );
  },

  setupTournamentUI() {
    BracketRenderer.init(
      'bracket-view',
      'match-center-view',
      tournament,
      // Log score click handler
      (matchId) => {
        MatchLogger.open(matchId);
      },
      // Start match handler
      (matchId) => {
        if (App.activeMatchId) {
          alert("A match is already active! Only one match can be active globally at any given moment.");
          return;
        }
        CloudDb.setActiveMatch(currentSettings.tournamentId, matchId)
          .catch(err => console.error("Error setting active match:", err));
      }
    );

    MatchLogger.init(
      'score-logger-modal',
      tournament,
      // Save score callback (now sets verification status)
      (matchId, p1Score, p2Score, isRollback = false) => {
        if (isRollback && matchId) {
          tournament.rollbackMatch(matchId);
          this.saveAndSyncState();
          return;
        }

        if (matchId) {
          const match = tournament.getMatches()[matchId];
          const winnerId = p1Score > p2Score ? match.p1.id : match.p2.id;
          
          // Set verification status in db
          CloudDb.setVerification(currentSettings.tournamentId, matchId, winnerId, p1Score, p2Score)
            .catch(err => console.error("Failed to set verification status:", err));
        }
      }
    );
  },

  saveAndSyncState() {
    const state = tournament.getState();
    
    // Save locally
    if (tournament.isStarted) {
      StorageService.saveTournamentState(state);
    } else {
      StorageService.clearTournamentState();
    }

    // Sync to Firebase
    if (currentSettings.mode === 'firebase' && CloudDb.isConfigured() && !isRemoteUpdating) {
      // Direct state commit (lock release done by cloudDb.commitVerification or admin start)
      CloudDb.commitVerification(currentSettings.tournamentId, state)
        .catch(err => console.error("Error syncing state to Firebase:", err));
    }
  },

  async initializeConnection() {
    const syncDot = document.getElementById('sync-dot');
    const syncText = document.getElementById('sync-text');

    CloudDb.disconnect();

    if (currentSettings.mode === 'firebase') {
      syncDot.className = 'status-dot';
      syncText.textContent = "Connecting to Party Sync...";

      try {
        const isConnected = await CloudDb.initialize(currentSettings.firebaseConfig);
        
        if (isConnected) {
          syncDot.className = 'status-dot active';
          syncText.textContent = `Sync Room: ${currentSettings.tournamentId}`;

          // Secure guest identity lock based on Firebase Auth UID
          if (!isAdmin) {
            guestPlayerId = CloudDb.getUid();
            localStorage.setItem('guest_player_id', guestPlayerId);
          }

          // Subscribe to entire room node
          CloudDb.subscribeToRoom(currentSettings.tournamentId, (roomData) => {
            isRemoteUpdating = true;
            this.handleRoomUpdate(roomData);
            isRemoteUpdating = false;
          }, (error) => {
            console.error("Sync error:", error);
            syncDot.className = 'status-dot';
            syncText.textContent = "Sync disconnected. Offline.";
            this.loadLocalFallback();
          });
        } else {
          syncDot.className = 'status-dot';
          syncText.textContent = "Sync failed. Check credentials.";
          this.loadLocalFallback();
        }
      } catch (err) {
        console.error("Firebase connection error:", err);
        syncDot.className = 'status-dot';
        syncText.textContent = "Sync failed. Check credentials.";
        this.loadLocalFallback();
      }
    } else {
      syncDot.className = 'status-dot local';
      syncText.textContent = "Local Mode (Offline)";
      this.loadLocalFallback();
    }
  },

  loadLocalFallback() {
    // Local mode does not support verification confirmation screens or 2v2 registration grid
    const localState = StorageService.getTournamentState();
    if (localState && localState.isStarted) {
      tournament.loadState(localState);
      this.renderTournamentPanel();
    } else {
      // Local setup defaults to standard player list
      tournament.loadState(null);
      this.renderLocalPlayersManager();
    }
  },

  // --- ROOM STATE ENGINE ---
  handleRoomUpdate(roomData) {
    if (!roomData) {
      if (isAdmin) {
        // Claim ownership of the room immediately
        const adminUid = CloudDb.getUid();
        const localState = StorageService.getTournamentState();
        if (localState && localState.isStarted) {
          // Upload local state to initialize remote database and claim ownership
          CloudDb.initializeRoom(currentSettings.tournamentId, adminUid)
            .then(() => {
              CloudDb.startTournament(
                currentSettings.tournamentId,
                localState.players,
                localState.matches,
                localState.size,
                localState.roundsCount
              );
            })
            .catch(err => console.error("Error initializing room with local state:", err));
        } else {
          CloudDb.initializeRoom(currentSettings.tournamentId, adminUid).catch(err => {
            console.error("Error initializing room ownership:", err);
          });
        }
      } else {
        this.updateTabVisibility(1);
        this.renderPhase1(null);
      }
      return;
    }

    const phase = roomData.phase || 1;
    const activeMatchId = roomData.activeMatchId || null;
    const verifications = roomData.verifications || null;

    this.updateTabVisibility(phase);
    this.activeMatchId = activeMatchId;
    BracketRenderer.setActiveMatchId(activeMatchId);

    if (phase === 2) {
      // Phase 2: Active Bracket
      if (roomData.tournamentState) {
        if (roomData.tournamentState.players) {
          PlayerManager.setPlayers(roomData.tournamentState.players);
        }
        tournament.loadState(roomData.tournamentState);
        
        // Handle tab switching on transition from Phase 1 to Phase 2
        if (this.previousPhase === 1) {
          this.switchTab('tab-bracket');
        }
        this.previousPhase = 2;

        this.renderTournamentPanel();
        
        // Handle full-screen verification modals
        this.checkVerificationOverlays(verifications, roomData.teams);
      }
    } else {
      // Phase 1: Registration
      this.previousPhase = 1;
      this.renderPhase1(roomData);
    }
  },

  // --- PHASE 1 UI REGISTRATION ---
  renderPhase1(roomData) {
    const view = document.getElementById('player-manager-view');
    
    // 1. Check if Identity is Locked
    if (!guestPlayerId) {
      view.innerHTML = `
        <div class="glass-card" style="max-width: 450px; margin: 0 auto; text-align: center;">
          <h2>Enter Your Name</h2>
          <p class="description">Welcome to the pool party! Enter your name once to register and find a 2v2 partner.</p>
          <div class="form-group">
            <input type="text" id="reg-name" placeholder="E.g. Captain Pool" autocomplete="off" style="width: 100%; text-align: center;">
          </div>
          <button id="btn-submit-registration" class="btn btn-primary" style="width: 100%;">Register & Join Lobby</button>
        </div>
      `;

      document.getElementById('btn-submit-registration').addEventListener('click', () => {
        const nameInput = document.getElementById('reg-name');
        const name = nameInput.value.trim();
        if (!name) return;

        guestPlayerId = CloudDb.isConfigured() ? CloudDb.getUid() : `g-${Date.now()}`;
        guestPlayerName = name;
        localStorage.setItem('guest_player_id', guestPlayerId);
        localStorage.setItem('guest_player_name', name);

        CloudDb.registerPlayer(currentSettings.tournamentId, guestPlayerId, name);
      });
      return;
    }

    // If guest is not in unassigned list and not in any team, their registration is gone (kicked, deleted, or reset).
    // Prompt them to register a name again.
    if (!isAdmin && guestPlayerId && !unassigned[guestPlayerId] && !isPlayerInTeam) {
      guestPlayerId = null;
      guestPlayerName = null;
      localStorage.removeItem('guest_player_id');
      localStorage.removeItem('guest_player_name');
      this.renderPhase1(roomData);
      return;
    }

    // 2. Render invitation state triggers
    const invitations = roomData?.invitations || {};
    this.checkInvitationOverlays(invitations);

    // 3. Calculate Player Counts
    const teamList = Object.values(teams);
    const playerList = Object.values(unassigned);
    const totalUnassigned = playerList.length;
    const totalInTeams = teamList.reduce((sum, t) => sum + (t.players ? t.players.length : 0), 0);
    const totalPlayers = totalUnassigned + totalInTeams;

    // 4. Render Guest Waiting Screen (if guest is in a team)
    if (!isAdmin && isPlayerInTeam) {
      const myTeam = teamList.find(t => t.players.some(p => p.id === guestPlayerId));
      const myTeamName = myTeam ? myTeam.name : "";

      view.innerHTML = `
        <div class="player-manager-card glass-card" style="max-width: 600px; margin: 0 auto; text-align: center;">
          <div class="waiting-spinner"></div>
          <h2>Lobby Finalized</h2>
          <p class="description" style="color: var(--neon-blue); font-weight: 600; font-size: 1.1rem; margin-bottom: 1.5rem;">
            Waiting for host to finalize bracket... ${totalPlayers} players registered.
          </p>
          
          <div style="background: rgba(0, 0, 0, 0.2); border: 1px solid var(--glass-border); border-radius: 12px; padding: 1.5rem; margin-bottom: 2rem;">
            <h3 style="color: var(--neon-purple); margin-bottom: 0.5rem; font-size: 1rem; text-transform: uppercase; letter-spacing: 0.5px;">Your Team</h3>
            <span style="font-size: 1.4rem; font-weight: 700; color: var(--color-text);">${escapeHTML(myTeamName)}</span>
          </div>

          <div class="lobby-column" style="text-align: left;">
            <div class="roster-header">
              <h3 style="color: var(--color-muted); font-size: 0.95rem;">All Formed Teams (${teamList.length})</h3>
            </div>
            <ul class="teams-roster-list" style="max-height: 250px;">
              ${teamList.map(t => `
                <li class="roster-item" style="padding: 0.6rem 1rem;">
                  <span class="roster-name" style="${t.id === myTeam?.id ? 'color: var(--neon-blue); font-weight: 700;' : 'color: var(--color-text);'}">${escapeHTML(t.name)}</span>
                  ${t.id === myTeam?.id ? '<span style="font-size: 0.8rem; color: var(--neon-blue); font-weight: 600;">You</span>' : '<span style="font-size: 0.8rem; color: var(--color-muted);">Ready</span>'}
                </li>
              `).join('')}
            </ul>
          </div>
        </div>
      `;
      return;
    }

    // 5. Render standard Partner Selection Lobby Dashboard
    view.innerHTML = `
      <div class="player-manager-card glass-card">
        <h2>Roster & Team Lobby</h2>
        <p class="description">Room Name: <strong>${escapeHTML(currentSettings.tournamentId)}</strong></p>

        <div class="registration-grid">
          <!-- Unassigned guests column -->
          <div class="lobby-column">
            <div class="roster-header">
              <h3>Unassigned Guests (${playerList.length})</h3>
              ${isAdmin ? `<button id="btn-add-ghost" class="btn-sm btn-solo">Add Ghost Player</button>` : ''}
            </div>
            <ul class="guest-roster-list">
              ${playerList.length === 0 ? '<li class="empty-list">All guests have teams!</li>' : ''}
              ${playerList.map(p => {
                const isMe = p.id === guestPlayerId;
                let actionsHTML = '';
                
                if (isAdmin) {
                  const isPending = App.pendingPairPlayerId === p.id;
                  actionsHTML = `
                    <button class="btn-sm btn-invite btn-action-pair ${isPending ? 'btn-pending' : ''}" data-id="${p.id}" data-name="${escapeHTML(p.name)}" ${isPending ? 'style="background: #e67e22; color: #fff; border-color: #d35400 !important;"' : ''}>
                      ${isPending ? 'Cancel' : 'Pair'}
                    </button>
                    <button class="btn-sm btn-solo btn-action-solo" data-id="${p.id}" data-name="${escapeHTML(p.name)}">Make Solo</button>
                    <button class="btn-sm btn-remove btn-action-remove" data-id="${p.id}">&times; Remove</button>
                  `;
                } else if (!isMe) {
                  actionsHTML = `<button class="btn-sm btn-invite btn-action-invite" data-id="${p.id}" data-name="${escapeHTML(p.name)}">Invite to Team</button>`;
                } else {
                  actionsHTML = `<span style="font-size: 0.8rem; color: var(--neon-blue);">You</span>`;
                }

                return `
                  <li class="roster-item" style="padding: ${isAdmin ? '0.4rem 0.75rem' : '0.75rem 1rem'}">
                    ${isAdmin ? `
                      <input type="text" class="player-name-input-lobby" value="${escapeHTML(p.name)}" data-id="${p.id}" style="flex: 1; background: transparent; border: none; color: var(--color-text); font-weight: 500; padding: 0.35rem 0; font-size: 0.95rem; outline: none; margin-right: 0.5rem;">
                    ` : `
                      <span class="roster-name">${escapeHTML(p.name)}</span>
                    `}
                    <div class="roster-actions">${actionsHTML}</div>
                  </li>
                `;
              }).join('')}
            </ul>
          </div>

          <!-- Teams column -->
          <div class="lobby-column">
            <div class="roster-header">
              <h3>Finalized Teams (${teamList.length})</h3>
            </div>
            <ul class="teams-roster-list">
              ${teamList.length === 0 ? '<li class="empty-list">No teams formed yet.</li>' : ''}
              ${teamList.map(t => {
                let actionsHTML = '';
                if (isAdmin) {
                  actionsHTML = `
                    <button class="btn-sm btn-remove btn-action-dissolve" data-id="${t.id}">&times; Dissolve</button>
                  `;
                }
                
                return `
                  <li class="roster-item" style="padding: ${isAdmin ? '0.4rem 0.75rem' : '0.75rem 1rem'}">
                    ${isAdmin ? `
                      <input type="text" class="team-name-input" value="${escapeHTML(t.name)}" data-id="${t.id}" style="flex: 1; background: transparent; border: none; color: var(--neon-purple); font-weight: 600; padding: 0.35rem 0; font-size: 0.95rem; outline: none; margin-right: 0.5rem;">
                    ` : `
                      <span class="roster-name" style="color: var(--neon-purple);">${escapeHTML(t.name)}</span>
                    `}
                    <div class="roster-actions">${actionsHTML}</div>
                  </li>
                `;
              }).join('')}
            </ul>
          </div>
        </div>

        <div class="manager-actions">
          ${isAdmin ? `
            <button id="btn-lock-bracket" class="btn btn-success" ${teamList.length < 2 ? 'disabled' : ''}>
              Lock Teams & Start Tournament (${teamList.length} Teams)
            </button>
          ` : `
            <div class="active-banner" style="background: rgba(102, 252, 241, 0.05); border-color: rgba(102, 252, 241, 0.15);">
              <span class="pulse-dot"></span>
              <span>Waiting for host to finalize bracket... ${totalPlayers} players registered.</span>
            </div>
          `}
        </div>
      </div>
    `;

    this.bindPhase1Events(playerList, teamList, roomData);
  },

  bindPhase1Events(playerList, teamList, roomData) {
    // Clone node to clear accumulated event listeners
    const oldView = document.getElementById('player-manager-view');
    const view = oldView.cloneNode(true);
    oldView.parentNode.replaceChild(view, oldView);

    // Admin tools
    const btnGhost = view.querySelector('#btn-add-ghost');
    if (btnGhost) {
      btnGhost.addEventListener('click', () => {
        CloudDb.addGhostPlayer(currentSettings.tournamentId);
      });
    }

    const btnLock = view.querySelector('#btn-lock-bracket');
    if (btnLock) {
      btnLock.addEventListener('click', () => {
        if (teamList.length < 2) return;
        
        // Initialize bracket layout local engine
        tournament.initialize(teamList);
        const state = tournament.getState();
        
        // Commit start to database
        CloudDb.startTournament(
          currentSettings.tournamentId,
          state.players,
          state.matches,
          state.size,
          state.roundsCount
        ).catch(err => console.error("Error starting tournament:", err));
      });
    }

    // List button delegation
    view.addEventListener('click', (e) => {
      // Pair Player Click
      const btnPair = e.target.closest('.btn-action-pair');
      if (btnPair) {
        const id = btnPair.getAttribute('data-id');
        const name = btnPair.getAttribute('data-name');
        
        if (App.pendingPairPlayerId === null) {
          App.pendingPairPlayerId = id;
          this.renderPhase1(roomData);
        } else if (App.pendingPairPlayerId === id) {
          App.pendingPairPlayerId = null;
          this.renderPhase1(roomData);
        } else {
          const p1Id = App.pendingPairPlayerId;
          const playerA = playerList.find(p => p.id === p1Id);
          if (playerA) {
            CloudDb.pairPlayers(currentSettings.tournamentId, p1Id, playerA.name, id, name)
              .catch(err => console.error("Error manual pairing players:", err));
          }
          App.pendingPairPlayerId = null;
        }
        return;
      }

      // Invite to team click
      const btnInvite = e.target.closest('.btn-action-invite');
      if (btnInvite) {
        const toId = btnInvite.getAttribute('data-id');
        const toName = btnInvite.getAttribute('data-name');
        CloudDb.sendInvitation(currentSettings.tournamentId, guestPlayerId, guestPlayerName, toId, toName)
          .catch(err => console.error("Error sending invitation:", err));
        return;
      }

      // Solo Team Click
      const btnSolo = e.target.closest('.btn-action-solo');
      if (btnSolo) {
        const id = btnSolo.getAttribute('data-id');
        const name = btnSolo.getAttribute('data-name');
        CloudDb.makeSoloTeam(currentSettings.tournamentId, id, name)
          .catch(err => console.error("Error making solo team:", err));
        return;
      }

      // Remove Player Click
      const btnRemove = e.target.closest('.btn-action-remove');
      if (btnRemove) {
        const id = btnRemove.getAttribute('data-id');
        CloudDb.removePlayer(currentSettings.tournamentId, id)
          .catch(err => console.error("Error removing player:", err));
        return;
      }

      // Dissolve Team Click
      const btnDissolve = e.target.closest('.btn-action-dissolve');
      if (btnDissolve) {
        const teamId = btnDissolve.getAttribute('data-id');
        const team = teamList.find(t => t.id === teamId);
        if (team && team.players) {
          CloudDb.dissolveTeam(currentSettings.tournamentId, teamId, team.players)
            .catch(err => console.error("Error dissolving team:", err));
        }
      }
    });

    // List change delegation for inline renaming
    view.addEventListener('change', (e) => {
      // Rename Unassigned Player
      if (e.target.classList.contains('player-name-input-lobby')) {
        const id = e.target.getAttribute('data-id');
        const newName = e.target.value.trim();
        if (!newName) return;
        
        CloudDb.renameUnassignedPlayer(currentSettings.tournamentId, id, newName)
          .catch(err => console.error("Error renaming player:", err));
      }
      
      // Rename Finalized Team
      if (e.target.classList.contains('team-name-input')) {
        const id = e.target.getAttribute('data-id');
        const newName = e.target.value.trim();
        if (!newName) return;
        
        CloudDb.renameTeam(currentSettings.tournamentId, id, newName)
          .catch(err => console.error("Error renaming team:", err));
      }
    });

    // Handle pressing Enter to commit renaming changes instantly
    view.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (e.target.classList.contains('player-name-input-lobby') || e.target.classList.contains('team-name-input')) {
          e.target.blur(); // Triggers the 'change' event
        }
      }
    });
  },

  // --- SELF HEALING INVITATIONS CODES ---
  checkInvitationOverlays(invitations) {
    const overlay = document.getElementById('fullscreen-overlay-container');
    
    // Find incoming invitation to me
    const incoming = Object.values(invitations).find(i => i.toId === guestPlayerId && i.status === 'pending');
    if (incoming) {
      overlay.innerHTML = `
        <div class="fullscreen-overlay">
          <div class="overlay-card glass-card">
            <h2>Accept Partner?</h2>
            <p><strong>${escapeHTML(incoming.fromName)}</strong> has invited you to form a 2v2 team!</p>
            <div class="overlay-actions">
              <button id="btn-decline-invite" class="btn btn-danger">Decline</button>
              <button id="btn-accept-invite" class="btn btn-success">Accept & Team Up</button>
            </div>
          </div>
        </div>
      `;
      overlay.classList.remove('hidden');

      document.getElementById('btn-decline-invite').addEventListener('click', () => {
        CloudDb.declineInvitation(currentSettings.tournamentId, incoming.id);
        overlay.classList.add('hidden');
      });

      document.getElementById('btn-accept-invite').addEventListener('click', () => {
        CloudDb.acceptInvitation(currentSettings.tournamentId, incoming.id, incoming.fromId, incoming.fromName, incoming.toId, incoming.toName);
        overlay.classList.add('hidden');
      });
      return;
    }

    // Find outgoing pending invite from me
    const outgoing = Object.values(invitations).find(i => i.fromId === guestPlayerId && i.status === 'pending');
    if (outgoing) {
      overlay.innerHTML = `
        <div class="fullscreen-overlay">
          <div class="overlay-card glass-card">
            <div class="waiting-spinner"></div>
            <h2>Waiting for Partner</h2>
            <p>Waiting for <strong>${escapeHTML(outgoing.toName)}</strong> to accept your invitation...</p>
            <button id="btn-cancel-invite" class="btn btn-danger" style="width:100%;">Cancel Invitation</button>
          </div>
        </div>
      `;
      overlay.classList.remove('hidden');

      document.getElementById('btn-cancel-invite').addEventListener('click', () => {
        CloudDb.deleteInvitation(currentSettings.tournamentId, outgoing.id);
        overlay.classList.add('hidden');
      });
      return;
    }

    // Clean up declined notification alerts
    const declined = Object.values(invitations).find(i => i.fromId === guestPlayerId && i.status === 'declined');
    if (declined) {
      alert(`${declined.toName} declined your partner invitation.`);
      CloudDb.deleteInvitation(currentSettings.tournamentId, declined.id);
    }

    overlay.classList.add('hidden');
    overlay.innerHTML = '';
  },

  // --- DUAL CONFIRMATION VERIFICATION OVERLAY ---
  checkVerificationOverlays(verifications, teams) {
    const overlay = document.getElementById('fullscreen-overlay-container');
    if (!verifications) {
      overlay.classList.add('hidden');
      overlay.innerHTML = '';
      return;
    }

    const matchId = verifications.matchId;
    const match = tournament.getMatches()[matchId];
    if (!match) return;

    // Check if current guest is playing in this match
    const p1Team = teams[match.p1.id];
    const p2Team = teams[match.p2.id];
    
    const isP1Team = p1Team?.players.some(p => p.id === guestPlayerId) || false;
    const isP2Team = p2Team?.players.some(p => p.id === guestPlayerId) || false;
    const isParticipant = isP1Team || isP2Team;

    if (!isParticipant && !isAdmin) {
      // regular guests not in the match see no overlay, just locked cards in bracket
      overlay.classList.add('hidden');
      overlay.innerHTML = '';
      return;
    }

    // Collect names of winner and scores
    const winningTeamName = verifications.winnerId === match.p1.id ? p1Team.name : p2Team.name;
    const p1Score = verifications.p1Score;
    const p2Score = verifications.p2Score;

    // Build the confirmations list
    const confirmations = verifications.confirmations || {};
    
    const renderPlayerRow = (p) => {
      const isGhost = p.isGhost || p.id.startsWith('ghost-') || p.id === 'bye';
      const confirmed = confirmations[p.id] === true || isGhost;
      return `
        <div class="verification-player-row">
          <span>${escapeHTML(p.name)}</span>
          <span class="player-status-badge ${confirmed ? 'status-confirmed' : 'status-waiting'}">
            ${confirmed ? (isGhost ? 'Ghost Ready' : 'Confirmed') : 'Waiting...'}
          </span>
        </div>
      `;
    };

    let overrideButtonHTML = '';
    if (isAdmin) {
      overrideButtonHTML = `
        <button id="btn-force-approve" class="btn btn-warning" style="width: 100%; margin-top: 1rem;">
          Force Approve Result (Host Override)
        </button>
      `;
    }

    let actionButtonHTML = '';
    if (isParticipant && !confirmations[guestPlayerId]) {
      actionButtonHTML = `
        <button id="btn-confirm-score" class="btn btn-success" style="width: 100%;">
          Confirm Result
        </button>
      `;
    } else if (isParticipant) {
      actionButtonHTML = `<p style="color: var(--color-success); font-weight: 600;">Your confirmation registered. Waiting for opponent...</p>`;
    }

    overlay.innerHTML = `
      <div class="fullscreen-overlay">
        <div class="overlay-card glass-card" style="max-width: 480px;">
          <h2>Confirm Match Result</h2>
          <p class="description" style="font-size: 1.25rem; font-weight: 700; color: var(--neon-blue); margin-bottom: 1rem;">
            Did <strong>${escapeHTML(winningTeamName)}</strong> win?
          </p>
          <p style="margin-bottom: 1.5rem;">Logged score: <strong>${escapeHTML(p1Team.name)} ${p1Score} - ${p2Score} ${escapeHTML(p2Team.name)}</strong></p>

          <div class="verification-status-list">
            <h4 style="border-bottom: 1px solid var(--glass-border); padding-bottom: 0.25rem; margin-bottom: 0.5rem;">${escapeHTML(p1Team.name)}</h4>
            ${p1Team.players.map(p => renderPlayerRow(p)).join('')}
            
            <h4 style="border-bottom: 1px solid var(--glass-border); padding-bottom: 0.25rem; margin-bottom: 0.5rem; margin-top: 1rem;">${escapeHTML(p2Team.name)}</h4>
            ${p2Team.players.map(p => renderPlayerRow(p)).join('')}
          </div>

          ${actionButtonHTML}
          ${overrideButtonHTML}
        </div>
      </div>
    `;
    overlay.classList.remove('hidden');

    // Confirm button event
    const btnConfirm = document.getElementById('btn-confirm-score');
    if (btnConfirm) {
      btnConfirm.addEventListener('click', () => {
        CloudDb.confirmVerification(currentSettings.tournamentId, guestPlayerId)
          .then(() => {
            // Trigger check to see if we now meet verification requirements
            this.evaluateVerificationStatus(verifications, p1Team, p2Team);
          })
          .catch(err => console.error("Error confirming result:", err));
      });
    }

    // Force approve event
    const btnForce = document.getElementById('btn-force-approve');
    if (btnForce) {
      btnForce.addEventListener('click', () => {
        this.executeForceApprove(matchId, p1Score, p2Score);
      });
    }

    // Automatically evaluate status on guest side in case it is complete
    this.evaluateVerificationStatus(verifications, p1Team, p2Team);
  },

  evaluateVerificationStatus(verifications, p1Team, p2Team) {
    const confirmations = verifications.confirmations || {};
    
    const isGhostPlayer = (p) => {
      return p.isGhost || p.id.startsWith('ghost-') || p.id === 'bye';
    };

    // Check if at least 1 player from P1 Team has confirmed (or if all are ghosts)
    const p1Confirmed = p1Team.players.some(p => confirmations[p.id] === true) || 
                        p1Team.players.every(p => isGhostPlayer(p));
                        
    // Check if at least 1 player from P2 Team has confirmed (or if all are ghosts)
    const p2Confirmed = p2Team.players.some(p => confirmations[p.id] === true) || 
                        p2Team.players.every(p => isGhostPlayer(p));

    if (p1Confirmed && p2Confirmed) {
      // The condition is met!
      // To prevent multiple writers clobbering, we let the currently logged-in player trigger it
      // or if Admin is online, they can execute it. 
      // Let's let the confirming client run it (as it uses the atomic commitVerification path).
      if (confirmations[guestPlayerId] === true || isAdmin) {
        this.executeVerificationCommit(verifications.matchId, verifications.p1Score, verifications.p2Score);
      }
    }
  },

  executeVerificationCommit(matchId, p1Score, p2Score) {
    try {
      tournament.logMatchResult(matchId, p1Score, p2Score);
      const state = tournament.getState();
      
      // Push state commit
      CloudDb.commitVerification(currentSettings.tournamentId, state)
        .catch(err => console.error("Error committing verification:", err));
    } catch (e) {
      console.error("Verification commit error:", e);
    }
  },

  executeForceApprove(matchId, p1Score, p2Score) {
    try {
      tournament.logMatchResult(matchId, p1Score, p2Score);
      const state = tournament.getState();
      
      CloudDb.forceApproveVerification(currentSettings.tournamentId, state)
        .catch(err => console.error("Error force approving verification:", err));
    } catch (e) {
      console.error("Force approve error:", e);
    }
  },

  // --- TRANSITION UI TO BRACKET PANELS ---
  renderTournamentPanel() {
    // Start view
    PlayerManager.setTournamentActive(true);
    
    // Check if user is on players tab, if so, push them to Match Center!
    const activeTab = document.querySelector('.tab-btn.active').getAttribute('data-tab');
    if (activeTab === 'tab-players') {
      this.switchTab('tab-center');
    }

    this.renderTournament();
  },

  renderLocalPlayersManager() {
    PlayerManager.setTournamentActive(false);
    PlayerManager.render();
  },

  renderTournament() {
    BracketRenderer.render();
    
    const resultsView1 = document.getElementById('tournament-results-view');
    const resultsView2 = document.getElementById('bracket-results-view');
    const rankingsCont1 = document.getElementById('rankings-container');
    const rankingsCont2 = document.getElementById('bracket-rankings-container');

    if (tournament.isStarted && tournament.isFinished()) {
      const rankings = tournament.getRankings();
      const rankingsHTML = `
        <ul class="rankings-list">
          ${rankings.map(r => `
            <li class="rank-item">
              <span class="rank-number">${r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : `#${r.rank}`}</span>
              <span class="rank-name">${escapeHTML(r.name)}</span>
            </li>
          `).join('')}
        </ul>
      `;

      rankingsCont1.innerHTML = rankingsHTML;
      rankingsCont2.innerHTML = rankingsHTML;
      resultsView1.classList.remove('hidden');
      resultsView2.classList.remove('hidden');
    } else {
      resultsView1.classList.add('hidden');
      resultsView2.classList.add('hidden');
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
