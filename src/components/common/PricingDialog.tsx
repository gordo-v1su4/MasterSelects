import { useEffect } from 'react';
import { useAccountStore } from '../../stores/accountStore';
import './authBillingDialogs.css';

interface PricingDialogProps {
  onClose: () => void;
}

const plans = [
  { id: 'free', credits: 0, description: 'Local editor only', featured: false, price: '$0' },
  { id: 'starter', credits: 250, description: 'Hosted AI chat for light usage', featured: false, price: 'Launch price' },
  { id: 'pro', credits: 1000, description: 'Hosted chat plus Kling generation', featured: true, price: 'Main plan' },
  { id: 'studio', credits: 5000, description: 'High-volume credits and priority access', featured: false, price: 'Team plan' },
] as const;

export function PricingDialog({ onClose }: PricingDialogProps) {
  const { error, isLoading, startCheckout } = useAccountStore();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="auth-billing-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="auth-billing-dialog auth-billing-dialog-wide">
        <div className="auth-billing-header">
          <div>
            <div className="auth-billing-kicker">Pricing</div>
            <h2>Choose a plan</h2>
          </div>
          <button className="auth-billing-close" onClick={onClose} type="button">x</button>
        </div>

        <div className="pricing-grid">
          {plans.map((plan) => (
            <article key={plan.id} className={`pricing-card ${plan.featured ? 'featured' : ''}`}>
              <div className="pricing-card-top">
                <div>
                  <h3>{plan.id.toUpperCase()}</h3>
                  <p>{plan.description}</p>
                </div>
                <div className="pricing-price">{plan.price}</div>
              </div>
              <div className="pricing-credits">{plan.credits} monthly credits</div>
              <button
                className="auth-billing-primary pricing-cta"
                disabled={isLoading || plan.id === 'free'}
                onClick={() => startCheckout(plan.id)}
                type="button"
              >
                {plan.id === 'free' ? 'Current plan' : `Select ${plan.id}`}
              </button>
            </article>
          ))}
        </div>

        {error && <div className="auth-billing-error">{error}</div>}
      </div>
    </div>
  );
}
