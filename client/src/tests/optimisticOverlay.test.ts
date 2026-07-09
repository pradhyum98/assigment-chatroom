/**
 * Optimistic Overlay — hostile selector tests.
 */
import { describe, it, expect } from 'vitest';
import chatReducer, {
  addMessage,
  addOptimisticMutation,
  removeOptimisticMutation,
  selectVisibleMessages,
  type ChatState,
  type Message,
} from '../features/chat/chatSlice';
import type { OptimisticMutation } from '../services/optimisticTypes';

const ACCOUNT = 'acct-1';
const ROOM = 'room-1';
const OTHER_ROOM = 'room-other';

function initialState(): ChatState {
  return {
    messages: [],
    loading: false,
    error: null,
    typingUsers: {},
    optimisticMutations: {},
  };
}

function canonical(overrides: Partial<Message> = {}): Message {
  return {
    messageId: 'msg-1',
    senderId: 'u1',
    senderName: 'Alice',
    roomId: ROOM,
    content: 'hello',
    timestamp: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function sendMutation(overrides: Partial<OptimisticMutation> = {}): OptimisticMutation {
  return {
    mutationId: 'mut-send-1',
    clientMsgId: 'client-1',
    accountId: ACCOUNT,
    roomId: ROOM,
    actionType: 'SEND_MESSAGE',
    createdAt: '2024-01-01T00:01:00.000Z',
    status: 'PENDING',
    payload: {
      senderId: 'u1',
      senderName: 'Alice',
      content: 'optimistic hello',
      timestamp: '2024-01-01T00:01:00.000Z',
      type: 'text',
    },
    ...overrides,
  } as OptimisticMutation;
}

describe('selectVisibleMessages', () => {
  it('returns empty for empty state', () => {
    const state = initialState();
    const result = selectVisibleMessages({ chat: state }, ROOM);
    expect(result).toEqual([]);
  });

  it('returns canonical messages for room', () => {
    let state = initialState();
    state = chatReducer(state, addMessage(canonical()));
    const result = selectVisibleMessages({ chat: state }, ROOM);
    expect(result).toHaveLength(1);
    expect(result[0].messageId).toBe('msg-1');
  });

  // ── optimistic send ──
  it('appends optimistic send mutation as virtual message', () => {
    let state = initialState();
    state = chatReducer(state, addOptimisticMutation(sendMutation()));
    const result = selectVisibleMessages({ chat: state }, ROOM);
    expect(result).toHaveLength(1);
    expect(result[0].isOptimistic).toBe(true);
    expect(result[0].content).toBe('optimistic hello');
  });

  it('does not duplicate when canonical replaces optimistic send', () => {
    let state = initialState();
    state = chatReducer(state, addOptimisticMutation(sendMutation()));
    // Canonical event arrives with matching clientMsgId
    state = chatReducer(state, addMessage(canonical({ messageId: 'server-1', clientMsgId: 'client-1' })));
    const result = selectVisibleMessages({ chat: state }, ROOM);
    // Should see only the canonical message, not a duplicate optimistic
    expect(result).toHaveLength(1);
    expect(result[0].messageId).toBe('server-1');
    expect(result[0].isOptimistic).toBeUndefined();
  });

  // ── optimistic edit ──
  it('overlays edit mutation on canonical message', () => {
    let state = initialState();
    state = chatReducer(state, addMessage(canonical()));
    state = chatReducer(state, addOptimisticMutation({
      mutationId: 'mut-edit-1',
      accountId: ACCOUNT,
      roomId: ROOM,
      actionType: 'EDIT_MESSAGE',
      createdAt: '2024-01-01T00:02:00.000Z',
      status: 'PENDING',
      payload: { messageId: 'msg-1', content: 'edited content', editedAt: '2024-01-01T00:02:00.000Z' },
    } as OptimisticMutation));
    const result = selectVisibleMessages({ chat: state }, ROOM);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('edited content');
    expect(result[0].isEdited).toBe(true);
  });

  // ── optimistic delete ──
  it('hides message with delete-for-everyone overlay', () => {
    let state = initialState();
    state = chatReducer(state, addMessage(canonical()));
    state = chatReducer(state, addOptimisticMutation({
      mutationId: 'mut-del-1',
      accountId: ACCOUNT,
      roomId: ROOM,
      actionType: 'DELETE_MESSAGE',
      createdAt: '2024-01-01T00:03:00.000Z',
      status: 'PENDING',
      payload: { messageId: 'msg-1', deletedForEveryone: true },
    } as OptimisticMutation));
    const result = selectVisibleMessages({ chat: state }, ROOM);
    expect(result).toHaveLength(1);
    expect(result[0].deletedForEveryone).toBe(true);
    expect(result[0].content).toBe('');
  });

  it('removes message with delete-for-me overlay', () => {
    let state = initialState();
    state = chatReducer(state, addMessage(canonical()));
    state = chatReducer(state, addOptimisticMutation({
      mutationId: 'mut-del-2',
      accountId: ACCOUNT,
      roomId: ROOM,
      actionType: 'DELETE_MESSAGE',
      createdAt: '2024-01-01T00:03:00.000Z',
      status: 'PENDING',
      payload: { messageId: 'msg-1', deletedForEveryone: false },
    } as OptimisticMutation));
    const result = selectVisibleMessages({ chat: state }, ROOM);
    expect(result).toHaveLength(0);
  });

  // ── reaction overlay ──
  it('adds reaction overlay', () => {
    let state = initialState();
    state = chatReducer(state, addMessage(canonical({ reactions: [] })));
    state = chatReducer(state, addOptimisticMutation({
      mutationId: 'mut-react-1',
      accountId: ACCOUNT,
      roomId: ROOM,
      actionType: 'ADD_REACTION',
      createdAt: '2024-01-01T00:04:00.000Z',
      status: 'PENDING',
      payload: { messageId: 'msg-1', emoji: '👍', userId: 'u1' },
    } as OptimisticMutation));
    const result = selectVisibleMessages({ chat: state }, ROOM);
    expect(result[0].reactions).toHaveLength(1);
    expect(result[0].reactions![0].emoji).toBe('👍');
  });

  it('removes reaction overlay', () => {
    let state = initialState();
    state = chatReducer(state, addMessage(canonical({
      reactions: [{ emoji: '👍', userId: 'u1' }]
    })));
    state = chatReducer(state, addOptimisticMutation({
      mutationId: 'mut-unreact-1',
      accountId: ACCOUNT,
      roomId: ROOM,
      actionType: 'REMOVE_REACTION',
      createdAt: '2024-01-01T00:05:00.000Z',
      status: 'PENDING',
      payload: { messageId: 'msg-1', emoji: '👍', userId: 'u1' },
    } as OptimisticMutation));
    const result = selectVisibleMessages({ chat: state }, ROOM);
    expect(result[0].reactions).toHaveLength(0);
  });

  // ── quarantined/rejected mutations not rendered ──
  it('does NOT render quarantined mutations', () => {
    let state = initialState();
    state = chatReducer(state, addOptimisticMutation(sendMutation({ status: 'QUARANTINED' })));
    const result = selectVisibleMessages({ chat: state }, ROOM);
    expect(result).toHaveLength(0);
  });

  it('does NOT render permanently-rejected mutations', () => {
    let state = initialState();
    state = chatReducer(state, addOptimisticMutation(sendMutation({ status: 'PERMANENTLY_REJECTED' })));
    const result = selectVisibleMessages({ chat: state }, ROOM);
    expect(result).toHaveLength(0);
  });

  // ── room isolation ──
  it('isolates mutations by room', () => {
    let state = initialState();
    state = chatReducer(state, addOptimisticMutation(sendMutation({ roomId: OTHER_ROOM })));
    const result = selectVisibleMessages({ chat: state }, ROOM);
    expect(result).toHaveLength(0);
  });

  // ── account isolation ──
  it('isolates mutations by account', () => {
    let state = initialState();
    state = chatReducer(state, addOptimisticMutation(sendMutation({ accountId: 'other-acct' })));
    const result = selectVisibleMessages({ chat: state }, ROOM, ACCOUNT);
    expect(result).toHaveLength(0);
  });

  // ── stable deterministic ordering ──
  it('sorts by timestamp then messageId for tie-breaking', () => {
    let state = initialState();
    state = chatReducer(state, addMessage(canonical({ messageId: 'msg-b', timestamp: '2024-01-01T00:00:01.000Z' })));
    state = chatReducer(state, addMessage(canonical({ messageId: 'msg-a', timestamp: '2024-01-01T00:00:01.000Z' })));
    state = chatReducer(state, addMessage(canonical({ messageId: 'msg-c', timestamp: '2024-01-01T00:00:00.000Z' })));
    const result = selectVisibleMessages({ chat: state }, ROOM);
    expect(result.map(m => m.messageId)).toEqual(['msg-c', 'msg-a', 'msg-b']);
  });

  // ── multiple mutations on same message ──
  it('handles multiple mutations on the same canonical message', () => {
    let state = initialState();
    state = chatReducer(state, addMessage(canonical({ reactions: [] })));
    // Edit + add reaction
    state = chatReducer(state, addOptimisticMutation({
      mutationId: 'mut-edit-x',
      accountId: ACCOUNT,
      roomId: ROOM,
      actionType: 'EDIT_MESSAGE',
      createdAt: '2024-01-01T00:06:00.000Z',
      status: 'PENDING',
      payload: { messageId: 'msg-1', content: 'edited!', editedAt: '2024-01-01T00:06:00.000Z' },
    } as OptimisticMutation));
    state = chatReducer(state, addOptimisticMutation({
      mutationId: 'mut-react-x',
      accountId: ACCOUNT,
      roomId: ROOM,
      actionType: 'ADD_REACTION',
      createdAt: '2024-01-01T00:07:00.000Z',
      status: 'PENDING',
      payload: { messageId: 'msg-1', emoji: '🔥', userId: 'u1' },
    } as OptimisticMutation));
    const result = selectVisibleMessages({ chat: state }, ROOM);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('edited!');
    expect(result[0].reactions).toHaveLength(1);
  });

  // ── removeOptimisticMutation clears overlay ──
  it('removeOptimisticMutation clears entry from overlay', () => {
    let state = initialState();
    state = chatReducer(state, addOptimisticMutation(sendMutation()));
    expect(Object.keys(state.optimisticMutations)).toHaveLength(1);
    state = chatReducer(state, removeOptimisticMutation('client-1'));
    expect(Object.keys(state.optimisticMutations)).toHaveLength(0);
    const result = selectVisibleMessages({ chat: state }, ROOM);
    expect(result).toHaveLength(0);
  });

  // ── duplicate clientMsgId ──
  it('handles duplicate clientMsgId gracefully (latest wins in map)', () => {
    let state = initialState();
    state = chatReducer(state, addOptimisticMutation(sendMutation({ 
      mutationId: 'mut-dup-1',
      clientMsgId: 'same-key',
      payload: { senderId: 'u1', senderName: 'A', content: 'first', timestamp: '2024-01-01T00:00:00.000Z', type: 'text' as const },
    })));
    state = chatReducer(state, addOptimisticMutation(sendMutation({ 
      mutationId: 'mut-dup-2',
      clientMsgId: 'same-key',
      payload: { senderId: 'u1', senderName: 'A', content: 'second', timestamp: '2024-01-01T00:00:01.000Z', type: 'text' as const },
    })));
    // Map keyed by clientMsgId — second overwrites first
    expect(Object.keys(state.optimisticMutations)).toHaveLength(1);
    const result = selectVisibleMessages({ chat: state }, ROOM);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('second');
  });
});
