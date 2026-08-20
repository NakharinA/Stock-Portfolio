const COLORS = {
  ink: "#10151C",
  panel: "#1B232E",
  panelLine: "#2A3441",
  paper: "#ECE6D8",
  muted: "#8792A0",
  gold: "#C9A24B",
};

// Google's own mark, inlined. The button has to carry this exact logo at these exact
// proportions -- a substituted or recoloured "G" is a branding violation, and a remote
// image would leave the button blank whenever the network is slow.
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

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
      <style>{`
        /* Google's dark-theme sign-in button, to their spec: 40px tall, 4px radius,
           #131314 surface, #8E918F border, #E3E3E3 label in Roboto Medium 14. */
        .g-signin {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          height: 40px;
          padding: 0 16px;
          background: #131314;
          border: 1px solid #8E918F;
          border-radius: 4px;
          color: #E3E3E3;
          font-family: 'Roboto', 'Noto Sans Thai', sans-serif;
          font-size: 14px;
          font-weight: 500;
          letter-spacing: 0.25px;
          text-decoration: none;
          cursor: pointer;
          transition: background 120ms ease, border-color 120ms ease;
        }
        .g-signin:hover { background: #1D1D1E; }
        .g-signin:focus-visible { outline: 2px solid #8AB4F8; outline-offset: 2px; }
        .g-signin:active { background: #262627; }
      `}</style>

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
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", color: COLORS.gold, fontSize: 11, letterSpacing: "0.12em", marginBottom: 6 }}>
          PORTFOLIO LEDGER
        </div>
        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 24, fontWeight: 600, marginBottom: 10 }}>สมุดพอร์ตหุ้น</div>
        <div style={{ fontSize: 13, color: COLORS.muted, marginBottom: 24, lineHeight: 1.6 }}>
          เข้าสู่ระบบด้วย Google บัญชีเดียวกับที่รับใบยืนยันการซื้อขายจากโบรก
          ระบบจะขอสิทธิ์อ่านเมลเพื่อดึงใบยืนยันมาลงพอร์ตให้อัตโนมัติ
        </div>

        {/* A real navigation, not fetch: Google takes over the tab and hands control back
            to the API's callback, which cannot happen inside an XHR. */}
        <a className="g-signin" href="/api/auth/google">
          <GoogleMark />
          ลงชื่อเข้าใช้ด้วย Google
        </a>
      </div>
    </div>
  );
}
