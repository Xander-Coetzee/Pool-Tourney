export class BaseTournament {
  constructor() {
    if (this.constructor === BaseTournament) {
      throw new Error("Abstract Class BaseTournament cannot be instantiated.");
    }
  }

  // Initialize tournament with a list of players
  initialize(players) {
    throw new Error("Method 'initialize()' must be implemented.");
  }

  // Get current state to serialize (for LocalStorage/Firebase)
  getState() {
    throw new Error("Method 'getState()' must be implemented.");
  }

  // Restore state from serialized data
  loadState(state) {
    throw new Error("Method 'loadState()' must be implemented.");
  }

  // Log a match result
  logMatchResult(matchId, p1Score, p2Score) {
    throw new Error("Method 'logMatchResult()' must be implemented.");
  }

  // Check if a match score can be edited
  canEditMatch(matchId) {
    throw new Error("Method 'canEditMatch()' must be implemented.");
  }

  // Rollback a match result
  rollbackMatch(matchId) {
    throw new Error("Method 'rollbackMatch()' must be implemented.");
  }

  // Get list of all matches
  getMatches() {
    throw new Error("Method 'getMatches()' must be implemented.");
  }

  // Get list of all players
  getPlayers() {
    throw new Error("Method 'getPlayers()' must be implemented.");
  }

  // Check if tournament is finished
  isFinished() {
    throw new Error("Method 'isFinished()' must be implemented.");
  }

  // Get final rankings
  getRankings() {
    throw new Error("Method 'getRankings()' must be implemented.");
  }
}
