import { useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useWallet } from "../lib/wallet";
import { useNetworkStore, type Network } from "../lib/networkStore";

const NAV = [
  { to: "/", label: "Dashboard" },
  { to: "/invoices", label: "Invoices" },
  { to: "/property", label: "Property" },
  { to: "/carbon", label: "Carbon" },
  { to: "/kyc", label: "KYC" },
  { to: "/attestations", label: "Attestations" },
  { to: "/admin", label: "Admin" },
  { to: "/deploy", label: "Deploy" },
  { to: "/docs", label: "Docs" },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { address, connected, connect, disconnect } = useWallet();
  const { network, setNetwork } = useNetworkStore();
  const [menuOpen, setMenuOpen] = useState(false);

  const closeMenu = () => setMenuOpen(false);

  const handleDrawerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      closeMenu();
      (document.querySelector(".hamburger") as HTMLElement)?.focus();
    }
    if (e.key === "Tab") {
      const drawer = document.getElementById("mobile-nav");
      if (!drawer) return;
      const focusable = drawer.querySelectorAll<HTMLElement>(
        'a:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const handleNetworkChange = (newNetwork: Network) => {
    setNetwork(newNetwork);
    // Clear wallet connection state
    disconnect();
    // Reload the page to reinitialize with new network
    window.location.reload();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <header style={styles.header}>
        <div className="container" style={styles.headerInner}>
          <Link to="/" style={styles.brand} onClick={closeMenu}>
            <img src="/veritoken.svg" alt="" width={34} height={34} style={{ borderRadius: 9 }} />
            <span style={styles.brandName}>Veritoken</span>
            <span className="badge badge-accent" style={{ marginLeft: "0.4rem" }}>
              {network === "mainnet" ? "Mainnet" : "Testnet"}
            </span>
          </Link>

          <nav style={styles.nav} className="nav-desktop" aria-label="Main navigation">
            {NAV.map((n) => {
              const active = n.to === "/" ? pathname === "/" : pathname.startsWith(n.to);
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  style={{ ...styles.navLink, ...(active ? styles.navLinkActive : {}) }}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>

          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }} role="group" aria-label="Network selection">
              <button
                onClick={() => handleNetworkChange("testnet")}
                className={network === "testnet" ? "btn-accent" : "btn-ghost"}
                style={{ fontSize: "0.75rem", padding: "0.4rem 0.8rem" }}
                aria-pressed={network === "testnet"}
              >
                Testnet
              </button>
              <button
                onClick={() => handleNetworkChange("mainnet")}
                className={network === "mainnet" ? "btn-accent" : "btn-ghost"}
                style={{ fontSize: "0.75rem", padding: "0.4rem 0.8rem" }}
                aria-pressed={network === "mainnet"}
              >
                Mainnet
              </button>
            </div>
            {connected ? (
              <div style={styles.walletInfo}>
                <span style={styles.address} className="mono">
                  <span className="dot" />
                  {address?.slice(0, 4)}…{address?.slice(-4)}
                </span>
                <button onClick={disconnect} className="btn-ghost" style={styles.disconnectBtn}>
                  Disconnect
                </button>
              </div>
            ) : (
              <button onClick={connect}>Connect Wallet</button>
            )}
            <button
              className="hamburger"
              onClick={() => setMenuOpen(!menuOpen)}
              style={styles.hamburger}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
            >
              <span style={styles.hamburgerLine} />
              <span style={styles.hamburgerLine} />
              <span style={styles.hamburgerLine} />
            </button>
          </div>
        </div>
      </header>

      {menuOpen &&       <div style={styles.overlay} onClick={closeMenu} aria-hidden="true" />}

      <nav
        id="mobile-nav"
        aria-label="Mobile navigation"
        aria-hidden={!menuOpen}
        onKeyDown={handleDrawerKeyDown}
        style={{ ...styles.drawer, ...(menuOpen ? styles.drawerOpen : {}) }}
      >
        {NAV.map((n) => {
          const active = n.to === "/" ? pathname === "/" : pathname.startsWith(n.to);
          return (
            <Link
              key={n.to}
              to={n.to}
              onClick={closeMenu}
              style={{ ...styles.drawerLink, ...(active ? styles.drawerLinkActive : {}) }}
            >
              {n.label}
            </Link>
          );
        })}
      </nav>

      <main style={styles.main}>
        <div className="container animate-in" key={pathname}>
          {children}
        </div>
      </main>

      <footer style={styles.footer}>
        <div
          className="container"
          style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "0.75rem" }}
        >
          <span className="muted" style={{ fontSize: "0.8rem" }}>
            © {new Date().getFullYear()} Veritoken · RWA Tokenization Kit for Stellar
          </span>
          <span className="muted" style={{ fontSize: "0.8rem" }}>
            Compliance enforced at the protocol level
          </span>
        </div>
      </footer>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: {
    position: "sticky",
    top: 0,
    zIndex: 50,
    borderBottom: "1px solid var(--border)",
    background: "rgba(6, 9, 18, 0.72)",
    backdropFilter: "blur(16px)",
    WebkitBackdropFilter: "blur(16px)",
  },
  headerInner: {
    display: "flex",
    alignItems: "center",
    gap: "1.5rem",
    height: 66,
  },
  brand: { display: "flex", alignItems: "center", gap: "0.6rem" },
  brandName: { fontWeight: 800, fontSize: "1.1rem", letterSpacing: "-0.02em" },
  nav: {
    display: "flex",
    gap: "0.35rem",
    flex: 1,
    justifyContent: "center",
  },
  navLink: {
    color: "var(--text-muted)",
    fontWeight: 500,
    fontSize: "0.875rem",
    padding: "0.45rem 0.85rem",
    borderRadius: 999,
    transition: "color 0.18s ease, background 0.18s ease",
  },
  navLinkActive: {
    color: "var(--text)",
    background: "var(--surface-2)",
  },
  walletInfo: { display: "flex", alignItems: "center", gap: "0.6rem" },
  address: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.5rem",
    fontSize: "0.78rem",
    background: "var(--surface-2)",
    padding: "0.4rem 0.7rem",
    borderRadius: 999,
    border: "1px solid var(--border)",
  },
  disconnectBtn: { fontSize: "0.75rem", padding: "0.4rem 0.8rem" },
  hamburger: {
    display: "flex",
    flexDirection: "column",
    gap: "0.35rem",
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: "0.25rem",
  },
  hamburgerLine: {
    width: "1.5rem",
    height: "0.2rem",
    background: "var(--text)",
    borderRadius: "0.1rem",
    transition: "all 0.3s ease",
  },
  overlay: {
    display: "none",
    position: "fixed",
    top: 66,
    left: 0,
    right: 0,
    bottom: 0,
    background: "rgba(0, 0, 0, 0.5)",
    zIndex: 39,
  },
  drawer: {
    position: "fixed",
    top: 66,
    left: 0,
    width: "100%",
    background: "var(--surface)",
    borderBottom: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
    padding: "1rem",
    zIndex: 40,
    transform: "translateY(-100%)",
    transition: "transform 0.3s ease",
  },
  drawerOpen: {
    transform: "translateY(0)",
  },
  drawerLink: {
    color: "var(--text)",
    fontWeight: 500,
    fontSize: "1rem",
    padding: "0.75rem 1rem",
    borderRadius: "0.5rem",
    textDecoration: "none",
    transition: "background 0.18s ease",
  },
  drawerLinkActive: {
    background: "var(--surface-2)",
  },
  main: { flex: 1, padding: "2.5rem 0 3.5rem" },
  footer: {
    borderTop: "1px solid var(--border)",
    padding: "1.5rem 0",
  },
};

// Responsive behaviour is handled via media queries in index.css.
