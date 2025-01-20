'use client';

import { useState, useRef } from 'react';
// @ts-expect-error (html2pdf doesn't have TypeScript types)
import html2pdf from 'html2pdf.js';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { tomorrow } from 'react-syntax-highlighter/dist/cjs/styles/prism';

// Update the markdown styles
const markdownStyles = {
  h1: "text-2xl font-bold mb-4",
  h2: "text-xl font-semibold mb-3",
  h3: "text-lg font-medium mb-2",
  p: "mb-4",
  ul: "list-disc pl-5 mb-4 space-y-1",
  ol: "list-decimal pl-5 mb-4 space-y-1",
  li: "mb-1",
  strong: "font-semibold",
  em: "italic",
  blockquote: "border-l-4 border-gray-300 pl-4 my-4",
  code: "bg-gray-100 rounded px-1.5 py-0.5 font-mono text-sm text-blue-600",
  pre: "bg-transparent rounded p-0 mb-4 overflow-x-auto",
};

export default function Home() {
  const [url, setUrl] = useState('https://smvt.fi');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setAnalysis(null);
    
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

      // Get AI analysis if it's a WordPress site
      if (data.isWordPress) {
        setAnalyzing(true);
        const analysisResponse = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });

        if (analysisResponse.ok) {
          const analysisData = await analysisResponse.json();
          setAnalysis(analysisData.analysis);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
      setAnalyzing(false);
    }
  };

  const handleExportPDF = () => {
    if (!resultsRef.current) return;
    
    const element = resultsRef.current;
    const opt = {
      margin: 1,
      filename: `wordpress-tarkistus-${new Date().toISOString().split('T')[0]}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' }
    };

    html2pdf().set(opt).from(element).save();
  };

  return (
    <div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      <main className="flex flex-col gap-8 row-start-2 items-center sm:items-start">
        <h1 className="text-3xl font-bold mb-6">WordPress Sivuston Tarkistus</h1>
        
        <form onSubmit={handleSubmit} className="mb-8">
          <div className="flex gap-4">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Syötä verkkosivun osoite"
              required
              className="flex-1 p-2 border rounded"
            />
            <button 
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-blue-300"
            >
              {loading ? 'Tarkistetaan...' : 'Tarkista'}
            </button>
          </div>
        </form>

        {error && (
          <div className="text-red-500 mb-4">
            {error}
          </div>
        )}

        {result && (
          <>
            <h2 className="text-xl font-semibold mb-4">Tulokset:</h2>
            <div ref={resultsRef} className="space-y-4 w-full max-w-3xl">
              <div className="bg-gray-50 p-6 rounded-lg shadow-sm">
                <div className="mb-6">
                  <h3 className="font-medium text-lg">Perustiedot</h3>
                  <div className="mt-2 space-y-2">
                    <p><span className="font-medium">Sivuston otsikko:</span> {result.title}</p>
                    <p><span className="font-medium">Meta kuvaus:</span> {result.metaDescription || 'Ei meta kuvausta'}</p>
                  </div>
                </div>

                <div className="mb-6">
                  <h3 className="font-medium text-lg">WordPress Tiedot</h3>
                  <div className="mt-2 space-y-2">
                    <p>
                      <span className="font-medium">WordPress-sivusto:</span>{' '}
                      {result.isWordPress ? '✅ Kyllä' : '❌ Ei'}
                    </p>
                    {result.isWordPress && (
                      <>
                        <p>
                          <span className="font-medium">WordPress versio:</span>{' '}
                          <span className="flex items-center gap-2 inline-flex">
                            {result.wpVersion}
                            {result.wpVersion !== "Unknown" && (
                              result.isWPUpToDate ? 
                                <span title="Ajan tasalla">✅</span> : 
                                <span title="Päivitys saatavilla" className="text-amber-500">⚠️</span>
                            )}
                          </span>
                        </p>
                        {result.phpVersion !== "Unknown" && (
                          <p><span className="font-medium">PHP versio:</span> {result.phpVersion}</p>
                        )}
                        {result.apacheVersion !== "Unknown" && (
                          <p><span className="font-medium">Apache versio:</span> {result.apacheVersion}</p>
                        )}
                        <p>
                          <span className="font-medium">Tietoturvalisäosa:</span>{' '}
                          {result.hasSecurityPlugin ? '✅ Löytyi' : '⚠️ Ei löytynyt'}
                        </p>
                      </>
                    )}
                  </div>
                </div>

                {result.plugins.length > 0 && (
                  <div className="mb-6">
                    <h3 className="font-medium text-lg">Havaitut lisäosat</h3>
                    <ul className="mt-2 space-y-1">
                      {result.plugins.map((plugin: {
                        name: string;
                        version: string;
                        latestVersion?: string;
                        isUpToDate?: boolean;
                        versionDetected: boolean;
                      }, index: number) => (
                        <li key={index} className="flex items-center gap-2">
                          <span>{plugin.name}</span>
                          <span className="text-gray-600">
                            {plugin.versionDetected ? (
                              <>
                                (v{plugin.version}
                                {plugin.latestVersion && plugin.latestVersion !== plugin.version && 
                                  ` → ${plugin.latestVersion}`}
                                )
                              </>
                            ) : (
                              '(versio ei tiedossa)'
                            )}
                          </span>
                          {plugin.isUpToDate !== undefined && (
                            <span className="ml-2">
                              {plugin.isUpToDate ? '✅ Ajan tasalla' : '⚠️ Päivitys saatavilla'}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {result.isWordPress && result.theme && (
                  <div className="mb-6">
                    <h3 className="font-medium text-lg">Teema</h3>
                    <div className="mt-2 space-y-2">
                      <p>
                        <span className="font-medium">Teeman nimi:</span>{' '}
                        {result.theme.name}
                        {result.theme.isChild && (
                          <span className="text-gray-600 ml-2">
                            (Lapsiteema, pohjana {result.theme.parentTheme})
                          </span>
                        )}
                      </p>
                      {result.theme.version && (
                        <p>
                          <span className="font-medium">Versio:</span>{' '}
                          {result.theme.version}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {analyzing && (
                  <div className="mb-6">
                    <p className="text-blue-600">
                      Analysoidaan turvallisuutta tekoälyn avulla...
                    </p>
                  </div>
                )}

                {analysis && (
                  <div className="mb-6">
                    <h3 className="font-medium text-lg">Tekoälyn turvallisuusanalyysi</h3>
                    <div className="mt-2 p-4 bg-blue-50 rounded-lg prose prose-blue max-w-none">
                      <ReactMarkdown
                        components={{
                          h1: ({node, ...props}) => <h1 className={markdownStyles.h1} {...props} />,
                          h2: ({node, ...props}) => <h2 className={markdownStyles.h2} {...props} />,
                          h3: ({node, ...props}) => <h3 className={markdownStyles.h3} {...props} />,
                          p: ({node, ...props}) => <p className={markdownStyles.p} {...props} />,
                          ul: ({node, ...props}) => <ul className={markdownStyles.ul} {...props} />,
                          ol: ({node, ...props}) => <ol className={markdownStyles.ol} {...props} />,
                          li: ({node, ...props}) => <li className={markdownStyles.li} {...props} />,
                          strong: ({node, ...props}) => <strong className={markdownStyles.strong} {...props} />,
                          em: ({node, ...props}) => <em className={markdownStyles.em} {...props} />,
                          blockquote: ({node, ...props}) => <blockquote className={markdownStyles.blockquote} {...props} />,
                          code: ({node, inline, className, children, ...props}) => {
                            const match = /language-(\w+)/.exec(className || '');
                            return !inline ? (
                              <SyntaxHighlighter
                                style={tomorrow}
                                language={match ? match[1] : 'text'}
                                PreTag="div"
                                className="rounded-md"
                                {...props}
                              >
                                {String(children).replace(/\n$/, '')}
                              </SyntaxHighlighter>
                            ) : (
                              <code className={markdownStyles.code} {...props}>
                                {children}
                              </code>
                            )
                          }
                        }}
                      >
                        {analysis}
                      </ReactMarkdown>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Show export button only after analysis is complete */}
            {analysis && !analyzing && (
              <div className="mt-8 flex justify-center w-full">
                <button
                  onClick={handleExportPDF}
                  className="px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 flex items-center gap-2 shadow-sm"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Vie raportti PDF-tiedostoksi
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
