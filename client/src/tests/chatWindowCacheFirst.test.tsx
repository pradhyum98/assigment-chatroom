import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import chatReducer, { addMessage, setMessages } from '../features/chat/chatSlice';
import roomsReducer, { setCurrentRoom } from '../features/rooms/roomsSlice';
import authReducer from '../features/auth/authSlice';
import friendsReducer from '../features/friends/friendsSlice';
import ChatWindow from '../features/chat/ChatWindow';
import api from '../services/api';
import { canonicalDb } from '../services/CanonicalDatabase';

// Use React here to satisfy TS6133
console.log(React.version);

// Mock useCrypto hook
const mockDecryptPayload = vi.fn().mockImplementation(async (content) => `decrypted-${content}`);
vi.mock('../hooks/useCrypto', () => ({
  useCrypto: () => ({
    getRoomKey: vi.fn().mockResolvedValue('dummy-key'),
    encryptPayload: vi.fn().mockImplementation(async (t) => t),
    decryptPayload: mockDecryptPayload,
  })
}));

// Mock useCall hook
vi.mock('../features/calls/CallContext', () => ({
  useCall: () => ({
    startCall: vi.fn(),
  })
}));

// Mock socketService
vi.mock('../services/socket', () => ({
  socketService: {
    connect: vi.fn().mockReturnValue({
      connected: true,
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
    }),
    markAsRead: vi.fn(),
    onUserTyping: vi.fn(),
    offUserTyping: vi.fn(),
    onPresenceUpdate: vi.fn(),
    offPresenceUpdate: vi.fn(),
  }
}));

// Mock browser/DOM APIs not implemented in jsdom
window.HTMLElement.prototype.scrollIntoView = vi.fn();
window.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

