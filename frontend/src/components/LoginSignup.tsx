import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { fetchApi } from '../lib/api';

export function LoginSignup() {
  const { login } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    try {
      const endpoint = isLogin ? '/auth/login' : '/auth/signup';
      const data = await fetchApi(endpoint, {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      login(data.token);
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <div className="panel" style={{ width: '320px', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
        <h2 style={{ textAlign: 'center', marginBottom: '24px' }}>
          {isLogin ? 'Welcome Back' : 'Create Account'}
        </h2>
        
        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <label>Email</label>
            <input 
              type="email" 
              required 
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com" 
            />
          </div>
          
          <div className="input-group">
            <label>Password</label>
            <input 
              type="password" 
              required 
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••" 
            />
          </div>

          {error && <div style={{ color: 'var(--sell)', fontSize: '13px', marginBottom: '12px' }}>{error}</div>}

          <button type="submit" style={{ marginTop: '12px' }}>
            {isLogin ? 'Login' : 'Sign Up'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '16px', fontSize: '13px' }}>
          <span style={{ color: 'var(--text-muted)' }}>
            {isLogin ? "Don't have an account? " : "Already have an account? "}
          </span>
          <button 
            type="button" 
            style={{ 
              background: 'none', 
              border: 'none', 
              color: 'var(--accent)', 
              padding: 0, 
              width: 'auto',
              display: 'inline',
              cursor: 'pointer'
            }}
            onClick={() => setIsLogin(!isLogin)}
          >
            {isLogin ? 'Sign up' : 'Log in'}
          </button>
        </div>
      </div>
    </div>
  );
}
