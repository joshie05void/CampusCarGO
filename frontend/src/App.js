import { useState } from 'react';
import Login from './components/Login';
import Dashboard from './components/Dashboard';

function App() {
  const [token, setToken] = useState(null);
  const [role, setRole] = useState(null);

  const handleLogin = (token, role) => {
    setToken(token);
    setRole(role);
  };

  const handleLogout = () => {
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