import { initializeApp, deleteApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getDatabase, ref, set, onValue, off, update, remove } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';

let app = null;
let db = null;
let listeners = {};

export const CloudDb = {
  isConfigured() {
    return app !== null;
  },

  initialize(config) {
    if (app) {
      this.disconnect();
    }
    if (!config || !config.apiKey || !config.databaseURL) {
      return false;
    }
    try {
      app = initializeApp(config, "party-tournament-app-" + Date.now());
      db = getDatabase(app);
      return true;
    } catch (e) {
      console.error("Firebase initialization failed:", e);
      app = null;
      db = null;
      return false;
    }
  },

  disconnect() {
    // Turn off all active listeners
    for (const path in listeners) {
      if (listeners[path].ref && listeners[path].listener) {
        off(listeners[path].ref, 'value', listeners[path].listener);
      }
    }
    listeners = {};

    if (app) {
      deleteApp(app).catch(err => console.error("Error deleting Firebase app:", err));
    }
    app = null;
    db = null;
  },

  async testConnection(config) {
    let testApp = null;
    try {
      testApp = initializeApp(config, "test-instance-" + Date.now());
      const testDb = getDatabase(testApp);
      const testRef = ref(testDb, `test-connection/${Date.now()}`);
      await set(testRef, { status: "success", timestamp: Date.now() });
      return true;
    } catch (e) {
      console.error("Firebase connection test failed:", e);
      return false;
    } finally {
      if (testApp) {
        try {
          await deleteApp(testApp);
        } catch (err) {
          console.error("Error deleting test Firebase app:", err);
        }
      }
    }
  },

  // --- ROOM ROOT SUBSCRIPTION ---
  subscribeToRoom(roomId, onDataCallback, onErrorCallback) {
    if (!db) return;
    const roomRef = ref(db, `rooms/${roomId}`);
    
    // Detach previous listener if any
    const listenerKey = `rooms/${roomId}`;
    if (listeners[listenerKey]) {
      off(listeners[listenerKey].ref, 'value', listeners[listenerKey].listener);
    }

    const listener = onValue(roomRef, (snapshot) => {
      onDataCallback(snapshot.val());
    }, (error) => {
      console.error("Firebase room read error:", error);
      if (onErrorCallback) onErrorCallback(error);
    });

    listeners[listenerKey] = { ref: roomRef, listener };
  },

  // --- PHASE 1 METHODS ---
  async registerPlayer(roomId, playerId, playerName) {
    if (!db) return;
    const playerRef = ref(db, `rooms/${roomId}/unassigned_players/${playerId}`);
    return set(playerRef, { id: playerId, name: playerName });
  },

  async removePlayer(roomId, playerId) {
    if (!db) return;
    const playerRef = ref(db, `rooms/${roomId}/unassigned_players/${playerId}`);
    return remove(playerRef);
  },

  async addGhostPlayer(roomId) {
    if (!db) return;
    const ghostId = `ghost-${Date.now()}`;
    const playerRef = ref(db, `rooms/${roomId}/unassigned_players/${ghostId}`);
    return set(playerRef, { id: ghostId, name: "Ghost Player", isGhost: true });
  },

  async makeSoloTeam(roomId, playerId, playerName) {
    if (!db) return;
    const teamId = `team-${Date.now()}`;
    const updates = {};
    
    // Remove from unassigned
    updates[`rooms/${roomId}/unassigned_players/${playerId}`] = null;
    
    // Create solo team
    updates[`rooms/${roomId}/teams/${teamId}`] = {
      id: teamId,
      name: `${playerName} (Solo)`,
      players: [{ id: playerId, name: playerName }]
    };

    return update(ref(db), updates);
  },

  async sendInvitation(roomId, fromId, fromName, toId, toName) {
    if (!db) return;
    const invId = `${fromId}_${toId}`;
    const invRef = ref(db, `rooms/${roomId}/invitations/${invId}`);
    return set(invRef, {
      id: invId,
      fromId,
      fromName,
      toId,
      toName,
      status: 'pending',
      timestamp: Date.now()
    });
  },

  async acceptInvitation(roomId, invId, fromId, fromName, toId, toName) {
    if (!db) return;
    const teamId = `team-${Date.now()}`;
    const updates = {};

    // Remove both players from unassigned
    updates[`rooms/${roomId}/unassigned_players/${fromId}`] = null;
    updates[`rooms/${roomId}/unassigned_players/${toId}`] = null;

    // Delete the invitation
    updates[`rooms/${roomId}/invitations/${invId}`] = null;

    // Create 2-player team
    updates[`rooms/${roomId}/teams/${teamId}`] = {
      id: teamId,
      name: `${fromName} & ${toName}`,
      players: [
        { id: fromId, name: fromName },
        { id: toId, name: toName }
      ]
    };

    return update(ref(db), updates);
  },

  async declineInvitation(roomId, invId) {
    if (!db) return;
    const invRef = ref(db, `rooms/${roomId}/invitations/${invId}`);
    return update(invRef, { status: 'declined' });
  },

  async deleteInvitation(roomId, invId) {
    if (!db) return;
    const invRef = ref(db, `rooms/${roomId}/invitations/${invId}`);
    return remove(invRef);
  },

  // --- PHASE 2 METHODS ---
  async startTournament(roomId, teams, matches, size, roundsCount) {
    if (!db) return;
    
    const updates = {};
    updates[`rooms/${roomId}/phase`] = 2;
    updates[`rooms/${roomId}/tournamentState`] = {
      players: teams,
      matches: matches,
      isStarted: true,
      size: size,
      roundsCount: roundsCount
    };
    updates[`rooms/${roomId}/activeMatchId`] = null;
    updates[`rooms/${roomId}/verifications`] = null;
    
    // Clear out setup items
    updates[`rooms/${roomId}/unassigned_players`] = null;
    updates[`rooms/${roomId}/invitations`] = null;

    return update(ref(db), updates);
  },

  async resetTournament(roomId) {
    if (!db) return;
    const roomRef = ref(db, `rooms/${roomId}`);
    return set(roomRef, null);
  },

  async setActiveMatch(roomId, matchId) {
    if (!db) return;
    const activeRef = ref(db, `rooms/${roomId}/activeMatchId`);
    return set(activeRef, matchId);
  },

  async setVerification(roomId, matchId, winnerId, p1Score, p2Score) {
    if (!db) return;
    
    const updates = {};
    // Set match status to PENDING_VERIFICATION locally in tournamentState
    updates[`rooms/${roomId}/tournamentState/matches/${matchId}/status`] = 'pending_verification';
    updates[`rooms/${roomId}/tournamentState/matches/${matchId}/p1Score`] = p1Score;
    updates[`rooms/${roomId}/tournamentState/matches/${matchId}/p2Score`] = p2Score;
    
    // Set verification node
    updates[`rooms/${roomId}/verifications`] = {
      matchId,
      winnerId,
      p1Score,
      p2Score,
      confirmations: {}
    };

    return update(ref(db), updates);
  },

  async dissolveTeam(roomId, teamId, players) {
    if (!db) return;
    const updates = {};
    updates[`rooms/${roomId}/teams/${teamId}`] = null;
    players.forEach(p => {
      updates[`rooms/${roomId}/unassigned_players/${p.id}`] = {
        id: p.id,
        name: p.name,
        isGhost: p.isGhost || p.id.startsWith('ghost-') || false
      };
    });
    return update(ref(db), updates);
  },

  async renameUnassignedPlayer(roomId, playerId, newName) {
    if (!db) return;
    const playerRef = ref(db, `rooms/${roomId}/unassigned_players/${playerId}/name`);
    return set(playerRef, newName);
  },

  async renameTeam(roomId, teamId, newName) {
    if (!db) return;
    const teamRef = ref(db, `rooms/${roomId}/teams/${teamId}/name`);
    return set(teamRef, newName);
  },

  async confirmVerification(roomId, playerId) {
    if (!db) return;
    const confirmRef = ref(db, `rooms/${roomId}/verifications/confirmations/${playerId}`);
    return set(confirmRef, true);
  },

  async commitVerification(roomId, tournamentState) {
    if (!db) return;
    
    const updates = {};
    updates[`rooms/${roomId}/tournamentState`] = tournamentState;
    updates[`rooms/${roomId}/activeMatchId`] = null;
    updates[`rooms/${roomId}/verifications`] = null;

    return update(ref(db), updates);
  },

  async forceApproveVerification(roomId, tournamentState) {
    return this.commitVerification(roomId, tournamentState);
  }
};
