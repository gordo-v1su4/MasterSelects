import { useEffect, useState } from 'react';
import { useAccountStore } from '../../stores/accountStore';
import './authBillingDialogs.css';

interface AuthDialogProps {
  onClose: () => void;
}

export function AuthDialog({ onClose }: AuthDialogProps) {
  const [email, setEmail] = useState('');
  const [provider, setProvider] = useState<'magic_link' | 'google'>('magic_link');
  const [isClosing, setIsClosing] = useState(false);
  const { error, isLoading, login, notice } = useAccountStore();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleBackdropClick = (event: React.MouseEvent) => {
    if (event.target === event.currentTarget && !isClosing) {
      setIsClosing(true);
      onClose();
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    await login({ email, provider });
  };

  return (
    <div className="auth-billing-backdrop" onClick={handleBackdropClick}>
      <div className="auth-billing-dialog">
        <div className="auth-billing-header">
          <div>
            <div className="auth-billing-kicker">Hosted AI</div>
            <h2>Sign in</h2>
          </div>
          <button className="auth-billing-close" onClick={onClose} type="button">x</button>
        </div>

        <form className="auth-billing-body" onSubmit={handleSubmit}>
          <label className="auth-billing-field">
            <span>Email {provider === 'google' ? '(optional)' : ''}</span>
            <input
              autoComplete="email"
              autoFocus
              placeholder="you@example.com"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>

          <div className="auth-billing-field">
            <span>Provider</span>
            <div className="auth-billing-provider-row">
              <button className={`auth-billing-provider ${provider === 'magic_link' ? 'active' : ''}`} onClick={() => setProvider('magic_link')} type="button">
                Email link
              </button>
              <button className={`auth-billing-provider ${provider === 'google' ? 'active' : ''}`} onClick={() => setProvider('google')} type="button">
                Google
              </button>
            </div>
          </div>

          <button
            className="auth-billing-primary"
            disabled={isLoading || (provider === 'magic_link' && !email.trim())}
            type="submit"
          >
            {isLoading ? 'Signing in...' : provider === 'google' ? 'Continue with Google' : 'Send magic link'}
          </button>

          <p className="auth-billing-note">
            Hosted AI runs through MasterSelects Cloud. Local editing stays unchanged.
          </p>

          {notice && <div className="auth-billing-success">{notice}</div>}
          {error && <div className="auth-billing-error">{error}</div>}
        </form>
      </div>
    </div>
  );
}
