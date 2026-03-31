import { useState } from 'react';
import Login from './components/Login';
import Dashboard from './components/Dashboard';

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('ccg_token'));
  const [role, setRole] = useState(() => localStorage.getItem('ccg_role'));

  const handleLogin = (t, r) => {
    localStorage.setItem('ccg_token', t);
    localStorage.setItem('ccg_role', r);
    setToken(t);
    setRole(r);
  };

  const handleLogout = () => {
    localStorage.removeItem('ccg_token');
    localStorage.removeItem('ccg_role');
    setToken(null);
    setRole(null);
  };

  return (
    <div>
      {!token ? (
        <Login onLogin={handleLogin} />
      ) : (
        <Dashboard token={token} role={role} onLogout={handleLogout} />
      )}
    </div>
  );
}

export default App;