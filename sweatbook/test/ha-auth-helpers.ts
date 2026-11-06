// Stand-ins for Home Assistant in OAuth tests: a JWT-shaped token and a WebSocket API with `auth/current_user`.
export function jwt(expSecondsFromNow = 1800, now = Date.now()): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "HS256" })}.${enc({ exp: Math.floor(now / 1000) + expSecondsFromNow, jti: Math.random() })}.sig`;
}

export type HaUserInfo = { id: string; name: string; credentials?: unknown[] };

type Handler<T> = ((ev: T) => void) | null;

// A fake socket factory for createHaTokenVerifier: answers the auth handshake from `users` (token -> user).
// `down` makes every connection fail like an unreachable Home Assistant.
export function fakeHa(users: Record<string, HaUserInfo>, opts: { down?: boolean } = {}) {
  const stats = { connections: 0 };
  const createSocket = () => {
    stats.connections++;
    let user: HaUserInfo | undefined;
    const socket = {
      onopen: null as Handler<unknown>,
      onmessage: null as Handler<{ data: unknown }>,
      onerror: null as Handler<unknown>,
      onclose: null as Handler<unknown>,
      close() {},
      send(raw: string) {
        const msg = JSON.parse(raw);
        if (msg.type === "auth") {
          user = users[msg.access_token];
          reply({ type: user ? "auth_ok" : "auth_invalid" });
        } else if (msg.type === "auth/current_user" && user) {
          reply({ id: msg.id, type: "result", success: true, result: { is_admin: false, credentials: [{ auth_provider_type: "homeassistant" }], ...user } });
        }
      },
    };
    const reply = (msg: unknown) => setImmediate(() => socket.onmessage?.({ data: JSON.stringify(msg) }));
    setImmediate(() => (opts.down ? socket.onerror?.({}) : reply({ type: "auth_required" })));
    return socket;
  };
  return { createSocket, stats };
}
