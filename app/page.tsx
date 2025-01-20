'use client';

import { useState } from 'react';

export default function Home() {
  const [url, setUrl] = useState('https://mediaguru.fi');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url }),
      });

      if (!response.ok) {
        throw new Error('Failed to scrape website');
      }

      const data = await response.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      <main className="flex flex-col gap-8 row-start-2 items-center sm:items-start">
        <h1 className="text-3xl font-bold mb-6">Website Scraper</h1>
        
        <form onSubmit={handleSubmit} className="mb-8">
          <div className="flex gap-4">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Enter website URL"
              required
              className="flex-1 p-2 border rounded"
            />
            <button 
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-blue-300"
            >
              {loading ? 'Scraping...' : 'Scrape'}
            </button>
          </div>
        </form>

        {error && (
          <div className="text-red-500 mb-4">
            {error}
          </div>
        )}

        {result && (
          <div className="space-y-4 w-full max-w-3xl">
            <h2 className="text-xl font-semibold">Results:</h2>
            <div className="bg-gray-50 p-6 rounded-lg shadow-sm">
              <div className="mb-6">
                <h3 className="font-medium text-lg">Basic Information</h3>
                <div className="mt-2 space-y-2">
                  <p><span className="font-medium">Title:</span> {result.title}</p>
                  <p><span className="font-medium">Meta Description:</span> {result.metaDescription || 'No meta description found'}</p>
                </div>
              </div>

              <div className="mb-6">
                <h3 className="font-medium text-lg">WordPress Information</h3>
                <div className="mt-2 space-y-2">
                  <p>
                    <span className="font-medium">WordPress Site:</span>{' '}
                    {result.isWordPress ? '✅ Yes' : '❌ No'}
                  </p>
                  {result.isWordPress && (
                    <>
                      <p><span className="font-medium">WordPress Version:</span> {result.wpVersion}</p>
                      <p><span className="font-medium">PHP Version:</span> {result.phpVersion}</p>
                      <p><span className="font-medium">Up to Date:</span> {result.isWPUpToDate ? '✅ Yes' : '❌ No'}</p>
                      <p><span className="font-medium">Security Plugin:</span> {result.hasSecurityPlugin ? '✅ Detected' : '⚠️ Not detected'}</p>
                    </>
                  )}
                </div>
              </div>

              {result.plugins.length > 0 && (
                <div className="mb-6">
                  <h3 className="font-medium text-lg">Detected Plugins</h3>
                  <ul className="mt-2 space-y-1">
                    {result.plugins.map((plugin: {name: string, version: string}, index: number) => (
                      <li key={index}>
                        {plugin.name} (v{plugin.version})
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