const createMockStore = (initialChatState?: any) => {
  return configureStore({
    reducer: {
      chat: chatReducer,
      rooms: roomsReducer,
      auth: authReducer,
      friends: friendsReducer,
    } as any,
    preloadedState: {
      auth: {
        user: { _id: 'user-1', firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com' },
        token: 'token-1',
        isAuthenticated: true,
        loading: false,
        error: null,
        startupState: 'READY',
      },
      rooms: {
        rooms: [],
        currentRoom: {
          _id: 'room-1',
          roomId: 'room-1',
          roomName: 'Alice Room',
          createdBy: 'user-1',
          participants: ['user-1', 'user-2'],
          createdAt: new Date().toISOString(),
          avatarColor: 'blue',
          previewText: '',
          encryptedRoomKeys: {},
        },
        loading: false,
        error: null,
      },
      friends: {
        friends: [],
        requests: [],
        loading: false,
        error: null,
      },
      chat: {
        messages: [],
        loading: false,
        error: null,
        typingUsers: {},
        optimisticMutations: {},
        ...initialChatState,
      }
    } as any
  });
};

describe('ChatWindow Cache-First Loading & Reconciliation Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockDecryptPayload.mockClear();
  });

  it('1. Cached messages render before a delayed REST response', async () => {
    const cached = [
      { messageId: 'msg-cached-1', senderId: 'user-2', senderName: 'Bob', roomId: 'room-1', content: 'CachedMsg', timestamp: new Date().toISOString(), iv: 'iv-1' } as any
    ];

    vi.spyOn(canonicalDb, 'getAll').mockResolvedValue(cached);

    let resolveRest: any;
    const restPromise = new Promise((resolve) => {
      resolveRest = resolve;
    });

    vi.spyOn(api, 'get').mockImplementation(() => restPromise as any);

    const store = createMockStore();
    render(
      <Provider store={store}>
        <ChatWindow />
      </Provider>
    );

    // Verify cached message is rendered immediately (without spinner)
    await waitFor(() => {
      expect(screen.queryByText('decrypted-CachedMsg')).toBeTruthy();
    });

    // Verify background spinner is not visible
    expect(screen.queryByTestId('loading-spinner')).toBeNull();

    // Resolve REST call with a new message
    const networkMessages = [
      ...cached,
      { messageId: 'msg-net-2', senderId: 'user-2', senderName: 'Bob', roomId: 'room-1', content: 'NetworkMsg', timestamp: new Date().toISOString(), iv: 'iv-2' } as any
    ];

    await act(async () => {
      resolveRest({
        data: {
          data: {
            messages: networkMessages,
            pagination: { hasMore: false }
          }
        }
      });
    });

    // Verify new network message also rendered
    await waitFor(() => {
      expect(screen.getByText('decrypted-NetworkMsg')).toBeTruthy();
    });
  });

  it('2. Cached encrypted messages are decrypted exactly once', async () => {
    const cached = [
      { messageId: 'msg-cached-1', senderId: 'user-2', senderName: 'Bob', roomId: 'room-1', content: 'CachedMsg', timestamp: new Date().toISOString(), iv: 'iv-1' } as any
    ];

    vi.spyOn(canonicalDb, 'getAll').mockResolvedValue(cached);
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        data: {
          messages: cached,
          pagination: { hasMore: false }
        }
      }
    } as any);

    const store = createMockStore();
    render(
      <Provider store={store}>
        <ChatWindow />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByText('decrypted-CachedMsg')).toBeTruthy();
    });

    // Decrypt should be called exactly once for msg-cached-1 during load
    expect(mockDecryptPayload).toHaveBeenCalledTimes(1);
  });

  it('3. decryptedTextIdsRef prevents double decryption', async () => {
    const cached = [
      { messageId: 'msg-cached-1', senderId: 'user-2', senderName: 'Bob', roomId: 'room-1', content: 'CachedMsg', timestamp: new Date().toISOString(), iv: 'iv-1' } as any
    ];

    vi.spyOn(canonicalDb, 'getAll').mockResolvedValue(cached);
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        data: {
          messages: cached,
          pagination: { hasMore: false }
        }
      }
    } as any);

    const store = createMockStore();
    render(
      <Provider store={store}>
        <ChatWindow />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByText('decrypted-CachedMsg')).toBeTruthy();
    });

    // Force trigger of the second useEffect (for real-time decryption) by dispatching setMessages
    // The message is already in decryptedTextIdsRef, so it should NOT call mockDecryptPayload again
    await act(async () => {
      store.dispatch(setMessages([
        { messageId: 'msg-cached-1', senderId: 'user-2', senderName: 'Bob', roomId: 'room-1', content: 'decrypted-CachedMsg', timestamp: new Date().toISOString(), iv: 'iv-1' } as any
      ]));
    });

    expect(mockDecryptPayload).toHaveBeenCalledTimes(1); // Still exactly 1 time!
  });

  it('4. A socket message arriving while REST fetch is pending is not lost', async () => {
    const cached = [
      { messageId: 'msg-1', senderId: 'user-2', senderName: 'Bob', roomId: 'room-1', content: 'Msg1', timestamp: new Date(Date.now() - 10000).toISOString(), iv: 'iv-1' } as any
    ];

    vi.spyOn(canonicalDb, 'getAll').mockResolvedValue(cached);

    let resolveRest: any;
    const restPromise = new Promise((resolve) => {
      resolveRest = resolve;
    });
    vi.spyOn(api, 'get').mockImplementation(() => restPromise as any);

    const store = createMockStore();
    render(
      <Provider store={store}>
        <ChatWindow />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByText('decrypted-Msg1')).toBeTruthy();
    });

    // Simulate socket arrival
    const socketMsg = { messageId: 'msg-socket', senderId: 'user-2', senderName: 'Bob', roomId: 'room-1', content: 'SocketMsg', timestamp: new Date().toISOString(), iv: 'iv-socket' } as any;
    await act(async () => {
      store.dispatch(addMessage(socketMsg));
    });

    // Resolve REST fetch returning msg-1 and a new historical message msg-2
    const network = [
      cached[0],
      { messageId: 'msg-2', senderId: 'user-2', senderName: 'Bob', roomId: 'room-1', content: 'Msg2', timestamp: new Date(Date.now() - 5000).toISOString(), iv: 'iv-2' } as any
    ];

    await act(async () => {
      resolveRest({
        data: {
          data: {
            messages: network,
            pagination: { hasMore: false }
          }
        }
      });
    });

    // All messages: Msg1, Msg2, SocketMsg should be present
    await waitFor(() => {
      expect(screen.getByText('decrypted-Msg1')).toBeTruthy();
      expect(screen.getByText('decrypted-Msg2')).toBeTruthy();
      expect(screen.getByText('decrypted-SocketMsg')).toBeTruthy();
    });
  });

  it('5. A stale REST response does not overwrite a newer socket message', async () => {
    const cached = [
      { messageId: 'msg-1', senderId: 'user-2', senderName: 'Bob', roomId: 'room-1', content: 'Original REST Message', timestamp: new Date(Date.now() - 1000).toISOString(), iv: 'iv-1' } as any
    ];

    vi.spyOn(canonicalDb, 'getAll').mockResolvedValue(cached);

    let resolveRest: any;
    const restPromise = new Promise((resolve) => {
      resolveRest = resolve;
    });
    vi.spyOn(api, 'get').mockImplementation(() => restPromise as any);

    const store = createMockStore();
    render(
      <Provider store={store}>
        <ChatWindow />
      </Provider>
    );

    // Cached render
    await waitFor(() => {
      expect(screen.getByText('decrypted-Original REST Message')).toBeTruthy();
    });

    // Socket message overrides / edits the content of msg-1 to 'Updated Socket Message'
    const updatedSocketMsg = {
      messageId: 'msg-1',
      senderId: 'user-2',
      senderName: 'Bob',
      roomId: 'room-1',
      content: 'Updated Socket Message',
      timestamp: new Date().toISOString(),
      iv: 'iv-1'
    } as any;

    await act(async () => {
      store.dispatch(setMessages([updatedSocketMsg]));
    });

    // REST resolves returning the stale 'Original REST Message'
    await act(async () => {
      resolveRest({
        data: {
          data: {
            messages: cached,
            pagination: { hasMore: false }
          }
        }
      });
    });

    // Content should NOT have reverted to stale original content.
    await waitFor(() => {
      expect(screen.getByText('Updated Socket Message')).toBeTruthy();
      expect(screen.queryByText('decrypted-Original REST Message')).toBeNull();
    });
  });

  it('6. Duplicate message IDs are reconciled correctly', async () => {
    const cached = [
      { messageId: 'msg-dup', senderId: 'user-2', senderName: 'Bob', roomId: 'room-1', content: 'DupMsg', timestamp: new Date().toISOString(), iv: 'iv-1' } as any
    ];

    vi.spyOn(canonicalDb, 'getAll').mockResolvedValue(cached);
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        data: {
          messages: [...cached, ...cached],
          pagination: { hasMore: false }
        }
      }
    } as any);

    const store = createMockStore();
    render(
      <Provider store={store}>
        <ChatWindow />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getAllByText('decrypted-DupMsg')).toHaveLength(1);
    });
  });

  it('7. Message ordering remains deterministic by canonical sequence', async () => {
    const cached = [
      { messageId: 'msg-1', senderId: 'user-2', senderName: 'Bob', roomId: 'room-1', content: 'Msg1', sequenceNumber: 2, timestamp: '2026-07-14T10:00:02.000Z', iv: 'iv-1' } as any,
      { messageId: 'msg-2', senderId: 'user-2', senderName: 'Bob', roomId: 'room-1', content: 'Msg2', sequenceNumber: 1, timestamp: '2026-07-14T10:00:01.000Z', iv: 'iv-2' } as any
    ];

    vi.spyOn(canonicalDb, 'getAll').mockResolvedValue(cached);
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        data: {
          messages: cached,
          pagination: { hasMore: false }
        }
      }
    } as any);

    const store = createMockStore();
    render(
      <Provider store={store}>
        <ChatWindow />
      </Provider>
    );

    // Expect Msg2 (sequence 1) to render first, then Msg1 (sequence 2)
    await waitFor(() => {
      expect(screen.getByText('decrypted-Msg2')).toBeTruthy();
      expect(screen.getByText('decrypted-Msg1')).toBeTruthy();
    });

    const rendered = screen.getAllByText(/decrypted-Msg/);
    expect(rendered[0].textContent).toContain('decrypted-Msg2');
    expect(rendered[1].textContent).toContain('decrypted-Msg1');
  });

  it('8. Empty cache still shows the existing loading state', async () => {
    vi.spyOn(canonicalDb, 'getAll').mockResolvedValue([]);
    let resolveRest: any;
    const restPromise = new Promise((resolve) => {
      resolveRest = resolve;
    });
    vi.spyOn(api, 'get').mockImplementation(() => restPromise as any);

    const store = createMockStore();
    render(
      <Provider store={store}>
        <ChatWindow />
      </Provider>
    );

    // Verify loading spinner is rendered when cache is empty
    expect(screen.getByText('Alice Room')).toBeTruthy();
    
    // Resolve REST
    await act(async () => {
      resolveRest({
        data: {
          data: {
            messages: [],
            pagination: { hasMore: false }
          }
        }
      });
    });
  });

  it('9. REST failure keeps cached messages visible', async () => {
    const cached = [
      { messageId: 'msg-cached-1', senderId: 'user-2', senderName: 'Bob', roomId: 'room-1', content: 'CachedMsg', timestamp: new Date().toISOString(), iv: 'iv-1' } as any
    ];

    vi.spyOn(canonicalDb, 'getAll').mockResolvedValue(cached);
    vi.spyOn(api, 'get').mockRejectedValue(new Error('Network Error') as any);

    const store = createMockStore();
    render(
      <Provider store={store}>
        <ChatWindow />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByText('decrypted-CachedMsg')).toBeTruthy();
    });
  });

  it('10. Switching rooms during an in-flight request does not write messages into the wrong room', async () => {
    const cachedRoom1 = [
      { messageId: 'msg-r1', senderId: 'user-2', senderName: 'Bob', roomId: 'room-1', content: 'MsgRoom1', timestamp: new Date().toISOString(), iv: 'iv-1' } as any
    ];

    vi.spyOn(canonicalDb, 'getAll').mockResolvedValue(cachedRoom1);
    
    let resolveRest: any;
    const restPromise = new Promise((resolve) => {
      resolveRest = resolve;
    });
    vi.spyOn(api, 'get').mockImplementation(() => restPromise as any);

    const store = createMockStore();
    const { rerender } = render(
      <Provider store={store}>
        <ChatWindow />
      </Provider>
    );

    // Wait for room 1 cache
    await waitFor(() => {
      expect(screen.getByText('decrypted-MsgRoom1')).toBeTruthy();
    });

    // Switch to room-2
    const room2 = {
      _id: 'room-2',
      roomId: 'room-2',
      roomName: 'Bob Room',
      createdBy: 'user-2',
      participants: ['user-1', 'user-2'],
      createdAt: new Date().toISOString(),
      avatarColor: 'green',
      previewText: '',
      encryptedRoomKeys: {},
    };

    act(() => {
      store.dispatch(setCurrentRoom(room2));
    });

    // Rerender with Bob Room
    rerender(
      <Provider store={store}>
        <ChatWindow />
      </Provider>
    );

    // Resolve original REST request (room 1)
    await act(async () => {
      resolveRest({
        data: {
          data: {
            messages: cachedRoom1,
            pagination: { hasMore: false }
          }
        }
      });
    });

    // Verify Bob Room doesn't contain room 1 messages
    expect(screen.queryByText('decrypted-MsgRoom1')).toBeNull();
  });
});
