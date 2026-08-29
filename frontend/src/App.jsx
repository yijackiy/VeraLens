import { useState } from "react";
import axios from "axios";

const API_BASE = "http://localhost:8000";

export default function App() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const { data } = await axios.post(`${API_BASE}/analyze`, form);
      if (data.error) {
        setError(data.error);
      } else {
        setResult(data);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 600, margin: "40px auto", fontFamily: "sans-serif" }}>
      <h1>VeraLens</h1>
      <input type="file" accept="image/*" onChange={handleUpload} />
      {loading && <p>Analyzing...</p>}
      {error && <p style={{ color: "crimson" }}>Error: {error}</p>}
      {result && (
        <div>
          <h2>
            {result.final_verdict.toUpperCase()} (
            {(result.final_confidence * 100).toFixed(1)}%)
          </h2>
          <p>{result.explanation}</p>
          {result.heatmap_url && (
            <img
              src={`${API_BASE}${result.heatmap_url}`}
              alt="Grad-CAM heatmap"
              style={{ maxWidth: "100%" }}
            />
          )}
          <ul>
            {result.signals.map((s, i) => (
              <li key={i}>
                {s.name} — severity {s.severity} — {s.note}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
