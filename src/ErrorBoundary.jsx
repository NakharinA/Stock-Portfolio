import { Component } from "react";

/**
 * Keeps one broken component from blanking the whole dashboard. React unmounts the entire
 * tree when a render throws and nothing catches it, which turns a small mistake -- a stale
 * module after a hot reload, a shape the UI did not expect -- into an empty page with the
 * only explanation in the console.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Still logged: the visible message is for whoever is looking at the screen, the
    // console entry is what a stack trace gets read from.
    console.error("dashboard error:", error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div
        style={{
          background: "#10151C",
          color: "#ECE6D8",
          minHeight: "100%",
          padding: 28,
          fontFamily: "'Noto Sans Thai', sans-serif",
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>หน้านี้แสดงผลไม่สำเร็จ</div>
        <div style={{ fontSize: 13, color: "#8792A0", marginBottom: 16, lineHeight: 1.6 }}>
          ถ้าเพิ่งมีการอัปเดตโค้ด ให้โหลดหน้าใหม่แบบล้างแคชก่อน (Cmd/Ctrl + Shift + R)
        </div>
        <pre
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11.5,
            color: "#C96456",
            whiteSpace: "pre-wrap",
            marginBottom: 16,
          }}
        >
          {String(this.state.error?.message ?? this.state.error)}
        </pre>
        <button
          onClick={() => window.location.reload()}
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
          โหลดหน้าใหม่
        </button>
      </div>
    );
  }
}
