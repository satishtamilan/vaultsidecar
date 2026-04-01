// app/extension-callback/page.tsx
// Shown after Auth0 login redirects back. Background script closes this tab automatically.

export default function ExtensionCallback() {
  return (
    <html>
      <body style={{ fontFamily: "system-ui", textAlign: "center", paddingTop: "80px", background: "#0f1117", color: "#f0f2ff" }}>
        <div style={{ fontSize: "48px", marginBottom: "16px" }}>🔐</div>
        <h2 style={{ marginBottom: "8px" }}>Signed in successfully</h2>
        <p style={{ color: "#8890b5", fontSize: "14px" }}>This tab will close automatically. Open the VaultSidecar extension to continue.</p>
        <script dangerouslySetInnerHTML={{ __html: "setTimeout(() => window.close(), 2000);" }} />
      </body>
    </html>
  );
}
