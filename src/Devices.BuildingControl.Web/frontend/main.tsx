import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './SimulatorApp';
import './simulator.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Simulator root element was not found.');
createRoot(rootElement).render(<App />);
