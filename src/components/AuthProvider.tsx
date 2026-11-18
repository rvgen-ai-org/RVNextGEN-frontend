"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ApiError, authApi, type AuthUser, type Session } from "@/lib/api";
import { trackVisit } from "@/lib/analytics";

type Status = "loading" | "authed" | "anon";
type AuthContextValue = {
  status: Status;
  user: AuthUser | null;
  accessToken: string | null;
  /** Adopt a session returned by login / verify / Google, and tell the other tabs. */
  signIn: (session: Session) => void;
  signOut: () => Promise<void>;
  recovering: boolean;
  retrySession: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const CHANNEL = "rv-auth";

/** Deduplicate refresh calls in this tab; Web Locks serialize across tabs. */
let pendingRefresh: Promise<Session | null> | undefined;
function requestRefresh(): Promise<Session | null> {
  if (pendingRefresh) return pendingRefresh;
  const request = async () => {
    const result = await authApi<Session | null>("refresh");
    if (result !== null && (!result.user?.id || typeof result.accessToken !== "string" || !Number.isFinite(result.expiresIn) || result.expiresIn <= 0)) throw new Error("Invalid refresh response");
    return result;
  };
  const pending = typeof navigator !== "undefined" && navigator.locks
    ? (async () => await navigator.locks.request("rv-refresh", request))() : request();
  pendingRefresh = pending;
  void pending.finally(() => { if (pendingRefresh === pending) pendingRefresh = undefined; }).catch(() => undefined);
  return pending;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [recovering, setRecovering] = useState(false);
  const requestId = useRef(0);
  const cancelRefresh = useCallback(() => { requestId.current++; }, []);
  const signedOut = useRef(false);
  const failures = useRef(0);
  const channel = useRef<BroadcastChannel | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);

  const adopt = useCallback((next: Session | null) => {
    window.clearTimeout(timer.current);
    setSession(next);
    setStatus(next ? "authed" : "anon");
    // Renew the short-lived access token a minute before it expires.
    if (next) timer.current = window.setTimeout(() => void refreshRef.current(), Math.max(next.expiresIn - 60, 30) * 1000);
  }, []);

  const refresh = useCallback(async () => {
    if (signedOut.current) return;
    const attempt = ++requestId.current;
    window.clearTimeout(timer.current);
    try {
      const next = await requestRefresh();
      if (requestId.current !== attempt) return;
      failures.current = 0;
      setRecovering(false);
      adopt(next);
    } catch (error) {
      if (requestId.current !== attempt) return;
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        failures.current = 0; setRecovering(false); adopt(null);
        return;
      }
      // A compiling server, network outage, throttling or invalid response does
      // not prove the session expired. Keep the user and retry with capped backoff.
      setRecovering(true);
      const delay = Math.min(1000 * 2 ** Math.min(failures.current++, 5), 30000);
      timer.current = window.setTimeout(() => void refreshRef.current(), delay);
    }
  }, [adopt]);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);

  useEffect(() => {
    void refreshRef.current();
    const recover = () => { if (document.visibilityState === "visible") void refreshRef.current(); };
    window.addEventListener("online", recover);
    document.addEventListener("visibilitychange", recover);
    const bc = new BroadcastChannel(CHANNEL);
    channel.current = bc;
    bc.onmessage = (event) => {
      if (event.data === "signed-in") { signedOut.current = false; void refreshRef.current(); }
      if (event.data === "signed-out") { signedOut.current = true; cancelRefresh(); setRecovering(false); adopt(null); }
    };
    return () => { cancelRefresh(); bc.close(); window.clearTimeout(timer.current); window.removeEventListener("online", recover); document.removeEventListener("visibilitychange", recover); };
  }, [adopt, cancelRefresh]);

  const signIn = useCallback((next: Session) => {
    signedOut.current = false; cancelRefresh(); failures.current = 0; setRecovering(false);
    adopt(next);
    channel.current?.postMessage("signed-in");
  }, [adopt, cancelRefresh]);

  const signOut = useCallback(async () => {
    signedOut.current = true;
    cancelRefresh();
    setRecovering(false);
    adopt(null);
    channel.current?.postMessage("signed-out");
    await pendingRefresh?.catch(() => undefined);
    const logout = () => authApi("logout").catch(() => undefined);
    if (navigator.locks) await navigator.locks.request("rv-refresh", logout);
    else await logout();
  }, [adopt, cancelRefresh]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user: session?.user ?? null, accessToken: session?.accessToken ?? null, signIn, signOut, recovering, retrySession: refresh }),
    [status, session, signIn, signOut, recovering, refresh],
  );
  useEffect(() => { trackVisit(session?.accessToken ?? null, session?.user.id); }, [session?.accessToken, session?.user.id]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}

/** Sends signed-in visitors straight to the app (used on the login / signup screens). */
export function useRedirectIfSignedIn(destination = "/") {
  const { status } = useAuth();
  const router = useRouter();
  useEffect(() => { if (status === "authed") router.replace(destination); }, [status, router, destination]);
}

/** Renders children only for signed-in users; everyone else is sent to the welcome screen. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { status, recovering, retrySession } = useAuth();
  const router = useRouter();
  useEffect(() => { if (status === "anon") router.replace("/login"); }, [status, router]);
  if (status === "loading" && recovering) return <div className="grid min-h-dvh place-content-center gap-3 bg-[#111] p-6 text-center text-white"><p role="status">Reconnecting to your session...</p><button type="button" onClick={() => void retrySession()} className="min-h-11 rounded-xl bg-white/10 px-5">Try again</button></div>;
  return status === "authed" ? <>{children}</> : null;
}
