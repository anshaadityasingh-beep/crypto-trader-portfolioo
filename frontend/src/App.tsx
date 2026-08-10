import { AuthProvider, useAuth } from './hooks/useAuth';
import { useMarketSocket } from './hooks/useMarketSocket';
import { LoginSignup } from './components/LoginSignup';
import { OrderBook } from './components/OrderBook';
import { TradeFeed } from './components/TradeFeed';
import { PriceChart } from './components/PriceChart';
import { OrderEntryForm } from './components/OrderEntryForm';
import { OpenOrders } from './components/OpenOrders';
import { LogOut, Activity } from 'lucide-react';

const SYMBOL = 'BTC-USD';

function Dashboard() {
  const { logout, balance } = useAuth();
  const { snapshot, trades, userOrders, isConnected } = useMarketSocket(SYMBOL);

  return (
    <div className="app-container">
      <header className="header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Activity color="var(--accent)" size={24} />
          <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>CryptoTrader Pro</h1>
          <span style={{ 
            marginLeft: '12px', 
            fontSize: '11px', 
            padding: '2px 6px', 
            borderRadius: '4px',
            background: isConnected ? 'var(--buy-bg)' : 'var(--sell-bg)',
            color: isConnected ? 'var(--buy)' : 'var(--sell)'
          }}>
            {isConnected ? 'LIVE' : 'RECONNECTING...'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ fontSize: '14px' }}>
            Balance: <span style={{ fontWeight: 600 }}>${balance.toFixed(2)}</span>
          </div>
          <button 
            onClick={logout} 
            style={{ 
              background: 'transparent', 
              padding: '6px', 
              width: 'auto', 
              color: 'var(--text-muted)' 
            }}
            title="Log Out"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>
      
      <main className="main-layout">
        {/* Left Column (Markets) */}
        <div className="left-col">
          <PriceChart trades={trades} />
          <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            <OrderBook snapshot={snapshot} />
            <div style={{ width: '1px', background: 'var(--border)' }}></div>
            <TradeFeed trades={trades} />
          </div>
        </div>

        {/* Right Column (Trading) */}
        <div className="right-col">
          <OrderEntryForm symbol={SYMBOL} />
          <OpenOrders orders={userOrders} />
        </div>
      </main>
    </div>
  );
}

function MainContent() {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <Dashboard /> : <LoginSignup />;
}

function App() {
  return (
    <AuthProvider>
      <MainContent />
    </AuthProvider>
  );
}

export default App;
