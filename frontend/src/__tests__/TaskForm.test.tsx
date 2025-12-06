import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { TaskForm } from '../features/crawler/TaskForm';
import { useCrawlerStore } from '../features/crawler/useCrawlerStore';

// Mock Zustand store
vi.mock('../features/crawler/useCrawlerStore', () => ({
  useCrawlerStore: vi.fn(),
}));

describe('TaskForm Component', () => {
  const mockStore = {
    activeTab: 'profile' as const,
    input: '',
    limit: 50,
    scrapeLikes: false,
    scrapeMode: 'puppeteer' as const,
    autoRotateSessions: true,
    enableDeepSearch: false,
    parallelChunks: 1,
    enableProxy: false,
    startDate: '',
    endDate: '',
    redditStrategy: 'auto',
    isScraping: false,
    antiDetectionLevel: 'high' as const,
    setActiveTab: vi.fn(),
    setInput: vi.fn(),
    setLimit: vi.fn(),
    setScrapeLikes: vi.fn(),
    setScrapeMode: vi.fn(),
    setAutoRotateSessions: vi.fn(),
    setEnableDeepSearch: vi.fn(),
    setParallelChunks: vi.fn(),
    setEnableProxy: vi.fn(),
    setStartDate: vi.fn(),
    setEndDate: vi.fn(),
    setRedditStrategy: vi.fn(),
    setAntiDetectionLevel: vi.fn(),
    canSubmit: vi.fn().mockReturnValue(false),
  };

  const defaultProps = {
    onSubmit: vi.fn(),
    onStop: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock to default state
    (useCrawlerStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...mockStore,
      canSubmit: vi.fn().mockReturnValue(false),
    });
  });

  it('renders correctly with default state', () => {
    render(<TaskForm {...defaultProps} />);
    expect(screen.getByText('Data Extraction')).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/elonmusk or https:\/\/x\.com\/elonmusk/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /begin extraction/i })).toBeDisabled();
  });

  it('handles input changes', async () => {
    const setInput = vi.fn();
    (useCrawlerStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...mockStore,
      setInput,
    });

    render(<TaskForm {...defaultProps} />);

    const input = screen.getByPlaceholderText(/elonmusk or https:\/\/x\.com\/elonmusk/i);
    await userEvent.type(input, 'testuser');

    expect(setInput).toHaveBeenCalled();
  });

  it('enables submit button when canSubmit returns true', () => {
    (useCrawlerStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...mockStore,
      canSubmit: vi.fn().mockReturnValue(true),
    });

    render(<TaskForm {...defaultProps} />);
    expect(screen.getByRole('button', { name: /begin extraction/i })).toBeEnabled();
  });

  it('calls onSubmit when submit button is clicked', async () => {
    const onSubmit = vi.fn();
    (useCrawlerStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...mockStore,
      canSubmit: vi.fn().mockReturnValue(true),
    });

    render(<TaskForm onSubmit={onSubmit} onStop={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /begin extraction/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('shows stop button when isScraping is true', () => {
    (useCrawlerStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...mockStore,
      isScraping: true,
    });

    render(<TaskForm {...defaultProps} />);
    expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument();
  });

  it('switches tabs correctly via store', async () => {
    const setActiveTab = vi.fn();
    (useCrawlerStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...mockStore,
      setActiveTab,
    });

    render(<TaskForm {...defaultProps} />);

    // Click the Search tab button (it has "Search" text inside)
    const searchTab = screen.getByText('Search').closest('button');
    expect(searchTab).toBeTruthy();
    await userEvent.click(searchTab!);

    expect(setActiveTab).toHaveBeenCalledWith('search');
  });

  it('shows Tweet Limit label for profile tab', () => {
    render(<TaskForm {...defaultProps} />);
    expect(screen.getByText('Tweet Limit')).toBeInTheDocument();
  });

  it('displays extraction mode options for profile tab', () => {
    // Profile tab should show extraction mode options
    (useCrawlerStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...mockStore,
      activeTab: 'profile',
    });

    render(<TaskForm {...defaultProps} />);
    expect(screen.getByText('GraphQL')).toBeInTheDocument();
    expect(screen.getByText('Puppeteer')).toBeInTheDocument();
    expect(screen.getByText('Mixed')).toBeInTheDocument();
  });
});
