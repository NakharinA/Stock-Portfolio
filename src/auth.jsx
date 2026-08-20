import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, ApiError, clearToken, getToken, setToken } from "./api";

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
  const [unreachable, setUnreachable] = useState(false);

  const load = useCallback(async () => {
    takeTokenFromUrl();
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      setUser(await api.me());
      setUnreachable(false);
    } catch (e) {
      // Only a token the server actively rejects is thrown away. A restarted API, a dropped
      // connection or a 500 says nothing about whether this person is signed in, and
      // deleting the session over one is what makes an app ask for a login every time
      // anything hiccups.
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        clearToken();
        setUser(null);
        setUnreachable(false);
      } else {
        setUnreachable(true);
      }
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

  const value = useMemo(
    () => ({ user, loading, unreachable, signOut, reload: load }),
    [user, loading, unreachable, signOut, load],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
