import { BaseTournament } from './baseTournament.js';

export class DoubleElimination extends BaseTournament {
  constructor() {
    super();
    this.players = [];      // List of active real players: { id, name, seed }
    this.matches = {};      // Map of matchId -> matchObject
    this.playerMap = {};    // Quick lookup id -> player
    this.isStarted = false;
    this.size = 0;          // Power of 2 bracket size
    this.roundsCount = { winners: 0, losers: 0 };
  }

  initialize(players) {
    this.players = players.map((p, idx) => ({
      id: p.id || `p-${Date.now()}-${idx}`,
      name: p.name,
      seed: p.seed || (idx + 1)
    }));
    
    this.playerMap = {};
    this.players.forEach(p => {
      this.playerMap[p.id] = p;
    });

    const N = this.players.length;
    if (N < 2) {
      throw new Error("Double elimination requires at least 2 players.");
    }

    // Determine next power of 2
    let P = 1;
    while (P < N) {
      P *= 2;
    }
    this.size = P;

    const k = Math.log2(P);
    this.roundsCount.winners = k;
    this.roundsCount.losers = P > 2 ? 2 * k - 2 : 0;

    this.matches = {};
    this.generateBracketStructure(P, k);
    this.fillInitialSeeds(P);
    this.isStarted = true;

    // Propagate byes immediately
    this.propagateByes();
  }

  getState() {
    return {
      players: this.players,
      matches: this.matches,
      isStarted: this.isStarted,
      size: this.size,
      roundsCount: this.roundsCount
    };
  }

  loadState(state) {
    if (!state) return;
    this.players = state.players || [];
    this.matches = state.matches || {};
    this.isStarted = state.isStarted || false;
    this.size = state.size || 0;
    this.roundsCount = state.roundsCount || { winners: 0, losers: 0 };

    this.playerMap = {};
    this.players.forEach(p => {
      this.playerMap[p.id] = p;
    });
  }

  getPlayers() {
    return this.players;
  }

  getMatches() {
    return this.matches;
  }

  // Bracket Structure Generation
  generateBracketStructure(P, k) {
    // 1. Winners Bracket
    for (let r = 1; r <= k; r++) {
      const matchCount = P / Math.pow(2, r);
      for (let i = 1; i <= matchCount; i++) {
        const matchId = `w-${r}-${i}`;
        const nextMatchIdWinner = (r === k) ? 'gf-1-1' : `w-${r+1}-${Math.ceil(i/2)}`;
        
        let nextMatchIdLoser = null;
        if (P === 2) {
          nextMatchIdLoser = 'gf-1-1';
        } else if (r === 1) {
          nextMatchIdLoser = `l-1-${Math.ceil(i/2)}`;
        } else {
          nextMatchIdLoser = `l-${2*r - 2}-${i}`;
        }

        this.matches[matchId] = this.createMatchObject(matchId, nextMatchIdWinner, nextMatchIdLoser);
      }
    }

    // 2. Losers Bracket
    if (P > 2) {
      const losersRounds = 2 * k - 2;
      for (let lr = 1; lr <= losersRounds; lr++) {
        const m = Math.ceil(lr / 2);
        const matchCount = P / Math.pow(2, m + 1);

        for (let i = 1; i <= matchCount; i++) {
          const matchId = `l-${lr}-${i}`;
          
          let nextMatchIdWinner = null;
          if (lr === losersRounds) {
            nextMatchIdWinner = 'gf-1-1';
          } else if (lr % 2 === 1) { // Odd round
            nextMatchIdWinner = `l-${lr+1}-${i}`;
          } else { // Even round
            nextMatchIdWinner = `l-${lr+1}-${Math.ceil(i/2)}`;
          }

          this.matches[matchId] = this.createMatchObject(matchId, nextMatchIdWinner, null);
        }
      }
    }

    // 3. Grand Finals
    this.matches['gf-1-1'] = this.createMatchObject('gf-1-1', null, null);
  }

  createMatchObject(id, nextWinner, nextLoser) {
    return {
      id,
      p1: null,
      p2: null,
      p1Score: null,
      p2Score: null,
      winnerId: null,
      loserId: null,
      status: 'pending', // pending, scheduled, completed, bye
      nextMatchIdWinner: nextWinner,
      nextMatchIdLoser: nextLoser
    };
  }

  // Fills Round 1 Winners with players and byes
  fillInitialSeeds(P) {
    const seeding = this.getSeedingOrder(P);
    const N = this.players.length;

    const seededList = seeding.map(seed => {
      if (seed <= N) {
        return this.players[seed - 1];
      } else {
        return { id: 'bye', name: 'BYE', isBye: true };
      }
    });

    const round1Count = P / 2;
    for (let i = 1; i <= round1Count; i++) {
      const match = this.matches[`w-1-${i}`];
      match.p1 = seededList[2*i - 2];
      match.p2 = seededList[2*i - 1];
      match.status = 'scheduled';
    }
  }

