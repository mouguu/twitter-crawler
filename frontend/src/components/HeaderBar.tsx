interface HeaderBarProps {
  apiKey: string;
  apiKeyInput: string;
  onApiKeyInputChange: (value: string) => void;
  onApply: () => void;
}

export function HeaderBar({
  apiKey,
  apiKeyInput,
  onApiKeyInputChange,
  onApply,
}: HeaderBarProps) {
  return (
    <header className="py-8 px-6 md:px-20 border-b border-stone/20">
      <div className="max-w-5xl mx-auto flex justify-between items-center">
        <div>
          <h1 className="text-3xl md:text-4xl mb-2 font-display text-charcoal">
            XRCrawler
          </h1>
          <p className="text-stone text-sm uppercase tracking-widest font-serif">
            Twitter/X & Reddit Scraper
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative flex items-center gap-2">
            <div className="relative">
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => onApiKeyInputChange(e.target.value)}
                placeholder="API Key"
                className="bg-transparent border-b border-stone py-2 focus:outline-none focus:border-rust transition-colors text-sm font-mono text-charcoal placeholder-stone/50 w-44"
              />
              <label className="absolute left-0 -top-5 text-[10px] uppercase tracking-[0.2em] text-stone/50 font-sans">
                API Key
              </label>
            </div>
            <button
              onClick={onApply}
              className="px-3 py-2 border border-charcoal rounded-full text-[10px] uppercase tracking-[0.15em] hover:bg-charcoal hover:text-washi transition-colors"
            >
              Apply
            </button>
            {apiKey && (
              <span className="text-[10px] uppercase tracking-[0.2em] text-moss font-sans">
                Applied
              </span>
            )}
          </div>
          <a
            href="#results"
            className="text-sm uppercase tracking-widest hover:text-rust transition-colors duration-300 font-serif text-charcoal"
          >
            Logs
          </a>
        </div>
      </div>
    </header>
  );
}
