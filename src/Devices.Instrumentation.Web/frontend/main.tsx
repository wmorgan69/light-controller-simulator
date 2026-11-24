import { createRoot } from 'react-dom/client';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import Dashboard from './Dashboard';
import './base.css';
import './styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Instrumentation dashboard root element is missing');
}

const theme = createTheme({
  typography: { fontFamily: '"DM Sans", "Segoe UI", sans-serif' },
  palette: { background: { default: '#f5f7fb', paper: '#fff' }, text: { primary: '#17243a' } }
});

createRoot(rootElement).render(
  <ThemeProvider theme={theme}><Dashboard /></ThemeProvider>
);
