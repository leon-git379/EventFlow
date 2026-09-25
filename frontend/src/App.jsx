import { useState } from "react";
import Login from "./pages/Login.jsx";
import Attendee from "./pages/Attendee.jsx";
import Organizer from "./pages/Organizer.jsx";
import Sponsor from "./pages/Sponsor.jsx";
import { USE_MOCK_API } from "./api/config.js";
import { logout } from "./api/cognito.js";
import { STORAGE_KEYS } from "./api/config.js";

export default function App() {
  const [user, setUser] = useState(null); // { role, name }

  function handleLogout() {
    logout();
    localStorage.removeItem(STORAGE_KEYS.USER_ID);
    localStorage.removeItem(STORAGE_KEYS.NAME);
    setUser(null);
  }

  if (!user) return <Login onLogin={setUser} />;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-2.5">
          <span className="font-bold">
            Event<span className="text-orange-500">Flow</span>
          </span>
          <nav className="ml-3 flex gap-1">
            {[["attendee", "👤"], ["organizer", "🛠"], ["sponsor", "🏢"]].map(([r, icon]) => (
              <button
                key={r}
                onClick={() => setUser({ ...user, role: r })}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                  user.role === r
                    ? "bg-orange-500 text-white"
                    : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                }`}
                title={`Switch to ${r} view`}
              >
                {icon} {r}
              </button>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            {!USE_MOCK_API && <span className="hidden text-xs text-emerald-400 sm:inline">● live AWS</span>}
            {USE_MOCK_API && <span className="hidden text-xs text-amber-400 sm:inline">● mock mode</span>}
            <button onClick={handleLogout} className="text-xs text-slate-400 hover:text-white">
              Log out
            </button>
          </div>
        </div>
      </header>

      {user.role === "attendee" && <Attendee />}
      {user.role === "organizer" && <Organizer />}
      {user.role === "sponsor" && <Sponsor />}
    </div>
  );
}
