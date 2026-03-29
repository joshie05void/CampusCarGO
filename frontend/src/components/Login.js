import { useState } from 'react';
import axios from 'axios';

// Yellow palette
const C = {
  bg:          '#fffbeb',
  card:        '#ffffff',
  border:      '#fde68a',
  accent:      '#d97706',
  accentDark:  '#b45309',
  text:        '#1c1917',
  muted:       '#78716c',
  faint:       '#a8a29e',
  successBg:   '#f0faf5',
  successBorder:'#b7e4c7',
  successText: '#15803d',
  errorBg:     '#fdf3f2',
  errorBorder: '#f5c6c2',
  errorText:   '#c0392b',
};

export default function Login({ onLogin }) {
  const [isRegister, setIsRegister] = useState(false);
  const [name, setName] = useState('');
  const [regNumber, setRegNumber] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('passenger');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setError(''); setSuccess('');
    if (!regNumber || !password) { setError('Please fill in all fields.'); return; }
    if (isRegister && !name) { setError('Please enter your name.'); return; }
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

  const inputStyle = {
    width: '100%',
    padding: '10px 12px',
    border: `1px solid ${C.border}`,
    borderRadius: '6px',
    fontSize: '15px',
    outline: 'none',
    background: C.card,
    color: C.text,
    marginBottom: '12px',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s',
  };

  const switchMode = () => { setIsRegister(v => !v); setError(''); setSuccess(''); };

  return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ width: '100%', maxWidth: '400px' }}>

        {/* Brand */}
        <div style={{ marginBottom: '28px' }}>
          <div style={{ fontSize: '22px', fontWeight: '700', color: C.text, letterSpacing: '-0.3px' }}>
            CampusCarGO
          </div>
          <div style={{ color: C.muted, fontSize: '14px', marginTop: '4px' }}>
            Ride sharing for SCT students
          </div>
        </div>

        {/* Card */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '28px' }}>
          <div style={{ fontSize: '17px', fontWeight: '600', marginBottom: '20px', color: C.text }}>
            {isRegister ? 'Create an account' : 'Sign in'}
          </div>

          {isRegister && (
            <input
              type="text" value={name} onChange={e => setName(e.target.value)}
              onKeyDown={handleKeyDown} placeholder="Full name" style={inputStyle}
              onFocus={e => e.target.style.borderColor = C.accent}
              onBlur={e => e.target.style.borderColor = C.border}
            />
          )}

          <input
            type="text" value={regNumber} onChange={e => setRegNumber(e.target.value)}
            onKeyDown={handleKeyDown} placeholder="Registration number" style={inputStyle}
            onFocus={e => e.target.style.borderColor = C.accent}
            onBlur={e => e.target.style.borderColor = C.border}
          />

          <input
            type="password" value={password} onChange={e => setPassword(e.target.value)}
            onKeyDown={handleKeyDown} placeholder="Password"
            style={{ ...inputStyle, marginBottom: isRegister ? '16px' : '4px' }}
            onFocus={e => e.target.style.borderColor = C.accent}
            onBlur={e => e.target.style.borderColor = C.border}
          />

          {isRegister && (
            <div style={{ marginBottom: '4px' }}>
              <div style={{ fontSize: '13px', color: C.muted, marginBottom: '8px' }}>I am a</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {['passenger', 'driver'].map(r => (
                  <button key={r} onClick={() => setRole(r)} style={{
                    padding: '10px',
                    border: `1px solid ${role === r ? C.accent : C.border}`,
                    borderRadius: '6px',
                    background: role === r ? C.accent : C.card,
                    color: role === r ? 'white' : C.muted,
                    fontWeight: '500',
                    fontSize: '14px',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}>
                    {r === 'driver' ? 'Driver' : 'Passenger'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div style={{ fontSize: '13px', color: C.errorText, marginTop: '14px', padding: '10px 12px', background: C.errorBg, borderRadius: '6px', border: `1px solid ${C.errorBorder}` }}>
              {error}
            </div>
          )}

          {success && (
            <div style={{ fontSize: '13px', color: C.successText, marginTop: '14px', padding: '10px 12px', background: C.successBg, borderRadius: '6px', border: `1px solid ${C.successBorder}` }}>
              {success}
            </div>
          )}

          <button onClick={handleSubmit} disabled={loading} style={{
            width: '100%', padding: '11px', marginTop: '16px',
            background: loading ? C.faint : C.accent,
            color: 'white', border: 'none', borderRadius: '6px',
            fontSize: '15px', fontWeight: '600',
            cursor: loading ? 'not-allowed' : 'pointer',
            transition: 'background 0.15s',
          }}>
            {loading ? 'Please wait...' : isRegister ? 'Create account' : 'Sign in'}
          </button>

          <div style={{ textAlign: 'center', marginTop: '18px', fontSize: '13px', color: C.muted }}>
            {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button onClick={switchMode} style={{
              background: 'none', border: 'none', color: C.accent,
              fontWeight: '600', fontSize: '13px', cursor: 'pointer',
              textDecoration: 'underline', padding: 0,
            }}>
              {isRegister ? 'Sign in' : 'Register'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
