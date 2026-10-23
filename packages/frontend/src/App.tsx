import { useEffect, useState } from "react";
import { api } from "./api";
import { Chat } from "./components/Chat";
import { Validate } from "./components/Validate";
import { Decisions } from "./components/Decisions";
import type { HealthCheck } from "./types";

type Tab = "chat" | "validate" | "decisions";

function HealthBadge() {
  const [ok, setOk] = useState<boolean | null>(null);
  const [checks, setChecks] = useState<HealthCheck[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api
      .health()
      .then((h) => {
        setOk(h.ok);
        setChecks(h.results);
      })
      .catch(() => setOk(false));
  }, []);

  const label = ok === null ? "checking AWS…" : ok ? "AWS connected" : "AWS issues";
  return (
    <div className="health">
      <button className={`dot ${ok === null ? "pending" : ok ? "up" : "down"}`} onClick={() => setOpen((o) => !o)}>
        ● {label}
      </button>
      {open ? (
        <div className="health-pop">
          {checks.map((c) => (
            <div key={c.name} className={c.ok ? "up" : "down"}>
              {c.ok ? "✅" : "❌"} {c.name} — {c.detail}
            </div>
          ))}
          {!checks.length ? <div className="down">No health data.</div> : null}
        </div>
      ) : null}
    </div>
  );
}

export function App() {
  const [tab, setTab] = useState<Tab>("chat");
  return (
    <div className="app">
      <header>
        <div className="brand">
          ComplianceChat
          <span className="sub">Federal travel &amp; per diem compliance</span>
        </div>
        <HealthBadge />
      </header>
      <nav className="tabs">
        {(["chat", "validate", "decisions"] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {t === "chat" ? "Ask" : t === "validate" ? "Validate claim" : "Decision records"}
          </button>
        ))}
      </nav>
      <main>
        {tab === "chat" ? <Chat /> : tab === "validate" ? <Validate /> : <Decisions />}
      </main>
      <footer>
        Prototype · answers cite ingested GSA/FTR sources · all AWS calls run server-side.
      </footer>
    </div>
  );
}
