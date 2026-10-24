import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";
import CryptoScene from "../CryptoScene";
import CurtainIn from "../CurtainIn";
import ThemeToggle from "../ThemeToggle";

export const metadata: Metadata = {
  title: "Escrow desk · AI Escrow",
  description: "Create, accept, and track escrows",
};

export default function EscrowLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <CurtainIn />
      <section className="hero hero-small" style={{ "--intro": "0.2s" } as CSSProperties}>
        <CryptoScene />
        <div className="hero-shade" aria-hidden="true" />
        <header className="site-nav">
          <Link className="brand" href="/" aria-label="AI Escrow home">
            <span className="brand-mark">E</span>
            <span>AI Escrow</span>
          </Link>
          <nav className="nav-links" aria-label="Main navigation">
            <Link href="/">← Home</Link>
            <ThemeToggle />
          </nav>
        </header>
        <div className="hero-content">
          <h1>
            <span className="line"><span className="line-in">Your escrow</span></span>
            <span className="line"><span className="line-in" style={{ "--d": "0.12s" } as CSSProperties}><em>desk.</em></span></span>
          </h1>
          <p className="hero-copy">
            Create a funded escrow, take on a job, or follow one to the end. Every action is signed from your own wallet.
          </p>
        </div>
      </section>

      <div className="app-wrap" id="app">
        <div className="role-guide">
          <div>
            <strong>Client</strong>
            <span>Write the requirement, set the price, and lock the funds.</span>
          </div>
          <div>
            <strong>Freelancer</strong>
            <span>Accept an open job or use your link, then submit your work.</span>
          </div>
          <div>
            <strong>Anyone</strong>
            <span>Paste a contract address to follow its status live.</span>
          </div>
        </div>
        {children}
      </div>
    </>
  );
}
