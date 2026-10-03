export interface Profile {
  name: string;
  lifetimeTokens: number;
  matches: number;
  wins: number;
}

const KEY = 'jaipur.profile';
export const PVE_SAVE_KEY = 'jaipur.pve.save';

function defaultName(): string {
  return `旅商${Math.floor(1000 + Math.random() * 9000)}`;
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Profile>;
      if (typeof p.name === 'string') {
        return {
          name: p.name,
          lifetimeTokens: Number(p.lifetimeTokens) || 0,
          matches: Number(p.matches) || 0,
          wins: Number(p.wins) || 0,
        };
      }
    }
  } catch {
    /* corrupted store — start fresh */
  }
  const p: Profile = { name: defaultName(), lifetimeTokens: 0, matches: 0, wins: 0 };
  saveProfile(p);
  return p;
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
}
