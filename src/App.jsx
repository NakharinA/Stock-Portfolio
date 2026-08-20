import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import PortfolioDashboard from "../portfolio_dashboard.jsx";
import { AuthProvider, useAuth } from "./auth";
import ErrorBoundary from "./ErrorBoundary";
import Login from "./routes/Login";
import ProtectedRoute from "./routes/ProtectedRoute";

function LoginRoute() {
  const { user, loading } = useAuth();
  if (loading) return null;
  // Someone who is already signed in has no business on the sign-in page.
  return user ? <Navigate to="/" replace /> : <Login />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <ErrorBoundary>
                  <PortfolioDashboard />
                </ErrorBoundary>
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
