import { render, screen, waitFor, act } from '@testing-library/react';
import { vi, describe, it, beforeEach, afterEach, expect } from 'vitest';
import { DashboardPanel } from '../components/DashboardPanel';

// Mock the queueClient module at the top level
vi.mock('../utils/queueClient', () => ({
    listJobs: vi.fn().mockResolvedValue([]),
    connectToJobStream: vi.fn().mockReturnValue({
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        close: vi.fn(),
    }),
    cancelJob: vi.fn().mockResolvedValue(undefined),
}));

describe('DashboardPanel Component', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        // Clean up the global function
        delete (window as any).__addJobToPanel;
    });

    it('renders empty state when no jobs', async () => {
        render(<DashboardPanel />);
        
        await waitFor(() => {
            // Updated to match the actual text in the component
            expect(screen.getByText('Active Jobs')).toBeInTheDocument();
            expect(screen.getByText(/no active jobs/i)).toBeInTheDocument();
        });
    });

    it('exposes global addJob function', async () => {
        render(<DashboardPanel />);

        await waitFor(() => {
            const addJob = (window as any).__addJobToPanel;
            expect(addJob).toBeDefined();
            expect(typeof addJob).toBe('function');
        });
    });

    it('renders jobs when added via global method', async () => {
        render(<DashboardPanel />);

        // Wait for the component to expose the global method
        await waitFor(() => {
            expect((window as any).__addJobToPanel).toBeDefined();
        });

        const addJob = (window as any).__addJobToPanel;

        // Add a job using act to handle state updates
        await act(async () => {
            addJob('job-123', 'twitter');
        });

        await waitFor(() => {
            expect(screen.getByText('job-123')).toBeInTheDocument();
        });
    });
});
