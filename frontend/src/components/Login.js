import { useState } from 'react';
import axios from 'axios';

function Login({ onLogin }) {
  const [regNumber, setRegNumber] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('driver');
  const [isRegister, setIsRegister] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    try {
      if (isRegister) {
        await axios.post('http://localhost:5000/api/auth/register', {
          name, reg_number: regNumber, password, role
        });
        setIsRegister(false);
        setError('Registered! Please login.');
      } else {
        const res = await axios.post('http://localhost:5000/api/auth/login', {
          reg_number: regNumber, password
        });
        onLogin(res.data.token, res.data.role);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong');
    }
  };

  return (
    <div style={{ maxWidth: '400px', margin: '100px auto', padding: '20px', border: '1px solid #ccc', borderRadius: '8px' }}>
      <h2 style={{ textAlign: 'center' }}>CampusCarGO</h2>
      <h3 style={{ textAlign: 'center' }}>{isRegister ? 'Register' : 'Login'}</h3>
      {isRegister && (
        <input placeholder="Full Name" value={name} onChange={e => setName(e.target.value)}
          style={{ width: '100%', padding: '8px', marginBottom: '10px', boxSizing: 'border-box' }} />
      )}
      <input placeholder="Registration Number" value={regNumber} onChange={e => setRegNumber(e.target.value)}
        style={{ width: '100%', padding: '8px', marginBottom: '10px', boxSizing: 'border-box' }} />
      <input placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)}
        style={{ width: '100%', padding: '8px', marginBottom: '10px', boxSizing: 'border-box' }} />
      {isRegister && (
        <select value={role} onChange={e => setRole(e.target.value)}
          style={{ width: '100%', padding: '8px', marginBottom: '10px', boxSizing: 'border-box' }}>
          <option value="driver">Driver</option>
          <option value="passenger">Passenger</option>
        </select>
      )}
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <button onClick={handleSubmit}
        style={{ width: '100%', padding: '10px', background: '#4CAF50', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
        {isRegister ? 'Register' : 'Login'}
      </button>
      <p style={{ textAlign: 'center', marginTop: '10px', cursor: 'pointer', color: 'blue' }}
        onClick={() => setIsRegister(!isRegister)}>
        {isRegister ? 'Already have an account? Login' : 'No account? Register'}
      </p>
    </div>
  );
}

export default Login;