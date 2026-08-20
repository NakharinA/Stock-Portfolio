import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, clearToken, getToken, setToken } from "./api";

const AuthContext = createContext(null);

/**
 * The API finishes the Google flow by redirecting back with the token in the URL fragment.
 * A fragment is never sent to a server, so the token does not appear in access logs or in
 * a Referer header on the way here; it is moved into storage and stripped from the address
 * bar immediately so it does not survive in history either.
 */
function takeTokenFromUrl() {
  if (!window.location.hash.startsWith("#access_token=")) return false;
  const token = new URLSearchParams(window.location.hash.slice(1)).get("access_token");
  if (!token) return false;
  setToken(token);
  window.history.replaceState(null, "", window.location.pathname);
  return true;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    takeTokenFromUrl();
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      setUser(await api.me());
    } catch {
      // An expired or revoked token is indistinguishable from no token as far as the UI
      // is concerned: either way this person has to sign in again.
      clearToken();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const signOut = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, signOut, reload: load }), [user, loading, signOut, load]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
