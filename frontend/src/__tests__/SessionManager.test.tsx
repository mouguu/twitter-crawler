import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, beforeEach, afterEach, expect } from 'vitest';
import { SessionManager } from '../components/SessionManager';

describe('SessionManager Component', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        globalThis.fetch = fetchMock as unknown as typeof fetch;
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('renders empty state when no sessions', async () => {
        fetchMock.mockResolvedValueOnce({
            json: () => Promise.resolve({ success: true, sessions: [] }),
            ok: true
        });

        render(<SessionManager />);

        await waitFor(() => {
            // Updated to match the actual text in the component
            expect(screen.getByText('Sessions')).toBeInTheDocument();
            expect(screen.getByText(/no sessions found/i)).toBeInTheDocument();
        });
    });

    it('renders sessions list', async () => {
        const mockSessions = [
            {
                filename: 'user1.json',
                username: 'user1',
                isValid: true,
                cookieCount: 5
            }
        ];
        fetchMock.mockResolvedValueOnce({
            json: () => Promise.resolve({ success: true, sessions: mockSessions }),
            ok: true
        });

        render(<SessionManager />);

        await waitFor(() => {
            expect(screen.getByText('@user1')).toBeInTheDocument();
            expect(screen.getByText('user1.json')).toBeInTheDocument();
        });
    });

    it('opens upload modal when file is selected', async () => {
        fetchMock.mockResolvedValueOnce({
            json: () => Promise.resolve({ success: true, sessions: [] }),
            ok: true
        });

        render(<SessionManager />);

        // Wait for initial load
        await waitFor(() => {
            expect(screen.getByText(/no sessions found/i)).toBeInTheDocument();
        });

        const file = new File(['{}'], 'cookies.json', { type: 'application/json' });
        
        // Find the hidden file input
        const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
        expect(fileInput).toBeTruthy();

        await userEvent.upload(fileInput, file);

        // The modal should open with "Name Your Session"
        await waitFor(() => {
            expect(screen.getByText('Name Your Session')).toBeInTheDocument();
        });
    });
});
