import { useState } from 'react';
import axios from 'axios';

export default function Login({ onLogin }) {
  const [isRegister, setIsRegister] = useState(false);
  const [name, setName] = useState('');
  const [regNumber, setRegNumber] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('passenger');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setError('');
    setLoading(true);
    try {
      if (isRegister) {
        await axios.post('http://localhost:5000/api/auth/register', { name, reg_number: regNumber, password, role });
        setIsRegister(false);
      } else {
        const res = await axios.post('http://localhost:5000/api/auth/login', { reg_number: regNumber, password });
        onLogin(res.data.token, res.data.role);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong');
    }
    setLoading(false);
  };

  const input = {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #ddd',
    borderRadius: '6px',
    fontSize: '15px',
    outline: 'none',
    background: 'white',
    color: '#1a1a1a',
    marginBottom: '14px',
    transition: 'border-color 0.15s'
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: '#f9f9f9',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px'
    }}>
      <div style={{ width: '100%', maxWidth: '400px' }}>

        {/* Header */}
        <div style={{ marginBottom: '28px' }}>
          <div style={{ fontSize: '22px', fontWeight: '700', color: '#1a1a1a', letterSpacing: '-0.3px' }}>
            CampusCarGO
          </div>
          <div style={{ color: '#888', fontSize: '14px', marginTop: '4px' }}>
            Ride sharing for SCT students
          </div>
        </div>

        {/* Card */}
        <div style={{
          background: 'white',
          border: '1px solid #e8e8e8',
          borderRadius: '10px',
          padding: '28px',
        }}>
          <div style={{ fontSize: '17px', fontWeight: '600', marginBottom: '20px', color: '#1a1a1a' }}>
            {isRegister ? 'Create an account' : 'Sign in'}
          </div>

          {isRegister && (
            <input
              type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="Full name" style={input}
              onFocus={e => e.target.style.borderColor = '#1a1a1a'}
              onBlur={e => e.target.style.borderColor = '#ddd'}
            />
          )}

          <input
            type="text" value={regNumber} onChange={e => setRegNumber(e.target.value)}
            placeholder="Registration number" style={input}
            onFocus={e => e.target.style.borderColor = '#1a1a1a'}
            onBlur={e => e.target.style.borderColor = '#ddd'}
          />

          <input
            type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder="Password" style={{ ...input, marginBottom: isRegister ? '14px' : '0' }}
            onFocus={e => e.target.style.borderColor = '#1a1a1a'}
            onBlur={e => e.target.style.borderColor = '#ddd'}
          />

          {isRegister && (
            <div style={{ marginBottom: '14px' }}>
              <div style={{ fontSize: '13px', color: '#888', marginBottom: '8px' }}>I am a</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {['passenger', 'driver'].map(r => (
                  <button key={r} onClick={() => setRole(r)} style={{
                    padding: '10px',
                    border: `1px solid ${role === r ? '#1a1a1a' : '#ddd'}`,
                    borderRadius: '6px',
                    background: role === r ? '#1a1a1a' : 'white',
                    color: role === r ? 'white' : '#888',
                    fontWeight: '500',
                    fontSize: '14px',
                    textTransform: 'capitalize'
                  }}>
                    {r === 'driver' ? 'Driver' : 'Passenger'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div style={{
              fontSize: '13px', color: '#c0392b', marginTop: '12px',
              padding: '8px 12px', background: '#fdf3f2', borderRadius: '6px',
              border: '1px solid #f5c6c2'
            }}>
              {error}
            </div>
          )}

          <button onClick={handleSubmit} disabled={loading} style={{
            width: '100%',
            padding: '11px',
            marginTop: '16px',
            background: loading ? '#999' : '#1a1a1a',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontSize: '15px',
            fontWeight: '600'
          }}>
            {loading ? 'Please wait...' : isRegister ? 'Create account' : 'Sign in'}
          </button>

          <div style={{ textAlign: 'center', marginTop: '16px', fontSize: '13px', color: '#888' }}>
            {isRegister ? 'Already have an account?' : "Don't have an account?"}
            <button onClick={() => { setIsRegister(!isRegister); setError(''); }} style={{
              background: 'none', border: 'none', color: '#1a1a1a',
              fontWeight: '600', marginLeft: '5px', fontSize: '13px',
              textDecoration: 'underline'
            }}>
              {isRegister ? 'Sign in' : 'Register'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}