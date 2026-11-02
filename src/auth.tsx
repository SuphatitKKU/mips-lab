import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api, getToken, setToken, UNAUTHORIZED, NEEDS_CLASS } from "./api";

export type Role = "student" | "teacher";

export interface Me {
  googleLinked?: boolean;
  hasPassword?: boolean;
  classId?: number | null;
  needsClass?: boolean;
  studentId: string;
  name: string;
  section: string;
  initials: string;
  role: Role;
  email: string | null;
}

export const ROLE_LABEL: Record<Role, string> = {
  student: "นักศึกษา",
  teacher: "อาจารย์",
};

interface Auth {
  loggedIn: boolean;
  user: Me | null;
  isTeacher: boolean;
  loginGoogle: (credential: string) => Promise<boolean>;
  loginPassword: (username: string, password: string) => Promise<boolean>;
  registerStudent: (data: {
    name: string;
    studentId: string;
    password: string;
    classCode?: string;
  }) => Promise<boolean>;
  loginDev: (role?: Role) => Promise<boolean>;
  logout: () => Promise<void>;
  /** Replaces the cached user after the profile changes. */
  updateUser: (u: Me) => void;
}

const AuthCtx = createContext<Auth | null>(null);
const USER_KEY = "mipslab.user";

function readUser(): Me | null {
  try {
    const s =
      localStorage.getItem(USER_KEY) ?? sessionStorage.getItem(USER_KEY);
    return s ? (JSON.parse(s) as Me) : null;
  } catch {
    return null;
  }
}

function writeUser(u: Me | null, remember: boolean) {
  try {
    localStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(USER_KEY);
    if (u)
      (remember ? localStorage : sessionStorage).setItem(
        USER_KEY,
        JSON.stringify(u),
      );
  } catch {
    /* storage unavailable — stays logged in for this page load only */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTok] = useState(getToken);
  const [user, setUser] = useState<Me | null>(readUser);

  useEffect(() => {
    const onUnauth = () => {
      setToken(null);
      writeUser(null, false);
      setTok(null);
      setUser(null);
    };
    window.addEventListener(UNAUTHORIZED, onUnauth);
    return () => window.removeEventListener(UNAUTHORIZED, onUnauth);
  }, []);

  useEffect(() => {
    const refreshClass = () =>
      api<{ user: Me }>("/profile")
        .then((r) => updateUser(r.user))
        .catch(() => undefined);
    window.addEventListener(NEEDS_CLASS, refreshClass);
    return () => window.removeEventListener(NEEDS_CLASS, refreshClass);
  }, []);

  // refresh the cached user so role / profile changes made elsewhere show up
  useEffect(() => {
    if (!token) return;
    api<{ user: Me }>("/profile")
      .then((r) => updateUser(r.user))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const updateUser = (u: Me) => {
    writeUser(u, true);
    setUser(u);
  };

  /** Returns true when this Google account was just registered. */
  const loginGoogle = (credential: string) =>
    signIn("/auth/google", { idToken: credential });
  const loginPassword = (username: string, password: string) =>
    signIn("/auth/password", { username, password });
  const registerStudent = (data: {
    name: string;
    studentId: string;
    password: string;
    classCode?: string;
  }) => signIn("/auth/register", data);
  const loginDev = (role: Role = "student") => signIn("/auth/dev", { role });
  const signIn = async (path: string, body: object) => {
    const r = await api<{ token: string; user: Me; created: boolean }>(path, {
      body,
    });
    setToken(r.token, true);
    writeUser(r.user, true);
    setTok(r.token);
    setUser(r.user);
    return r.created;
  };
  const logout = async () => {
    await api("/auth/logout", { body: {} }).catch(() => undefined);
    setToken(null);
    writeUser(null, false);
    setTok(null);
    setUser(null);
  };

  return (
    <AuthCtx.Provider
      value={{
        loggedIn: !!token,
        user,
        isTeacher: user?.role === "teacher",
        loginGoogle,
        loginPassword,
        registerStudent,
        loginDev,
        logout,
        updateUser,
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
