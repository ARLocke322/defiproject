import { StrictMode, useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'

import ConnectWallet from './components/ConnectWallet';
// import VaultDashboard from './components/VaultDashboard';
import VaultDashboard from './components/VaultDashboard2';
import { VaultManagerProvider } from './context/VaultManagerContext';

function App() {
  return (
    <StrictMode>
      <VaultManagerProvider>
        <div className="App">
          <VaultDashboard/>
        </div>
      </VaultManagerProvider>
    </StrictMode>
  );
}

export default App;
