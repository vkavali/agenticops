import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { AppProvider } from './store'
import TokenGate from './TokenGate.jsx'

function Root() {
  const [me, setMe] = useState(null);
  return (
    <TokenGate onAuth={setMe}>
      <AppProvider me={me}>
        <App />
      </AppProvider>
    </TokenGate>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
