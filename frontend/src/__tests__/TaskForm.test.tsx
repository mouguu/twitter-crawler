import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { TaskForm } from '../components/TaskForm';
import type { TabType } from '../types/ui';

describe('TaskForm Component', () => {
    const defaultProps = {
        activeTab: 'profile' as TabType,
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
        canSubmit: false,
        onTabChange: vi.fn(),
        onInputChange: vi.fn(),
        onLimitChange: vi.fn(),
        onScrapeModeChange: vi.fn(),
        onToggleLikes: vi.fn(),
        onToggleAutoRotate: vi.fn(),
        onToggleDeepSearch: vi.fn(),
        onParallelChunksChange: vi.fn(),
        onToggleProxy: vi.fn(),
        onStartDateChange: vi.fn(),
        onEndDateChange: vi.fn(),
        onRedditStrategyChange: vi.fn(),
        onSubmit: vi.fn(),
        onStop: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders correctly with default props', () => {
        render(<TaskForm {...defaultProps} />);
        // Updated to match the actual heading in the component
        expect(screen.getByText('Data Extraction')).toBeInTheDocument();
        // Updated placeholder to match the current UI
        expect(screen.getByPlaceholderText(/elonmusk or https:\/\/x\.com\/elonmusk/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /begin extraction/i })).toBeDisabled();
    });

    it('handles input changes', async () => {
        const onInputChange = vi.fn();
        render(<TaskForm {...defaultProps} onInputChange={onInputChange} />);
        
        const input = screen.getByPlaceholderText(/elonmusk or https:\/\/x\.com\/elonmusk/i);
        await userEvent.type(input, 'testuser');
        
        expect(onInputChange).toHaveBeenCalled();
    });

    it('enables submit button when canSubmit is true', () => {
        render(<TaskForm {...defaultProps} canSubmit={true} />);
        expect(screen.getByRole('button', { name: /begin extraction/i })).toBeEnabled();
    });

    it('calls onSubmit when submit button is clicked', async () => {
        const onSubmit = vi.fn();
        render(<TaskForm {...defaultProps} canSubmit={true} onSubmit={onSubmit} />);
        
        await userEvent.click(screen.getByRole('button', { name: /begin extraction/i }));
        expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it('shows stop button when scraping', () => {
        render(<TaskForm {...defaultProps} isScraping={true} />);
        // In the current UI, the stop button just says "Stop", not "Stop Process"
        expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument();
    });

    it('switches tabs correctly', async () => {
        const onTabChange = vi.fn();
        render(<TaskForm {...defaultProps} onTabChange={onTabChange} />);
        
        const searchTab = screen.getByRole('button', { name: /search/i });
        await userEvent.click(searchTab);
        
        expect(onTabChange).toHaveBeenCalledWith('search');
    });

    it('shows Tweet Limit label for profile tab', () => {
        render(<TaskForm {...defaultProps} />);
        // Updated to match the actual label in the component
        expect(screen.getByText('Tweet Limit')).toBeInTheDocument();
    });

    it('displays extraction mode options for profile tab', () => {
        render(<TaskForm {...defaultProps} />);
        expect(screen.getByText('GraphQL')).toBeInTheDocument();
        expect(screen.getByText('Puppeteer')).toBeInTheDocument();
        expect(screen.getByText('Mixed')).toBeInTheDocument();
    });
});
