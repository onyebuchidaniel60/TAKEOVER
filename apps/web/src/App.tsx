import { useEffect } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import TopBar from './components/TopBar';
import Home from './routes/Home';
import Profile from './routes/Profile';
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
          <Route path="/profile" element={<Profile />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
