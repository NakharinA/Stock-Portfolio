import { Navigate, useLocation } from "react-router-dom";
import { getToken } from "../api";
import { useAuth } from "../auth";

export default function ProtectedRoute({ children }) {
  const { user, loading, unreachable, reload } = useAuth();
  const location = useLocation();

  // Rendering the login page while the token is still being checked would flash a sign-in
  // screen at someone who is already signed in, so nothing is decided until it resolves.
  if (loading) {
    return <div style={{ color: "#8792A0", padding: 24, fontFamily: "'Noto Sans Thai', sans-serif" }}>กำลังตรวจสอบสิทธิ์...</div>;
  }

  // A stored token plus an unreachable server is not a signed-out user. Sending them to the
  // login page would lose a perfectly good session over a server restart.
  if (!user && unreachable && getToken()) {
    return (
      <div style={{ color: "#ECE6D8", padding: 24, fontFamily: "'Noto Sans Thai', sans-serif" }}>
        <div style={{ marginBottom: 8 }}>ต่อกับเซิร์ฟเวอร์ไม่ได้ชั่วคราว</div>
        <div style={{ fontSize: 13, color: "#8792A0", marginBottom: 16 }}>ยังไม่ได้ออกจากระบบ — ลองใหม่ได้เลย</div>
        <button
          onClick={reload}
          style={{
            background: "#C9A24B",
            color: "#10151C",
            border: "none",
            borderRadius: 6,
            padding: "9px 16px",
            fontWeight: 600,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          ลองอีกครั้ง
        </button>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  return children;
}