  getSeedingOrder(size) {
    let order = [1, 2];
    while (order.length < size) {
      const nextOrder = [];
      const target = order.length * 2 + 1;
      for (const seed of order) {
        nextOrder.push(seed);
        nextOrder.push(target - seed);
      }
      order = nextOrder;
    }
    return order;
  }

  // Recursive BYE propagation
  propagateByes() {
    let changed = false;

    for (const matchId in this.matches) {
      const match = this.matches[matchId];
      if (match.status !== 'pending' && match.status !== 'scheduled') {
        continue;
      }

      // Check if both players are present
      if (!match.p1 || !match.p2) {
        continue;
      }

      const p1Bye = match.p1.isBye;
      const p2Bye = match.p2.isBye;

      if (p1Bye && p2Bye) {
        // Both are BYEs, match is auto-resolved as BYE
        match.winnerId = 'bye';
        match.loserId = 'bye';
        match.p1Score = 0;
        match.p2Score = 0;
        match.status = 'bye';
        this.advancePlayer(matchId, 'bye', 'bye');
        changed = true;
      } else if (p1Bye) {
        // P1 is BYE, P2 advances
        match.winnerId = match.p2.id;
        match.loserId = 'bye';
        match.p1Score = 0;
        match.p2Score = 1;
        match.status = 'bye';
        this.advancePlayer(matchId, match.p2.id, 'bye');
        changed = true;
      } else if (p2Bye) {
        // P2 is BYE, P1 advances
        match.winnerId = match.p1.id;
        match.loserId = 'bye';
        match.p1Score = 1;
        match.p2Score = 0;
        match.status = 'bye';
        this.advancePlayer(matchId, match.p1.id, 'bye');
        changed = true;
      } else {
        // Both are real players, ensure it is scheduled
        if (match.status === 'pending') {
          match.status = 'scheduled';
          changed = true;
        }
      }
    }

    if (changed) {
      this.propagateByes(); // Recurse
    }
  }

  advancePlayer(sourceMatchId, winnerId, loserId) {
    const sourceMatch = this.matches[sourceMatchId];
    
    // 1. Advance Winner
    const nextWinnerId = sourceMatch.nextMatchIdWinner;
    if (nextWinnerId) {
      const nextMatch = this.matches[nextWinnerId];
      const player = (winnerId === 'bye') ? { id: 'bye', name: 'BYE', isBye: true } : this.playerMap[winnerId];

      if (nextWinnerId === 'gf-1-1') {
        if (sourceMatchId.startsWith('w-')) {
          nextMatch.p1 = player;
        } else {
          nextMatch.p2 = player;
        }
      } else if (nextWinnerId === 'gf-1-2') {
        // Keep same positions
        if (sourceMatchId === 'gf-1-1') {
          nextMatch.p1 = sourceMatch.p1;
          nextMatch.p2 = sourceMatch.p2;
        }
      } else if (nextWinnerId.startsWith('w-')) {
        const parts = sourceMatchId.split('-');
        const sourceIndex = parseInt(parts[2]);
        if (sourceIndex % 2 === 1) {
          nextMatch.p1 = player;
        } else {
          nextMatch.p2 = player;
        }
      } else if (nextWinnerId.startsWith('l-')) {
        const parts = nextWinnerId.split('-');
        const nextRound = parseInt(parts[1]);
        
        if (nextRound % 2 === 1) {
          if (sourceMatchId.startsWith('w-')) {
            // Drop from W-R1 to L-R1
            const sourceIndex = parseInt(sourceMatchId.split('-')[2]);
            if (sourceIndex % 2 === 1) {
              nextMatch.p1 = player;
            } else {
              nextMatch.p2 = player;
            }
          } else {
            // Advance from previous odd/even losers
            const sourceIndex = parseInt(sourceMatchId.split('-')[2]);
            if (sourceIndex % 2 === 1) {
              nextMatch.p1 = player;
            } else {
              nextMatch.p2 = player;
            }
          }
        } else {
          // Even losers round: Winner of previous losers round goes to P1
          if (sourceMatchId.startsWith('l-')) {
            nextMatch.p1 = player;
          }
        }
      }

      this.updateMatchStatus(nextMatch);
    }

    // 2. Advance Loser (only drops from Winners bracket)
    const nextLoserId = sourceMatch.nextMatchIdLoser;
    if (nextLoserId) {
      const nextMatch = this.matches[nextLoserId];
      const player = (loserId === 'bye') ? { id: 'bye', name: 'BYE', isBye: true } : this.playerMap[loserId];
      
      if (nextLoserId === 'gf-1-1') {
        nextMatch.p2 = player;
      } else {
        const parts = nextLoserId.split('-');
        const nextRound = parseInt(parts[1]);

        if (nextRound % 2 === 1) {
          // L-R1 drop
          const sourceIndex = parseInt(sourceMatchId.split('-')[2]);
          if (sourceIndex % 2 === 1) {
            nextMatch.p1 = player;
          } else {
            nextMatch.p2 = player;
          }
        } else {
          // L-R2, 4, 6... drop from Winners Round r goes to P2
          nextMatch.p2 = player;
        }
      }

      this.updateMatchStatus(nextMatch);
    }
  }

