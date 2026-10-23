import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { PerDiemDestination, ValidationResult } from "../types";
import { Citations } from "./Citations";

/** Strip a trailing ", ST" state suffix to get the bare city/destination name. */
function cityOf(d: PerDiemDestination): string {
  if (d.state && d.location.endsWith(`, ${d.state}`)) {
    return d.location.slice(0, -(d.state.length + 2));
  }
  return d.location;
}

interface FormState {
  location: string;
  state: string;
  fiscalYear: number;
  nights: number;
  lodgingCostPerNight: number;
  travelDays: number;
  breakfast: number;
  lunch: number;
  dinner: number;
  actualExpenseAuthorized: boolean;
}

const DEFAULTS: FormState = {
  location: "Washington",
  state: "DC",
  fiscalYear: 2027,
  nights: 3,
  lodgingCostPerNight: 300,
  travelDays: 4,
  breakfast: 1,
  lunch: 0,
  dinner: 0,
  actualExpenseAuthorized: false,
};

export function Validate() {
  const [f, setF] = useState<FormState>(DEFAULTS);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [destinations, setDestinations] = useState<PerDiemDestination[]>([]);
  const [showList, setShowList] = useState(false);
  const acRef = useRef<HTMLLabelElement>(null);

  const [zip, setZip] = useState("");
  const [zipNote, setZipNote] = useState<{ ok: boolean; text: string } | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setF((prev) => ({ ...prev, [key]: value }));
  }
  const num = (v: string) => (v === "" ? 0 : Number(v));

  // Load the destination list for the selected fiscal year (for autocomplete).
  useEffect(() => {
    let cancelled = false;
    api
      .destinations(f.fiscalYear)
      .then((r) => { if (!cancelled) setDestinations(r.items); })
      .catch(() => { if (!cancelled) setDestinations([]); });
    return () => { cancelled = true; };
  }, [f.fiscalYear]);

  // Close the suggestion list when clicking outside.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (acRef.current && !acRef.current.contains(e.target as Node)) setShowList(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Resolve a 5-digit ZIP to its per-diem destination and auto-fill the form.
  useEffect(() => {
    if (!/^\d{5}$/.test(zip)) { setZipNote(null); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await api.zipLookup(f.fiscalYear, zip);
        if (cancelled) return;
        setF((prev) => ({ ...prev, location: r.location, state: r.state ?? "" }));
        setZipNote({
          ok: true,
          text: `${r.location}${r.state ? `, ${r.state}` : ""}${r.county ? ` · ${r.county}` : ""} — lodging $${r.lodging}/night, M&IE $${r.mie ?? "n/a"}/day`,
        });
      } catch {
        if (!cancelled) setZipNote({ ok: false, text: `No per-diem destination found for ZIP ${zip}` });
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [zip, f.fiscalYear]);

  const matches = useMemo(() => {
    const q = f.location.trim().toLowerCase();
    if (!q) return destinations.slice(0, 10);
    return destinations.filter((d) => d.location.toLowerCase().includes(q)).slice(0, 10);
  }, [destinations, f.location]);

  function pick(d: PerDiemDestination) {
    setF((prev) => ({ ...prev, location: cityOf(d), state: d.state ?? "" }));
    setShowList(false);
  }

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const claim = {
        location: f.location.trim(),
        state: f.state.trim() || undefined,
        fiscalYear: f.fiscalYear,
        nights: f.nights,
        lodgingCostPerNight: f.lodgingCostPerNight,
        travelDays: f.travelDays,
        providedMeals: { breakfast: f.breakfast, lunch: f.lunch, dinner: f.dinner },
        actualExpenseAuthorized: f.actualExpenseAuthorized,
      };
      setResult(await api.validate(claim));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="panel">
      <p className="hint">
        Enter the travel details and validate the claim against seeded per-diem rates, the
        M&amp;IE breakdown table, and active controls.
      </p>

      <form className="form" onSubmit={run}>
        <div className="form-grid">
          <label className="field">
            <span>ZIP code (optional — fills destination)</span>
            <input
              value={zip}
              onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))}
              placeholder="e.g. 10001"
              inputMode="numeric"
              maxLength={5}
            />
          </label>
          {zipNote ? (
            <div className={`field field-wide zip-note ${zipNote.ok ? "ok" : "bad"}`}>{zipNote.text}</div>
          ) : (
            <div className="field field-wide" />
          )}
          <label className="field field-wide autocomplete" ref={acRef}>
            <span>Destination (search city — state fills in)</span>
            <input
              value={f.location}
              onChange={(e) => { set("location", e.target.value); setShowList(true); }}
              onFocus={() => setShowList(true)}
              placeholder="Start typing a city, e.g. New York"
              autoComplete="off"
            />
            {showList && matches.length > 0 ? (
              <ul className="autocomplete-list">
                {matches.map((d) => (
                  <li key={d.key}>
                    <button type="button" onMouseDown={(e) => { e.preventDefault(); pick(d); }}>
                      <span className="ac-city">{cityOf(d)}</span>
                      {d.state ? <span className="ac-state">{d.state}</span> : null}
                      <span className="ac-rate">${d.lodging} / ${d.mie}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </label>
          <label className="field">
            <span>State</span>
            <input value={f.state} onChange={(e) => set("state", e.target.value)} placeholder="DC" maxLength={2} />
          </label>
          <label className="field">
            <span>Fiscal year</span>
            <select value={f.fiscalYear} onChange={(e) => set("fiscalYear", Number(e.target.value))}>
              <option value={2027}>FY 2027</option>
              <option value={2025}>FY 2025</option>
              <option value={2026}>FY 2026</option>
            </select>
          </label>

          <label className="field">
            <span>Nights of lodging</span>
            <input type="number" min={0} value={f.nights} onChange={(e) => set("nights", num(e.target.value))} />
          </label>
          <label className="field">
            <span>Lodging cost / night ($)</span>
            <input type="number" min={0} step="0.01" value={f.lodgingCostPerNight} onChange={(e) => set("lodgingCostPerNight", num(e.target.value))} />
          </label>
          <label className="field">
            <span>Total travel days</span>
            <input type="number" min={1} value={f.travelDays} onChange={(e) => set("travelDays", num(e.target.value))} />
          </label>
        </div>

        <fieldset className="meals">
          <legend>Meals provided by govt. / registration (count across trip)</legend>
          <div className="form-grid">
            <label className="field">
              <span>Breakfasts</span>
              <input type="number" min={0} value={f.breakfast} onChange={(e) => set("breakfast", num(e.target.value))} />
            </label>
            <label className="field">
              <span>Lunches</span>
              <input type="number" min={0} value={f.lunch} onChange={(e) => set("lunch", num(e.target.value))} />
            </label>
            <label className="field">
              <span>Dinners</span>
              <input type="number" min={0} value={f.dinner} onChange={(e) => set("dinner", num(e.target.value))} />
            </label>
          </div>
        </fieldset>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={f.actualExpenseAuthorized}
            onChange={(e) => set("actualExpenseAuthorized", e.target.checked)}
          />
          <span>Actual-expense authorized (lodging reimbursable up to 300% of per diem)</span>
        </label>

        <div className="row">
          <button type="submit" disabled={loading || !f.location.trim()}>
            {loading ? "Validating…" : "Validate claim"}
          </button>
          <button type="button" className="chip" onClick={() => { setF(DEFAULTS); setResult(null); setError(null); setZip(""); setZipNote(null); }}>
            Reset
          </button>
        </div>
      </form>

      {error ? <div className="error">Error: {error}</div> : null}

      {result ? (
        <div className="result">
          <div className={`outcome ${result.outcome.toLowerCase()}`}>{result.outcome}</div>
          <table className="computed">
            <tbody>
              {Object.entries(result.computed).map(([k, v]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td>{String(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="findings">
            {result.findings.map((finding) => (
              <li key={finding.controlId} className={`finding ${finding.status}`}>
                <span className="badge">{finding.status}</span>
                <strong>{finding.title}</strong>
                <div>{finding.message}</div>
                <div className="auth">{finding.authority.map((a) => a.label).join(" · ")}</div>
              </li>
            ))}
          </ul>
          <Citations citations={result.citations} />
          <div className="decision-id">decision: {result.decisionId}</div>
        </div>
      ) : null}
    </div>
  );
}
