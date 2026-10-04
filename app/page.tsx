import { BiboLogo } from "@/components/brand/BiboLogo";

export default function Home() {
  return (
    <main className="home">
      <div className="home-content">
        <BiboLogo decorative priority className="home-logo" />
        <p className="eyebrow">Welcome to BIBO Bay</p>
        <h1>BIBO Bay</h1>
        <p className="tagline">Bright minds. Kind hearts. Better humans.</p>
        <p>Come imagine what we can make together.</p>
      </div>
    </main>
  );
}
