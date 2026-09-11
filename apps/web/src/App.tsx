import { useEffect, useRef } from 'react';
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import RequireAdmin from './components/RequireAdmin';
import RequireAuth, { getReturnTo } from './components/RequireAuth';
import TopBar from './components/TopBar';
import AdminAudit from './routes/admin/AdminAudit';
import AdminDashboard from './routes/admin/AdminDashboard';
import AdminPaymentReviews from './routes/admin/AdminPaymentReviews';
import AdminReports from './routes/admin/AdminReports';
import AdminSlots from './routes/admin/AdminSlots';
import AdminUsers from './routes/admin/AdminUsers';
import ClaimDetailPage from './routes/ClaimDetailPage';
import ClaimsPage from './routes/ClaimsPage';
import Home from './routes/Home';
import Profile from './routes/Profile';
import Sell from './routes/Sell';
import SellDetail from './routes/SellDetail';
import SellNew from './routes/SellNew';
import SlotDetailPage from './routes/SlotDetailPage';
import { useAuth } from './store/auth';

// After a guest is bounced to "/" and then connects, send them back to the
// route they originally asked for (once — then the marker is spent).
function ReturnToHandler() {
  const status = useAuth((s) => s.status);
  const location = useLocation();
  const navigate = useNavigate();
  const done = useRef(false);
  useEffect(() => {
    if (status !== 'authenticated') {
      done.current = false;
      return;
    }
    if (done.current) {
      return;
    }
    const to = getReturnTo(location.state, location.pathname);
    if (to) {
      done.current = true;
      navigate(to, { replace: true });
    }
  }, [status, location, navigate]);
  return null;
}

export default function App() {
  const refresh = useAuth((s) => s.refresh);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-slate-50 text-slate-900">
        <TopBar />
        <ReturnToHandler />
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
          <Route
            path="/profile"
            element={
              <RequireAuth>
                <Profile />
              </RequireAuth>
            }
          />
          <Route
            path="/admin"
            element={
              <RequireAdmin>
                <AdminDashboard />
              </RequireAdmin>
            }
          />
          <Route
            path="/admin/reports"
            element={
              <RequireAdmin>
                <AdminReports />
              </RequireAdmin>
            }
          />
          <Route
            path="/admin/payment-reviews"
            element={
              <RequireAdmin>
                <AdminPaymentReviews />
              </RequireAdmin>
            }
          />
          <Route
            path="/admin/users"
            element={
              <RequireAdmin>
                <AdminUsers />
              </RequireAdmin>
            }
          />
          <Route
            path="/admin/slots"
            element={
              <RequireAdmin>
                <AdminSlots />
              </RequireAdmin>
            }
          />
          <Route
            path="/admin/audit"
            element={
              <RequireAdmin>
                <AdminAudit />
              </RequireAdmin>
            }
          />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
