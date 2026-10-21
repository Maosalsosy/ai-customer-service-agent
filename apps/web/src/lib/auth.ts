export const AUTH_TOKEN_KEY = "aikefu.accessToken";
export const AUTH_USER_KEY = "aikefu.authUser";

/** 同标签页会话变更事件名。会话存 sessionStorage，标签之间互不覆盖。 */
export const AUTH_SESSION_EVENT = "aikefu:session-changed";

export type AuthRealm = "staff" | "customer";

export type SessionChangeDetail = {
  realm: AuthRealm | "all";
  reason: "set" | "clear";
};

const SESSION_KEY: Record<AuthRealm, string> = {
  staff: "aikefu.session.staff",
  customer: "aikefu.session.customer",
};

function tabStore(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage;
}

function emitSessionChange(realm: AuthRealm | "all", reason: "set" | "clear") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<SessionChangeDetail>(AUTH_SESSION_EVENT, {
      detail: { realm, reason },
    }),
  );
}

/** 订阅本标签页会话变化（sessionStorage 不跨标签广播）。 */
export function onAuthSessionChange(
  handler: (detail: SessionChangeDetail) => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;

  const onCustom = (ev: Event) => {
    const detail = (ev as CustomEvent<SessionChangeDetail>).detail;
    if (detail) handler(detail);
  };

  window.addEventListener(AUTH_SESSION_EVENT, onCustom);
  return () => {
    window.removeEventListener(AUTH_SESSION_EVENT, onCustom);
  };
}

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  role: string;
};

type StoredSession = {
  token: string;
  user: AuthUser;
};

export function isCustomerRole(role?: string) {
  const lower = (role ?? "").trim().toLowerCase();
  return (
    lower === "customer" ||
    lower === "user" ||
    role === "客户" ||
    role === "用户"
  );
}

export function isAdminRole(role?: string) {
  const raw = (role ?? "").trim();
  const lower = raw.toLowerCase();
  return (
    lower === "admin" ||
    lower === "owner" ||
    raw === "管理员" ||
    raw === "租户管理员"
  );
}

export function homePathForRole(role?: string) {
  return isCustomerRole(role) ? "/customer" : "/dashboard";
}

export function realmFromRole(role?: string): AuthRealm {
  return isCustomerRole(role) ? "customer" : "staff";
}

export function realmFromPath(pathname?: string): AuthRealm {
  const path =
    pathname ??
    (typeof window !== "undefined" ? window.location.pathname : "");
  return path.startsWith("/customer") ? "customer" : "staff";
}

function parseSession(raw: string | null): StoredSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed?.token || !parsed?.user?.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

function readSession(realm: AuthRealm): StoredSession | null {
  if (typeof window === "undefined") return null;
  migrateLegacySession();
  return parseSession(tabStore()?.getItem(SESSION_KEY[realm]) ?? null);
}

function writeSession(realm: AuthRealm, session: StoredSession) {
  tabStore()?.setItem(SESSION_KEY[realm], JSON.stringify(session));
}

function removeSession(realm: AuthRealm) {
  tabStore()?.removeItem(SESSION_KEY[realm]);
  // 顺带清掉旧的 localStorage 槽，避免回迁覆盖
  window.localStorage.removeItem(SESSION_KEY[realm]);
}

/**
 * 将旧 localStorage 会话迁入本标签的 sessionStorage，并删除共享键，
 * 使管理员/客服可在不同标签同时在线。
 */
function migrateLegacySession() {
  if (typeof window === "undefined") return;
  const store = tabStore();
  if (!store) return;

  const adopt = (realm: AuthRealm, session: StoredSession) => {
    if (!store.getItem(SESSION_KEY[realm])) {
      store.setItem(SESSION_KEY[realm], JSON.stringify(session));
    }
  };

  for (const realm of ["staff", "customer"] as const) {
    const fromLocal = parseSession(
      window.localStorage.getItem(SESSION_KEY[realm]),
    );
    if (fromLocal) {
      adopt(realm, fromLocal);
      window.localStorage.removeItem(SESSION_KEY[realm]);
    }
  }

  const legacyToken = window.localStorage.getItem(AUTH_TOKEN_KEY);
  const legacyUserRaw = window.localStorage.getItem(AUTH_USER_KEY);
  if (legacyToken || legacyUserRaw) {
    let user: AuthUser | null = null;
    if (legacyUserRaw) {
      try {
        user = JSON.parse(legacyUserRaw) as AuthUser;
      } catch {
        user = null;
      }
    }
    if (legacyToken && user?.id) {
      adopt(realmFromRole(user.role), { token: legacyToken, user });
    }
    window.localStorage.removeItem(AUTH_TOKEN_KEY);
    window.localStorage.removeItem(AUTH_USER_KEY);
  }
}

export function getAccessToken(realm?: AuthRealm): string | null {
  if (typeof window === "undefined") return null;
  return readSession(realm ?? realmFromPath())?.token ?? null;
}

export function setAuthSession(token: string, user: AuthUser) {
  const realm = realmFromRole(user.role);
  writeSession(realm, { token, user });
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(AUTH_TOKEN_KEY);
    window.localStorage.removeItem(AUTH_USER_KEY);
    window.localStorage.removeItem(SESSION_KEY[realm]);
  }
  emitSessionChange(realm, "set");
}

/**
 * 仅在目标槽为空时写入（同标签内脏槽纠正，不跨标签）。
 * @returns 是否写入成功
 */
export function setAuthSessionIfEmpty(token: string, user: AuthUser): boolean {
  const realm = realmFromRole(user.role);
  if (readSession(realm)) return false;
  setAuthSession(token, user);
  return true;
}

export function clearAuthSession(target?: AuthRealm | "all") {
  if (typeof window === "undefined") return;
  migrateLegacySession();
  if (target === "all") {
    removeSession("staff");
    removeSession("customer");
    window.localStorage.removeItem(AUTH_TOKEN_KEY);
    window.localStorage.removeItem(AUTH_USER_KEY);
    emitSessionChange("all", "clear");
    return;
  }
  const realm = target ?? realmFromPath();
  removeSession(realm);
  emitSessionChange(realm, "clear");
}

export function getStoredUser(realm?: AuthRealm): AuthUser | null {
  if (typeof window === "undefined") return null;
  return readSession(realm ?? realmFromPath())?.user ?? null;
}

/** 登录页等场景：查看本标签某一槽是否已有会话。 */
export function getSession(realm: AuthRealm): StoredSession | null {
  return readSession(realm);
}
