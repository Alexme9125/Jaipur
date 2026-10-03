/** 128-bit random client secret persisted in localStorage — rejoins restore the seat. */
export function createClientId(): string {
  try {
    const existing = localStorage.getItem('jaipur.clientId');
    if (existing && /^[0-9a-f]{32}$/.test(existing)) return existing;
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    localStorage.setItem('jaipur.clientId', id);
    return id;
  } catch {
    return 'anon';
  }
}
