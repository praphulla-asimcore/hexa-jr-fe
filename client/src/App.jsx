import React, { useState } from 'react';
import Logo from './components/Logo.jsx';
import StepIndicator from './components/StepIndicator.jsx';
import Upload from './screens/Upload.jsx';
import GlSelection from './screens/GlSelection.jsx';
import JeReview from './screens/JeReview.jsx';
import Summary from './screens/Summary.jsx';
import './App.css';

export default function App() {
  const [screen, setScreen] = useState('upload');
  const [entities, setEntities] = useState([]);
  const [summary, setSummary] = useState(null);
  const [paymentDate, setPaymentDate] = useState('');
  const [glSelections, setGlSelections] = useState({});
  const [jeData, setJeData] = useState([]);
  const [postResults, setPostResults] = useState({});

  function handleUploadDone({ entities, summary, paymentDate }) {
    setEntities(entities);
    setSummary(summary);
    setPaymentDate(paymentDate);
    setGlSelections({});
    setJeData([]);
    setPostResults({});
    setScreen('gl-selection');
  }

  function handleGlDone({ glSelections, jeData }) {
    setGlSelections(glSelections);
    setJeData(jeData);
    setScreen('review');
  }

  function handlePostDone(results) {
    setPostResults(results);
    setScreen('summary');
  }

  function handleReset() {
    setScreen('upload');
    setEntities([]);
    setSummary(null);
    setPaymentDate('');
    setGlSelections({});
    setJeData([]);
    setPostResults({});
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="app-brand">
            <Logo size={28} />
            <div className="app-brand-divider" />
            <span className="app-brand-name">CSI Journal Poster</span>
          </div>
          <StepIndicator current={screen} />
        </div>
      </header>

      <main className="app-main">
        {screen === 'upload' && (
          <Upload onDone={handleUploadDone} />
        )}
        {screen === 'gl-selection' && (
          <GlSelection
            entities={entities}
            paymentDate={paymentDate}
            onBack={() => setScreen('upload')}
            onDone={handleGlDone}
          />
        )}
        {screen === 'review' && (
          <JeReview
            jeData={jeData}
            paymentDate={paymentDate}
            onBack={() => setScreen('gl-selection')}
            onDone={handlePostDone}
          />
        )}
        {screen === 'summary' && (
          <Summary
            postResults={postResults}
            paymentDate={paymentDate}
            onReset={handleReset}
          />
        )}
      </main>
    </div>
  );
}
