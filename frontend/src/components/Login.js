import { useState } from 'react';
import axios from 'axios';

const P = {
  bg:        '#F7E7CE',
  card:      '#FEFAF3',
  surface:   '#F2DDBC',
  border:    '#DDD0B3',
  accent:    '#102C26',
  accentMid: '#4A6A5E',
  text:      '#102C26',
  muted:     '#4A6A5E',
  faint:     '#8AAA9E',
};

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
  const switchMode    = () => { setIsRegister(v => !v); setError(''); setSuccess(''); };

  const inputBase = {
    width: '100%',
    padding: '12px 14px',
    background: P.surface,
    border: `1px solid ${P.border}`,
    borderRadius: '9px',
    fontSize: '14px',
    color: P.text,
    outline: 'none',
    marginBottom: '12px',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s, box-shadow 0.15s',
    fontFamily: 'Barlow, sans-serif',
  };

  const focusInput = (e) => {
    e.target.style.borderColor = P.accent;
    e.target.style.boxShadow   = '0 0 0 3px rgba(16,44,38,0.10)';
  };
  const blurInput = (e) => {
    e.target.style.borderColor = P.border;
    e.target.style.boxShadow   = 'none';
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      background: P.bg,
      fontFamily: 'Barlow, sans-serif',
    }}>

      {/* ── Left branding panel ──────────────────────────────────── */}
      <div style={{
        flex: 1,
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '60px 56px',
        minWidth: 0,
      }}>

        {/* Subtle dot texture */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: 'radial-gradient(circle, rgba(16,44,38,0.07) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }} />

        {/* Warm glow */}
        <div style={{
          position: 'absolute', bottom: '-15%', right: '-10%',
          width: '55%', height: '55%',
          background: 'radial-gradient(circle, rgba(16,44,38,0.06) 0%, transparent 70%)',
          borderRadius: '50%', pointerEvents: 'none',
        }} />

        {/* Content */}
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ marginBottom: 36, animation: 'fadeUp 0.5s ease both' }}>
            <div style={{
              fontSize: '50px',
              fontWeight: 800,
              color: P.accent,
              lineHeight: 1.1,
              letterSpacing: '-1.5px',
              marginBottom: 12,
            }}>
              Campus<span style={{ color: P.accentMid }}>Car</span>GO
            </div>
            <div style={{
              fontSize: '11px',
              letterSpacing: '4px',
              color: P.faint,
              textTransform: 'uppercase',
              fontWeight: 600,
            }}>
              SCT · Pappanamcode
            </div>
          </div>

          <p style={{
            fontSize: '15px',
            color: P.muted,
            lineHeight: 1.75,
            maxWidth: 340,
            marginBottom: 40,
            fontWeight: 400,
            animation: 'fadeUp 0.5s 0.08s ease both',
          }}>
            Ride sharing for students heading to campus. Find a driver going your way, or offer a seat on your route.
          </p>

          {/* Simple info row */}
          <div style={{
            display: 'flex', gap: 10, flexWrap: 'wrap',
            animation: 'fadeUp 0.5s 0.14s ease both',
          }}>
            {['For SCT students', 'Driver-rated', 'Free to use'].map((tag, i) => (
              <span key={i} style={{
                padding: '6px 14px',
                background: 'rgba(16,44,38,0.07)',
                border: `1px solid rgba(16,44,38,0.12)`,
                borderRadius: 20,
                fontSize: 12,
                color: P.muted,
                fontWeight: 500,
              }}>{tag}</span>
            ))}
          </div>
        </div>

        {/* Decorative SVG — road/route lines */}
        <svg
          style={{ position: 'absolute', bottom: 0, right: 0, opacity: 0.10, pointerEvents: 'none' }}
          width="360" height="360" viewBox="0 0 360 360" fill="none"
        >
          <line x1="30"  y1="340" x2="180" y2="180" stroke="#102C26" strokeWidth="1.5" strokeDasharray="10 6" />
          <line x1="180" y1="180" x2="320" y2="100" stroke="#102C26" strokeWidth="1.5" strokeDasharray="10 6" />
          <line x1="180" y1="180" x2="290" y2="260" stroke="#4A6A5E" strokeWidth="1.5" strokeDasharray="10 6" />
          <line x1="100" y1="240" x2="180" y2="180" stroke="#102C26" strokeWidth="1.5" strokeDasharray="10 6" />
          <circle cx="30"  cy="340" r="5" fill="#102C26" />
          <circle cx="100" cy="240" r="4" fill="#4A6A5E" />
          <circle cx="180" cy="180" r="7" fill="#102C26" />
          <circle cx="320" cy="100" r="5" fill="#4A6A5E" />
          <circle cx="290" cy="260" r="4" fill="#4A6A5E" />
        </svg>
      </div>

      {/* ── Right form panel ────────────────────────────────────── */}
      <div style={{
        width: 460,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '60px 48px',
        borderLeft: `1px solid ${P.border}`,
        background: P.card,
        position: 'relative',
      }}>
        <div style={{ animation: 'fadeUp 0.5s 0.05s ease both' }}>
          {/* Tab switcher */}
          <div style={{
            display: 'flex', gap: '4px',
            background: P.surface,
            border: `1px solid ${P.border}`,
            borderRadius: '10px',
            padding: '4px',
            marginBottom: '28px',
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
                  background: isRegister === t.value ? P.accent : 'transparent',
                  color: isRegister === t.value ? P.bg : P.faint,
                  fontWeight: isRegister === t.value ? 700 : 500,
                  fontSize: '13px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  fontFamily: 'Barlow, sans-serif',
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
            <div style={{ marginBottom: '20px' }}>
              <div style={{
                fontSize: '11px', color: P.faint,
                textTransform: 'uppercase', letterSpacing: '1.5px',
                fontWeight: 700, marginBottom: '10px',
              }}>
                I am a
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {[
                  { value: 'passenger', icon: '🧑‍🎓', label: 'Passenger' },
                  { value: 'driver',    icon: '🚗',    label: 'Driver'    },
                ].map(r => (
                  <button key={r.value} onClick={() => setRole(r.value)} style={{
                    padding: '12px 10px',
                    border: `1px solid ${role === r.value ? P.accent : P.border}`,
                    borderRadius: '9px',
                    background: role === r.value ? 'rgba(16,44,38,0.08)' : P.surface,
                    color: role === r.value ? P.accent : P.faint,
                    fontWeight: 600,
                    fontSize: '13px',
                    cursor: 'pointer',
                    transition: 'all 0.18s',
                    boxShadow: role === r.value ? '0 0 0 1px rgba(16,44,38,0.15)' : 'none',
                    fontFamily: 'Barlow, sans-serif',
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
              background: 'rgba(220,38,38,0.07)',
              border: '1px solid rgba(220,38,38,0.18)',
              color: '#dc2626', fontSize: '13px',
            }}>{error}</div>
          )}
          {success && (
            <div style={{
              padding: '10px 14px', borderRadius: '8px', marginBottom: '14px',
              background: 'rgba(22,163,74,0.07)',
              border: '1px solid rgba(22,163,74,0.18)',
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
              background: loading ? 'rgba(16,44,38,0.45)' : P.accent,
              color: P.bg,
              border: 'none',
              borderRadius: '9px',
              fontSize: '14px',
              fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s',
              boxShadow: loading ? 'none' : '0 4px 16px rgba(16,44,38,0.22)',
              letterSpacing: '0.2px',
              fontFamily: 'Barlow, sans-serif',
            }}
            onMouseEnter={e => { if (!loading) e.currentTarget.style.background = '#0A1E1A'; }}
            onMouseLeave={e => { if (!loading) e.currentTarget.style.background = P.accent; }}
          >
            {loading ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'}
          </button>

          {/* Switch mode */}
          <div style={{ textAlign: 'center', marginTop: '20px', fontSize: '13px', color: P.faint }}>
            {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button onClick={switchMode} style={{
              background: 'none', border: 'none',
              color: P.accent, fontWeight: 700,
              fontSize: '13px', cursor: 'pointer',
              padding: 0, fontFamily: 'Barlow, sans-serif',
            }}>
              {isRegister ? 'Sign in' : 'Register'}
            </button>
          </div>

          <div style={{ marginTop: 32, textAlign: 'center', fontSize: '11px', color: P.faint, letterSpacing: '0.5px' }}>
            Ride sharing for SCT students
          </div>
        </div>
      </div>
    </div>
  );
}
