import { useEffect } from 'react';
import { useAccountStore } from '../../stores/accountStore';
import './authBillingDialogs.css';

interface AccountDialogProps {
  onClose: () => void;
}

export function AccountDialog({ onClose }: AccountDialogProps) {
  const { billingSummary, error, isLoading, logout, openBillingPortal, openPricingDialog } = useAccountStore();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const summary = billingSummary;

  return (
    <div className="auth-billing-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="auth-billing-dialog auth-billing-dialog-wide">
        <div className="auth-billing-header">
          <div>
            <div className="auth-billing-kicker">Account</div>
            <h2>{summary?.user?.displayName || summary?.user?.email || 'Guest'}</h2>
          </div>
          <button className="auth-billing-close" onClick={onClose} type="button">x</button>
        </div>

        <div className="account-panel">
          <div className="account-metrics">
            <div className="account-metric">
              <span>Plan</span>
              <strong>{summary?.plan.label || 'Free'}</strong>
            </div>
            <div className="account-metric">
              <span>Credits</span>
              <strong>{summary?.creditBalance ?? 0}</strong>
            </div>
            <div className="account-metric">
              <span>Hosted AI</span>
              <strong>{summary?.hostedAIEnabled ? 'Enabled' : 'Disabled'}</strong>
            </div>
          </div>

          <div className="account-section">
            <div className="account-section-title">Recent usage</div>
            <div className="account-usage-list">
              {(summary?.usage.byFeature ?? []).slice(0, 5).map((entry) => (
                <div key={entry.feature} className="account-usage-row">
                  <span>{entry.feature}</span>
                  <span>{entry.completedCount} complete, {entry.creditCost} credits</span>
                </div>
              ))}
              {!summary?.usage.byFeature?.length && <div className="account-empty">No usage yet.</div>}
            </div>
          </div>

          <div className="account-actions">
            <button className="auth-billing-primary" disabled={isLoading} onClick={() => openBillingPortal()} type="button">
              Manage billing
            </button>
            <button className="auth-billing-secondary" disabled={isLoading} onClick={() => openPricingDialog()} type="button">
              Upgrade plan
            </button>
            <button className="auth-billing-ghost" disabled={isLoading} onClick={() => logout()} type="button">
              Sign out
            </button>
          </div>

          {error && <div className="auth-billing-error">{error}</div>}
        </div>
      </div>
    </div>
  );
}