  updateMatchStatus(match) {
    if (match.p1 && match.p2) {
      match.status = 'scheduled';
    } else {
      match.status = 'pending';
    }
  }

  // Score Logging
  logMatchResult(matchId, p1Score, p2Score) {
    const match = this.matches[matchId];
    if (!match) throw new Error("Match not found.");
    
    // Parse to ensure clean integers
    const p1 = parseInt(p1Score, 10);
    const p2 = parseInt(p2Score, 10);
    
    if (isNaN(p1) || isNaN(p2) || p1 < 0 || p2 < 0) {
      throw new Error("Match scores must be non-negative integers.");
    }
    if (p1 === p2) {
      throw new Error("Pool matches cannot end in a tie.");
    }

    // Allow editing of completed matches if downstream matches haven't started
    if (match.status !== 'scheduled' && match.status !== 'pending_verification' && !(match.status === 'completed' && this.canEditMatch(matchId))) {
      throw new Error("Match is not in a playable state.");
    }

    const p1Win = p1 > p2;
    match.p1Score = p1;
    match.p2Score = p2;
    match.winnerId = p1Win ? match.p1.id : match.p2.id;
    match.loserId = p1Win ? match.p2.id : match.p1.id;
    match.status = 'completed';

    // Check for Grand Finals double elimination logic
    if (matchId === 'gf-1-1') {
      if (match.winnerId === match.p2.id) {
        // Loser bracket winner won gf-1-1. We need a bracket reset!
        // Dynamically spawn gf-1-2
        this.matches['gf-1-2'] = this.createMatchObject('gf-1-2', null, null);
        this.matches['gf-1-2'].p1 = match.p1;
        this.matches['gf-1-2'].p2 = match.p2;
        this.matches['gf-1-2'].status = 'scheduled';
      }
    }

    // Advance players
    if (matchId === 'gf-1-1' && match.winnerId === match.p2.id) {
      // Don't advance to gf-1-1 next. The bracket reset match is played.
    } else {
      this.advancePlayer(matchId, match.winnerId, match.loserId);
    }

    // Run propagation in case new byes are triggered (e.g. in losers bracket)
    this.propagateByes();
  }

  // Safety & Rollback Logic
  canEditMatch(matchId) {
    const match = this.matches[matchId];
    if (!match || (match.status !== 'completed' && match.status !== 'bye')) {
      return false;
    }

    // Prevent rollback of gf-1-1 if gf-1-2 was dynamically created and played
    if (matchId === 'gf-1-1') {
      const gf2 = this.matches['gf-1-2'];
      if (gf2 && (gf2.status === 'completed' || gf2.status === 'bye')) {
        return false;
      }
    }

    // Recurse down winner and loser paths to check if any gameplay occurred
    const checkDownstream = (nextMId) => {
      if (!nextMId) return false;
      const nextMatch = this.matches[nextMId];
      if (!nextMatch) return false;

      // If next match was played by a user (status completed), we can't edit
      if (nextMatch.status === 'completed') {
        return true;
      }

      // If it was a bye, we check its downstream recursively
      if (nextMatch.status === 'bye') {
        return checkDownstream(nextMatch.nextMatchIdWinner) || checkDownstream(nextMatch.nextMatchIdLoser);
      }

      // If scheduled or pending, check if they have scores entered (should be null, but just in case)
      if (nextMatch.p1Score !== null || nextMatch.p2Score !== null) {
        return true;
      }

      return false;
    };

    const winnerPathBlocked = checkDownstream(match.nextMatchIdWinner);
    const loserPathBlocked = checkDownstream(match.nextMatchIdLoser);

    return !winnerPathBlocked && !loserPathBlocked;
  }

  rollbackMatch(matchId) {
    if (!this.canEditMatch(matchId)) {
      throw new Error("Cannot rollback match: downstream matches have already started.");
    }

    this.recursiveRollback(matchId);

    // Re-propagate byes just in case
    this.propagateByes();
  }

