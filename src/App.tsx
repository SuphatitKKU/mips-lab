import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { Answer } from './screens/Answer';
import { Code } from './screens/Code';
import { Home } from './screens/Home';
import { Leaderboard } from './screens/Leaderboard';
import { Login } from './screens/Login';
import { NotFound } from './screens/NotFound';
import { Problems } from './screens/Problems';
import { Settings } from './screens/Settings';
import { Solve } from './screens/Solve';
import { Teacher } from './screens/Teacher';
import { Z80Board } from './screens/Z80Board';
import { Z80Terminal } from './screens/Z80Terminal';

/** Old /sim links (and the program they carried) open the code page in run mode. */
function SimRedirect() {
  const { state } = useLocation();
  return <Navigate to="/code?mode=run" replace state={state} />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      {/* the Z80 board's serial terminal in its own tab: no menu, no sign-in needed (it only talks to the board tab) */}
      <Route path="/z80/terminal" element={<Z80Terminal />} />
      <Route element={<AppShell />}>
        <Route path="/" element={<Home />} />
        <Route path="/code" element={<Code />} />
        <Route path="/convert" element={<Navigate to="/code?mode=convert" replace />} />
        <Route path="/sim" element={<SimRedirect />} />
        <Route path="/problems" element={<Problems />} />
        <Route path="/problems/:id" element={<Solve />} />
        <Route path="/problems/:id/answer" element={<Answer />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route path="/z80" element={<Z80Board />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/teacher" element={<Teacher />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
