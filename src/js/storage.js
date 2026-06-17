const STORAGE_KEYS = {
  PLAYERS: 'tournament_players',
  STATE: 'tournament_state',
  SETTINGS: 'tournament_settings'
};

const memoryStore = {};

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    console.warn(`LocalStorage access failed for key "${key}". Falling back to in-memory store.`, e);
    return memoryStore[key] || null;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    console.warn(`LocalStorage write failed for key "${key}". Falling back to in-memory store.`, e);
    memoryStore[key] = value;
  }
}

function safeRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch (e) {
    console.warn(`LocalStorage remove failed for key "${key}". Falling back to in-memory store.`, e);
    delete memoryStore[key];
  }
}

export const StorageService = {
  getPlayers() {
    const data = safeGet(STORAGE_KEYS.PLAYERS);
    return data ? JSON.parse(data) : [];
  },

  savePlayers(players) {
    safeSet(STORAGE_KEYS.PLAYERS, JSON.stringify(players));
  },

  getTournamentState() {
    const data = safeGet(STORAGE_KEYS.STATE);
    return data ? JSON.parse(data) : null;
  },

  saveTournamentState(state) {
    safeSet(STORAGE_KEYS.STATE, JSON.stringify(state));
  },

  clearTournamentState() {
    safeRemove(STORAGE_KEYS.STATE);
  },

  getSettings() {
    const data = safeGet(STORAGE_KEYS.SETTINGS);
    const defaultConfig = {
      mode: 'firebase', // Default to Firebase Sync Mode
      firebaseConfig: {
        apiKey: "AIzaSyCC9kB615ZhcxNlQ9vaqCs-6KTcrcshuTA",
        authDomain: "pool-party-ed373.firebaseapp.com",
        databaseURL: "https://pool-party-ed373-default-rtdb.europe-west1.firebasedatabase.app",
        projectId: "pool-party-ed373",
        storageBucket: "pool-party-ed373.firebasestorage.app",
        messagingSenderId: "185830489682",
        appId: "1:185830489682:web:b211f97ecb5e53b27d698b"
      },
      tournamentId: 'party-tournament'
    };

    if (!data) {
      return defaultConfig;
    }

    try {
      const parsed = JSON.parse(data);
      // Force overwrite if the firebaseConfig is missing or has a different API Key
      if (!parsed.firebaseConfig || parsed.firebaseConfig.apiKey !== defaultConfig.firebaseConfig.apiKey) {
        safeSet(STORAGE_KEYS.SETTINGS, JSON.stringify(defaultConfig));
        return defaultConfig;
      }
      return parsed;
    } catch (e) {
      return defaultConfig;
    }
  },

  saveSettings(settings) {
    safeSet(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  }
};
