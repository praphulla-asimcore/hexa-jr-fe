import React, { useState, useRef } from 'react';
import './Upload.css';

function fmt(n) {
  return n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function Upload({ onDone }) {
  const [file, setFile] = useState(null);
  const [date, setDate] = useState('');
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const inputRef = useRef();

  function handleFile(f) {
    if (!f) return;
    if (!f.name.match(/\.(xlsx|xls)$/i)) {
      setError('Only .xlsx or .xls files are supported.');
      return;
    }
    setFile(f);
    setError('');
    setResult(null);
  }

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    handleFile(f);
  }

  async function handleUpload() {
    if (!file) { setError('Please select a file.'); return; }
    if (!date) { setError('Please select a payment date.'); return; }
    setLoading(true);
    setError('');
    setResult(null);

    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('date', date);
      const res = await fetch('/api/parse', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Parse failed.');
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleProceed() {
    onDone({ entities: result.entities, summary: result.summary, paymentDate: date });
  }

  const dayOfMonth = date ? new Date(date + 'T00:00:00').getDate() : null;
  const creditLabel = dayOfMonth === 5 ? 'Accrued Salaries Payable' : dayOfMonth === 25 || dayOfMonth === 28 ? 'Salary Payable' : null;

  return (
    <div className="upload-screen fade-in">
      <div className="screen-header">
        <h1 className="screen-title">Upload CSI File</h1>
        <p className="screen-subtitle">Select your Consultant Salary Invoice Excel file and the payment date.</p>
      </div>

      <div className="upload-layout">
        <div className="upload-panel card card-3d">
          <div className="upload-panel-body">
            <div
              className={`dropzone ${dragging ? 'dropzone-drag' : ''} ${file ? 'dropzone-has-file' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current.click()}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls"
                style={{ display: 'none' }}
                onChange={(e) => handleFile(e.target.files[0])}
              />
              <div className="dropzone-icon">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="12" y1="18" x2="12" y2="12" />
                  <polyline points="9 15 12 12 15 15" />
                </svg>
              </div>
              {file ? (
                <div className="dropzone-file-name">
                  <span className="badge badge-success">{file.name}</span>
                  <p className="dropzone-hint">Click to replace</p>
                </div>
              ) : (
                <>
                  <p className="dropzone-text">Drop your .xlsx file here</p>
                  <p className="dropzone-hint">or click to browse</p>
                </>
              )}
            </div>

            <div className="upload-field">
              <label className="label" htmlFor="payment-date">Payment Date</label>
              <input
                id="payment-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
              {creditLabel && (
                <div className="date-hint">
                  Day {dayOfMonth} — credit account will be pre-labelled as <strong>{creditLabel}</strong>
                </div>
              )}
              {date && !creditLabel && (
                <div className="date-hint date-hint-warn">
                  Day {dayOfMonth} — expected 5, 25 or 28. You can still select any GL account.
                </div>
              )}
            </div>

            {error && <div className="error-msg">{error}</div>}

            <button
              className="btn btn-primary btn-lg upload-btn"
              onClick={handleUpload}
              disabled={loading || !file || !date}
            >
              {loading ? <><span className="spinner" />Parsing...</> : 'Parse File'}
            </button>
          </div>
        </div>

        {result && (
          <div className="upload-result fade-in">
            <div className="result-summary card card-3d">
              <div className="result-summary-header">
                <span className="badge badge-success">Parse successful</span>
                <h3>File Summary</h3>
              </div>
              <div className="result-stats">
                <div className="stat">
                  <span className="stat-value">{result.summary.entityCount}</span>
                  <span className="stat-label">Entities</span>
                </div>
                <div className="stat-divider" />
                <div className="stat">
                  <span className="stat-value">{result.summary.consultantCount}</span>
                  <span className="stat-label">Consultants</span>
                </div>
                <div className="stat-divider" />
                <div className="stat">
                  <span className="stat-value">RM {fmt(result.summary.totalCTC)}</span>
                  <span className="stat-label">Total CTC</span>
                </div>
              </div>
            </div>

            <div className="entity-list">
              {result.entities.map((e) => (
                <div key={e.sheetName} className="entity-row card">
                  <div className="entity-row-left">
                    <span className="entity-name">{e.sheetName}</span>
                    <span className="entity-meta">{e.employees.length} consultants</span>
                  </div>
                  <div className="entity-row-right">
                    <span className="amount">RM {fmt(e.totalCTC)}</span>
                    {e.missingColumns.length > 0 && (
                      <span className="badge badge-warning" title={`Missing: ${e.missingColumns.join(', ')}`}>
                        Missing cols
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <button className="btn btn-primary btn-lg proceed-btn" onClick={handleProceed}>
              Continue to GL Account Selection
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
