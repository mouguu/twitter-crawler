import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, ChevronDown, Key, Menu, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface HeaderBarProps {
  apiKey: string;
  apiKeyInput: string;
  onApiKeyInputChange: (value: string) => void;
  onApply: () => void;
}

const navLinks = [
  { label: 'Scrape', href: '#scrape' },
  { label: 'Dashboard', href: '#dashboard' },
  { label: 'Queue', href: '/queue-monitor.html' },
  { label: 'Sessions', href: '#sessions' },
];

export function HeaderBar({ apiKey, apiKeyInput, onApiKeyInputChange, onApply }: HeaderBarProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [apiDropdownOpen, setApiDropdownOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/40">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between h-16 px-6">
          {/* Logo */}
          <div className="flex items-center gap-8">
            <a href="/" className="flex items-center gap-3 group">
              {/* Geometric Logo Mark */}
              {/* Image Logo */}
              <img src="/icon.png" alt="XRCrawler Logo" className="w-8 h-8 object-contain" />
              <span className="text-xl font-semibold tracking-tight">XRCrawler</span>
            </a>

            {/* Desktop Navigation */}
            <nav className="hidden md:flex items-center gap-1">
              {navLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-lg hover:bg-muted"
                >
                  {link.label}
                </a>
              ))}
            </nav>
          </div>

          {/* Right Side */}
          <div className="flex items-center gap-3">
            {/* API Key Dropdown */}
            <div className="relative hidden sm:block">
              <button
                onClick={() => setApiDropdownOpen(!apiDropdownOpen)}
                className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-border/50 hover:border-border transition-colors"
              >
                <Key className="w-4 h-4 text-muted-foreground" />
                <span className="text-muted-foreground">
                  {apiKey ? 'API Connected' : 'Connect API'}
                </span>
                {apiKey && <span className="w-2 h-2 rounded-full bg-green-500" />}
                <ChevronDown
                  className={`w-4 h-4 text-muted-foreground transition-transform ${apiDropdownOpen ? 'rotate-180' : ''}`}
                />
              </button>

              <AnimatePresence>
                {apiDropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.96 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 top-full mt-2 w-72 p-4 bg-card border border-border rounded-xl shadow-xl"
                  >
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                          API Key
                        </span>
                        {apiKey && (
                          <span className="flex items-center gap-1 text-xs text-green-600">
                            <Check className="w-3 h-3" />
                            Connected
                          </span>
                        )}
                      </div>
                      <Input
                        type="password"
                        value={apiKeyInput}
                        onChange={(e) => onApiKeyInputChange(e.target.value)}
                        placeholder="Enter your API key..."
                        className="font-mono text-sm"
                      />
                      <Button
                        onClick={() => {
                          onApply();
                          setApiDropdownOpen(false);
                        }}
                        className="w-full"
                        size="sm"
                      >
                        Apply Key
                      </Button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Mobile Menu Button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-lg hover:bg-muted transition-colors"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="md:hidden border-t border-border/40 overflow-hidden"
            >
              <nav className="p-4 space-y-1">
                {navLinks.map((link) => (
                  <a
                    key={link.label}
                    href={link.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className="block px-4 py-3 text-lg rounded-lg hover:bg-muted transition-colors"
                  >
                    {link.label}
                  </a>
                ))}
                <div className="pt-4 px-4 space-y-3">
                  <Input
                    type="password"
                    value={apiKeyInput}
                    onChange={(e) => onApiKeyInputChange(e.target.value)}
                    placeholder="API Key..."
                    className="font-mono"
                  />
                  <Button onClick={onApply} className="w-full">
                    Apply Key
                  </Button>
                </div>
              </nav>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </header>
  );
}
