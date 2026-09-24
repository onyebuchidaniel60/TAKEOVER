import { lazy, Suspense, useEffect, useRef } from 'react';
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary';
import LoadingSkeleton from './components/LoadingSkeleton';
import RequireAdmin from './components/RequireAdmin';
import RequireAuth, { getReturnTo } from './components/RequireAuth';
import BottomNav from './components/BottomNav';
import TopBar from './components/TopBar';
import { useDesktopGate } from './hooks/useDesktopGate';
import { useAuth } from './store/auth';

// Route-level code splitting. Every route is its own chunk, so the
// admin pages (and their heavier tables) never ship in the consumer entry.
// The build output shows one chunk per route file.
const Home = lazy(() => import('./routes/Home'));
const Openings = lazy(() => import('./routes/Openings'));
// Lazy like the routes: desktop visitors are rare, so mobile users never
// download the gate (or the QR renderer).
const DesktopGate = lazy(() => import('./components/DesktopGate'));
const SlotDetailPage = lazy(() => import('./routes/SlotDetailPage'));
const ClaimDetailPage = lazy(() => import('./routes/ClaimDetailPage'));
const ClaimsPage = lazy(() => import('./routes/ClaimsPage'));
const Sell = lazy(() => import('./routes/Sell'));
const SellNew = lazy(() => import('./routes/SellNew'));
const SellDetail = lazy(() => import('./routes/SellDetail'));
const NotificationsPage = lazy(() => import('./routes/NotificationsPage'));
const Profile = lazy(() => import('./routes/Profile'));
const NotFound = lazy(() => import('./routes/NotFound'));
const AdminDashboard = lazy(() => import('./routes/admin/AdminDashboard'));
const AdminReports = lazy(() => import('./routes/admin/AdminReports'));
const AdminPaymentReviews = lazy(() => import('./routes/admin/AdminPaymentReviews'));
const AdminUsers = lazy(() => import('./routes/admin/AdminUsers'));
const AdminSlots = lazy(() => import('./routes/admin/AdminSlots'));
const AdminAudit = lazy(() => import('./routes/admin/AdminAudit'));

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

function RouteFallback() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <LoadingSkeleton rows={2} />
    </main>
  );
}

// Admin routes get their own boundary: an admin-surface crash shows the
// moderation fallback instead of taking down the consumer marketplace.
function AdminSection({ children }: { children: React.ReactNode }) {
  return (
    <RequireAdmin>
      <ErrorBoundary section="Moderation">{children}</ErrorBoundary>
    </RequireAdmin>
  );
}

// The routed app shell. Rendered by App below unless the desktop gate
// takes the whole viewport (Phase 4b correction 7).
function Shell() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-bg font-sans text-text">
        <ErrorBoundary section="TAKEOVER">
          <TopBar />
          <ReturnToHandler />
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/openings" element={<Openings />} />
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
                path="/notifications"
                element={
                  <RequireAuth>
                    <NotificationsPage />
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
                  <AdminSection>
                    <AdminDashboard />
                  </AdminSection>
                }
              />
              <Route
                path="/admin/reports"
                element={
                  <AdminSection>
                    <AdminReports />
                  </AdminSection>
                }
              />
              <Route
                path="/admin/payment-reviews"
                element={
                  <AdminSection>
                    <AdminPaymentReviews />
                  </AdminSection>
                }
              />
              <Route
                path="/admin/users"
                element={
                  <AdminSection>
                    <AdminUsers />
                  </AdminSection>
                }
              />
              <Route
                path="/admin/slots"
                element={
                  <AdminSection>
                    <AdminSlots />
                  </AdminSection>
                }
              />
              <Route
                path="/admin/audit"
                element={
                  <AdminSection>
                    <AdminAudit />
                  </AdminSection>
                }
              />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
          {/*
            Pill-nav clearance (chrome, not screen content): the fixed nav
            overlays page bottoms, so the shell reserves room for it here —
            once — instead of every screen padding itself.
          */}
          <div aria-hidden="true" className="h-24 pb-[env(safe-area-inset-bottom)]" />
          <BottomNav />
        </ErrorBoundary>
      </div>
    </BrowserRouter>
  );
}

export default function App() {
  const refresh = useAuth((s) => s.refresh);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const gate = useDesktopGate();
  if (gate !== 'in-app') {
    return (
      <div className="min-h-screen bg-bg font-sans text-text">
        <Suspense fallback={<RouteFallback />}>
          <DesktopGate variant={gate} />
        </Suspense>
      </div>
    );
  }
  return <Shell />;
}
