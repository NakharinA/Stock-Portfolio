import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth";

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  // Rendering the login page while the token is still being checked would flash a sign-in
  // screen at someone who is already signed in, so nothing is decided until it resolves.
  if (loading) {
    return <div style={{ color: "#8792A0", padding: 24, fontFamily: "'Noto Sans Thai', sans-serif" }}>กำลังตรวจสอบสิทธิ์...</div>;
  }

  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  return children;
}
