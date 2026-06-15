import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Products = lazy(() => import('./pages/Products'));
const ProductDetail = lazy(() => import('./pages/ProductDetail'));
const Export = lazy(() => import('./pages/Export'));
const Import = lazy(() => import('./pages/Import'));
const Settings = lazy(() => import('./pages/Settings'));
const AiEditor = lazy(() => import('./pages/AiEditor'));
const Compare = lazy(() => import('./pages/Compare'));
const AiCopywriting = lazy(() => import('./pages/AiCopywriting'));
const Monitor = lazy(() => import('./pages/Monitor'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 30_000 },
  },
});

function PageSkeleton() {
  return (
    <div className="page-skeleton">
      <div className="skeleton skeleton-line" />
      <div className="skeleton skeleton-line-sm" />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Suspense fallback={<PageSkeleton />}>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<Dashboard />} />
                <Route path="products" element={<Products />} />
                <Route path="product/:id" element={<ProductDetail />} />
                <Route path="export" element={<Export />} />
                <Route path="import" element={<Import />} />
                <Route path="settings" element={<Settings />} />
                <Route path="ai-editor" element={<AiEditor />} />
                <Route path="compare" element={<Compare />} />
                <Route path="ai-copywriting" element={<AiCopywriting />} />
                <Route path="monitor" element={<Monitor />} />
              </Route>
            </Routes>
          </Suspense>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

