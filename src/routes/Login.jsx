import { LogIn } from "lucide-react";

const COLORS = {
  ink: "#10151C",
  panel: "#1B232E",
  panelLine: "#2A3441",
  paper: "#ECE6D8",
  muted: "#8792A0",
  gold: "#C9A24B",
};

export default function Login() {
  return (
    <div
      style={{
        minHeight: "100%",
        background: COLORS.ink,
        color: COLORS.paper,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Noto Sans Thai', sans-serif",
        padding: 24,
      }}
    >
      <div
        style={{
          background: COLORS.panel,
          border: `1px solid ${COLORS.panelLine}`,
          borderRadius: 12,
          padding: "32px 28px",
          maxWidth: 380,
          width: "100%",
          textAlign: "center",
        }}
      >
        <div className="pf-mono" style={{ color: COLORS.gold, fontSize: 11, letterSpacing: "0.12em", marginBottom: 6 }}>
          PORTFOLIO LEDGER
        </div>
        <div className="pf-display" style={{ fontSize: 24, fontWeight: 600, marginBottom: 10 }}>
          สมุดพอร์ตหุ้น
        </div>
        <div style={{ fontSize: 13, color: COLORS.muted, marginBottom: 22, lineHeight: 1.6 }}>
          เข้าสู่ระบบด้วย Google บัญชีเดียวกับที่รับใบยืนยันการซื้อขายจากโบรก
          ระบบจะขอสิทธิ์อ่านเมลเพื่อดึงใบยืนยันมาลงพอร์ตให้อัตโนมัติ
        </div>

        {/* A plain link, not fetch: this has to be a full navigation so Google can take
            over the tab and hand control back to the API's callback. */}
        <a
          href="/api/auth/google"
          className="pf-btn"
          style={{ textDecoration: "none", justifyContent: "center", width: "100%" }}
        >
          <LogIn size={15} /> เข้าสู่ระบบด้วย Google
        </a>
      </div>
    </div>
  );
}
