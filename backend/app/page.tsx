// app/page.tsx
// Simple status page — confirms backend is running and shows auth state.
// Also serves as the entry point for the Auth0 login flow from the extension.

export default function Home() {
  return (
    <html>
      <body
        style={{
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          background: "#0f1117",
          color: "#f0f2ff",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: 0,
        }}
      >
        <div style={{ textAlign: "center", maxWidth: 480, padding: "0 24px" }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>🔐</div>
          <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>VaultSidecar</h1>
          <p style={{ color: "#8890b5", lineHeight: 1.6, marginBottom: 32 }}>
            Auth0 Token Vault powered AI agent backend.
            <br />
            Install the Chrome extension to get started.
          </p>
          <div
            style={{
              background: "#1a1d27",
              border: "1px solid #2e3150",
              borderRadius: 10,
              padding: "16px 20px",
              textAlign: "left",
              fontSize: 13,
              lineHeight: 2,
            }}
          >
            <div>✅ &nbsp;Backend running on <code>localhost:3000</code></div>
            <div>✅ &nbsp;Auth0 SDK initialised</div>
            <div>✅ &nbsp;Token Vault enabled</div>
            <div>✅ &nbsp;LangGraph agent ready</div>
          </div>
          <p style={{ color: "#4a5280", fontSize: 12, marginTop: 24 }}>
            Built for the <strong style={{ color: "#635bff" }}>Authorized to Act</strong> hackathon · Auth0 + Okta
          </p>
        </div>
      </body>
    </html>
  );
}