  recursiveRollback(matchId) {
    const match = this.matches[matchId];
    if (!match) return;

    const winnerId = match.winnerId;
    const loserId = match.loserId;

    // Reset scores & status
    match.p1Score = null;
    match.p2Score = null;
    match.winnerId = null;
    match.loserId = null;
    this.updateMatchStatus(match);

    // If gf-1-2 was created and we are rolling back gf-1-1, delete gf-1-2
    if (matchId === 'gf-1-1' && this.matches['gf-1-2']) {
      delete this.matches['gf-1-2'];
    }

    // 1. Rollback winner advancement
    if (match.nextMatchIdWinner) {
      const nextM = this.matches[match.nextMatchIdWinner];
      if (nextM) {
        const wasBye = nextM.status === 'bye';
        // Clear winner slot
        if (nextM.p1 && nextM.p1.id === winnerId) nextM.p1 = null;
        if (nextM.p2 && nextM.p2.id === winnerId) nextM.p2 = null;
        nextM.status = 'pending';

        if (wasBye) {
          this.recursiveRollback(match.nextMatchIdWinner);
        }
      }
    }

    // 2. Rollback loser advancement
    if (match.nextMatchIdLoser) {
      const nextM = this.matches[match.nextMatchIdLoser];
      if (nextM) {
        const wasBye = nextM.status === 'bye';
        // Clear loser slot
        if (nextM.p1 && nextM.p1.id === loserId) nextM.p1 = null;
        if (nextM.p2 && nextM.p2.id === loserId) nextM.p2 = null;
        nextM.status = 'pending';

        if (wasBye) {
          this.recursiveRollback(match.nextMatchIdLoser);
        }
      }
    }
  }

  isFinished() {
    const gf1 = this.matches['gf-1-1'];
    if (!gf1 || gf1.status !== 'completed') return false;

    const gf2 = this.matches['gf-1-2'];
    if (gf2) {
      return gf2.status === 'completed';
    }

    return true;
  }

  getRankings() {
    if (!this.isStarted) return [];

    const rankings = [];
    const gf2 = this.matches['gf-1-2'];
    const gf1 = this.matches['gf-1-1'];

    let champion = null;
    let runnerUp = null;

    if (gf2 && gf2.status === 'completed') {
      champion = gf2.winnerId === gf2.p1.id ? gf2.p1 : gf2.p2;
      runnerUp = gf2.winnerId === gf2.p1.id ? gf2.p2 : gf2.p1;
    } else if (gf1 && gf1.status === 'completed' && gf1.winnerId === gf1.p1.id) {
      champion = gf1.p1;
      runnerUp = gf1.p2;
    }

    if (champion) rankings.push({ rank: 1, id: champion.id, name: champion.name });
    if (runnerUp) rankings.push({ rank: 2, id: runnerUp.id, name: runnerUp.name });

    // Rest of rankings can be inferred from where players were eliminated in Losers.
    // For a party pool tournament, 1st and 2nd are the core requirements, but let's do a simple sort.
    // We can find when players were eliminated based on their last losers bracket match.
    // A player is eliminated at Losers Round lr if they lost in that round.
    // This is optional for a bracket, but extremely neat to show! Let's compute it:
    const elimRounds = {};
    for (const matchId in this.matches) {
      const match = this.matches[matchId];
      if (match.status === 'completed' || match.status === 'bye') {
        if (matchId.startsWith('l-')) {
          const round = parseInt(matchId.split('-')[1]);
          const loser = match.loserId;
          if (loser && loser !== 'bye') {
            elimRounds[loser] = round;
          }
        } else if (matchId.startsWith('w-')) {
          // If a player lost in Winners and size is 2 (so no Losers bracket), they are 2nd
          const loser = match.loserId;
          if (this.size === 2 && loser && loser !== 'bye') {
            elimRounds[loser] = 0;
          }
        }
      }
    }

    // Sort players who are not 1st or 2nd by their elimination round descending (higher round = higher rank)
    const rest = this.players
      .filter(p => (!champion || p.id !== champion.id) && (!runnerUp || p.id !== runnerUp.id))
      .map(p => {
        const round = elimRounds[p.id] || 0;
        return { id: p.id, name: p.name, round };
      })
      .sort((a, b) => b.round - a.round);

    let currentRank = 3;
    let prevRound = -1;
    rest.forEach((p, idx) => {
      if (idx > 0 && p.round < prevRound) {
        currentRank = idx + 3;
      }
      rankings.push({ rank: currentRank, id: p.id, name: p.name });
      prevRound = p.round;
    });

    return rankings;
  }
}
