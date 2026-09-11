import { useEffect } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import RequireAuth from './components/RequireAuth';
import TopBar from './components/TopBar';
import ClaimDetailPage from './routes/ClaimDetailPage';
import ClaimsPage from './routes/ClaimsPage';
import Home from './routes/Home';
import Profile from './routes/Profile';
import Sell from './routes/Sell';
import SellDetail from './routes/SellDetail';
import SellNew from './routes/SellNew';
import SlotDetailPage from './routes/SlotDetailPage';
import { useAuth } from './store/auth';

export default function App() {
  const refresh = useAuth((s) => s.refresh);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-slate-50 text-slate-900">
        <TopBar />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/slot/:slotId" element={<SlotDetailPage />} />
          <Route
            path="/claim/:claimId"
            element={
              <RequireAuth>
                <ClaimDetailPage />
              </RequireAuth>
            }
          />
          <Route
            path="/claims"
            element={
              <RequireAuth>
                <ClaimsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/sell"
            element={
              <RequireAuth>
                <Sell />
              </RequireAuth>
            }
          />
          <Route
            path="/sell/new"
            element={
              <RequireAuth>
                <SellNew />
              </RequireAuth>
            }
          />
          <Route
            path="/sell/:slotId"
            element={
              <RequireAuth>
                <SellDetail />
              </RequireAuth>
            }
          />
          <Route path="/profile" element={<Profile />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
