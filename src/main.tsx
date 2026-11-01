import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './auth';
import { PopupProvider } from './components/Popup';
import './styles.css';

// A data router (rather than <BrowserRouter>) so pages can use useBlocker to warn about unsaved edits.
const router = createBrowserRouter([
  {
    path: '*',
    element: (
      <PopupProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </PopupProvider>
    ),
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
