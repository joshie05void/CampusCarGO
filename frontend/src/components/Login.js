import { useState } from 'react';
import axios from 'axios';

export default function Login({ onLogin }) {
  const [isRegister, setIsRegister] = useState(false);
  const [name, setName]             = useState('');
  const [regNumber, setRegNumber]   = useState('');
  const [password, setPassword]     = useState('');
  const [role, setRole]             = useState('passenger');
  const [error, setError]           = useState('');
  const [success, setSuccess]       = useState('');
  const [loading, setLoading]       = useState(false);

  const handleSubmit = async () => {
    setError(''); setSuccess('');
    if (!regNumber || !password) { setError('Please fill in all fields.'); return; }
    if (isRegister && !name)     { setError('Please enter your name.'); return; }
    setLoading(true);
    try {
      if (isRegister) {
        await axios.post('http://localhost:5000/api/auth/register', { name, reg_number: regNumber, password, role });
        setSuccess('Account created! You can now sign in.');
        setIsRegister(false);
        setName(''); setRegNumber(''); setPassword('');
      } else {
        const res = await axios.post('http://localhost:5000/api/auth/login', { reg_number: regNumber, password });
        onLogin(res.data.token, res.data.role);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong. Please try again.');
    }
    setLoading(false);
  };

  const handleKeyDown = (e) => { if (e.key === 'Enter') handleSubmit(); };
  const switchMode = () => { setIsRegister(v => !v); setError(''); setSuccess(''); };

  const inputBase = {
    width: '100%',
    padding: '12px 14px',
    background: '#F2DDBC',
    border: '1px solid #DDD0B3',
    borderRadius: '9px',
    fontSize: '14px',
    color: '#102C26',
    outline: 'none',
    marginBottom: '12px',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s, box-shadow 0.15s',
  };

  const focusInput  = (e) => {
    e.target.style.borderColor = '#102C26';
    e.target.style.boxShadow   = '0 0 0 3px rgba(16,44,38,0.12)';
  };
  const blurInput   = (e) => {
    e.target.style.borderColor = '#DDD0B3';
    e.target.style.boxShadow   = 'none';
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 20px',
      position: 'relative',
      zIndex: 1,
    }}>

      {/* Wordmark */}
      <div style={{ textAlign: 'center', marginBottom: '36px', animation: 'fadeUp 0.5s ease both' }}>
        <div style={{
          fontFamily: "'Montserrat', sans-serif",
          fontSize: '38px',
          fontWeight: '800',
          letterSpacing: '-1px',
          color: '#102C26',
          lineHeight: 1,
          marginBottom: '8px',
        }}>
          Campus<span style={{ color: '#4A6A5E' }}>Car</span>GO
        </div>
        <div style={{
          fontSize: '11px',
          letterSpacing: '3px',
          color: '#8AAA9E',
          textTransform: 'uppercase',
          fontWeight: '600',
        }}>
          SCT · Pappanamcode
        </div>
      </div>

      {/* Card */}
      <div style={{
        width: '100%',
        maxWidth: '420px',
        background: '#FEFAF3',
        border: '1px solid #DDD0B3',
        borderRadius: '18px',
        padding: '28px',
        boxShadow: '0 8px 32px rgba(16,44,38,0.10), 0 2px 8px rgba(0,0,0,0.04)',
        animation: 'fadeUp 0.5s 0.08s ease both',
      }}>

        {/* Tab switcher */}
        <div style={{
          display: 'flex',
          gap: '4px',
          background: '#F2DDBC',
          border: '1px solid #DDD0B3',
          borderRadius: '10px',
          padding: '4px',
          marginBottom: '24px',
        }}>
          {[
            { label: 'Sign in',        value: false },
            { label: 'Create account', value: true  },
          ].map(t => (
            <button
              key={String(t.value)}
              onClick={() => { setIsRegister(t.value); setError(''); setSuccess(''); }}
              style={{
                flex: 1,
                padding: '9px 12px',
                border: 'none',
                borderRadius: '7px',
                background: isRegister === t.value ? '#102C26' : 'transparent',
                color: isRegister === t.value ? '#F7E7CE' : '#8AAA9E',
                fontWeight: isRegister === t.value ? '700' : '500',
                fontSize: '13px',
                cursor: 'pointer',
                transition: 'all 0.2s',
                fontFamily: "'Montserrat', sans-serif",
              }}
            >{t.label}</button>
          ))}
        </div>

        {/* Fields */}
        {isRegister && (
          <input
            type="text" value={name} onChange={e => setName(e.target.value)}
            onKeyDown={handleKeyDown} placeholder="Full name"
            style={inputBase} onFocus={focusInput} onBlur={blurInput}
          />
        )}

        <input
          type="text" value={regNumber} onChange={e => setRegNumber(e.target.value)}
          onKeyDown={handleKeyDown} placeholder="Registration number"
          style={inputBase} onFocus={focusInput} onBlur={blurInput}
        />

        <input
          type="password" value={password} onChange={e => setPassword(e.target.value)}
          onKeyDown={handleKeyDown} placeholder="Password"
          style={{ ...inputBase, marginBottom: isRegister ? '16px' : '8px' }}
          onFocus={focusInput} onBlur={blurInput}
        />

        {/* Role selector */}
        {isRegister && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', color: '#8AAA9E', textTransform: 'uppercase', letterSpacing: '1.5px', fontWeight: '600', marginBottom: '10px' }}>
              I am a
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {[
                { value: 'passenger', icon: '🧑‍🎓', label: 'Passenger' },
                { value: 'driver',    icon: '🚗',    label: 'Driver'    },
              ].map(r => (
                <button key={r.value} onClick={() => setRole(r.value)} style={{
                  padding: '12px 10px',
                  border: `1px solid ${role === r.value ? '#102C26' : '#DDD0B3'}`,
                  borderRadius: '9px',
                  background: role === r.value ? '#D4E8E2' : '#F2DDBC',
                  color: role === r.value ? '#102C26' : '#8AAA9E',
                  fontWeight: '600',
                  fontSize: '13px',
                  cursor: 'pointer',
                  transition: 'all 0.18s',
                  boxShadow: role === r.value ? '0 0 0 1px #102C26' : 'none',
                  fontFamily: "'Montserrat', sans-serif",
                }}>
                  <div style={{ fontSize: '20px', marginBottom: '4px' }}>{r.icon}</div>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Error / success */}
        {error && (
          <div style={{
            padding: '10px 14px', borderRadius: '8px', marginBottom: '14px',
            background: 'rgba(220,38,38,0.08)',
            border: '1px solid rgba(220,38,38,0.2)',
            color: '#dc2626', fontSize: '13px',
          }}>{error}</div>
        )}
        {success && (
          <div style={{
            padding: '10px 14px', borderRadius: '8px', marginBottom: '14px',
            background: 'rgba(22,163,74,0.08)',
            border: '1px solid rgba(22,163,74,0.2)',
            color: '#16a34a', fontSize: '13px',
          }}>{success}</div>
        )}

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={loading}
          style={{
            width: '100%',
            padding: '13px',
            background: loading ? 'rgba(16,44,38,0.4)' : '#102C26',
            color: '#F7E7CE',
            border: 'none',
            borderRadius: '9px',
            fontSize: '14px',
            fontWeight: '700',
            cursor: loading ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s',
            boxShadow: loading ? 'none' : '0 4px 16px rgba(16,44,38,0.25)',
            letterSpacing: '0.2px',
            fontFamily: "'Montserrat', sans-serif",
          }}
          onMouseEnter={e => { if (!loading) e.target.style.background = '#0A1E1A'; }}
          onMouseLeave={e => { if (!loading) e.target.style.background = '#102C26'; }}
        >
          {loading ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'}
        </button>

        {/* Switch mode text */}
        <div style={{ textAlign: 'center', marginTop: '18px', fontSize: '13px', color: '#8AAA9E' }}>
          {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button onClick={switchMode} style={{
            background: 'none', border: 'none',
            color: '#102C26', fontWeight: '700',
            fontSize: '13px', cursor: 'pointer',
            padding: 0, fontFamily: "'Montserrat', sans-serif",
          }}>
            {isRegister ? 'Sign in' : 'Register'}
          </button>
        </div>
      </div>

      {/* Footer */}
      <div style={{
        marginTop: '28px',
        fontSize: '11px',
        color: '#C4B89A',
        letterSpacing: '0.5px',
        animation: 'fadeIn 0.5s 0.3s ease both',
      }}>
        Ride sharing for SCT students
      </div>
    </div>
  );
}
