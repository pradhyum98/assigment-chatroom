import { describe, it, expect } from 'vitest';
import chatReducer, {
  addMessage,
  addOptimisticMutation,
  removeOptimisticMutation,
  updateOptimisticMutationStatus,
  setOptimisticMutations,
  selectVisibleMessages,
  selectMessageExists,
  type Message,
  type ChatState,
} from '../features/chat/chatSlice';
import type { OptimisticMutation } from '../services/optimisticTypes';

function getInitialState(): ChatState {
  return {
    messages: [],
    loading: false,
    error: null,
    typingUsers: {},
    optimisticMutations: {},
  };
}

const mockMessage: Message = {
  messageId: 'msg-1',
  senderId: 'user-1',
  senderName: 'Alice',
  roomId: 'room-1',
  content: 'Hello',
  timestamp: new Date().toISOString(),
};

const mockSendMutation: OptimisticMutation = {
  mutationId: 'mut-1',
  clientMsgId: 'client-1',
  accountId: 'acct-1',
  roomId: 'room-1',
  actionType: 'SEND_MESSAGE',
  createdAt: new Date().toISOString(),
  status: 'PENDING',
  payload: {
    senderId: 'user-1',
    senderName: 'Alice',
    content: 'Optimistic Hello',
    timestamp: new Date().toISOString(),
    type: 'text',
  },
};

describe('chatSlice — reducers', () => {
  it('addMessage appends a message if it does not exist', () => {
    const state = getInitialState();
    const next = chatReducer(state, addMessage(mockMessage));
    expect(next.messages).toHaveLength(1);
    expect(next.messages[0].messageId).toBe('msg-1');
  });

  it('addMessage does not duplicate existing message', () => {
    let state = getInitialState();
    state = chatReducer(state, addMessage(mockMessage));
    state = chatReducer(state, addMessage(mockMessage));
    expect(state.messages).toHaveLength(1);
  });

  it('addOptimisticMutation adds typed mutation', () => {
    let state = getInitialState();
    state = chatReducer(state, addOptimisticMutation(mockSendMutation));
    expect(Object.keys(state.optimisticMutations)).toHaveLength(1);
    const stored = state.optimisticMutations['client-1'];
    expect(stored.actionType).toBe('SEND_MESSAGE');
    expect(stored.status).toBe('PENDING');
  });

  it('removeOptimisticMutation removes by key', () => {
    let state = getInitialState();
    state = chatReducer(state, addOptimisticMutation(mockSendMutation));
    state = chatReducer(state, removeOptimisticMutation('client-1'));
    expect(Object.keys(state.optimisticMutations)).toHaveLength(0);
  });

  it('updateOptimisticMutationStatus updates status in-place', () => {
    let state = getInitialState();
    state = chatReducer(state, addOptimisticMutation(mockSendMutation));
    state = chatReducer(state, updateOptimisticMutationStatus({ key: 'client-1', status: 'SENDING' }));
    expect(state.optimisticMutations['client-1'].status).toBe('SENDING');
  });

  it('setOptimisticMutations bulk-sets from array', () => {
    let state = getInitialState();
    state = chatReducer(state, setOptimisticMutations([mockSendMutation]));
    expect(Object.keys(state.optimisticMutations)).toHaveLength(1);
    expect(state.optimisticMutations['client-1'].actionType).toBe('SEND_MESSAGE');
  });
});

describe('chatSlice — selectors', () => {
  it('selectVisibleMessages merges canonical + optimistic', () => {
    let state = getInitialState();
    state = chatReducer(state, addMessage(mockMessage));
    state = chatReducer(state, addOptimisticMutation(mockSendMutation));
    const result = selectVisibleMessages({ chat: state }, 'room-1');
    expect(result).toHaveLength(2);
  });

  it('selectMessageExists by messageId, _id, and clientMsgId', () => {
    const messages: Message[] = [
      { ...mockMessage, _id: 'db-1', clientMsgId: 'cid-1' },
    ];
    expect(selectMessageExists(messages, 'db-1')).toBe(true);
    expect(selectMessageExists(messages, 'msg-1')).toBe(true);
    expect(selectMessageExists(messages, 'cid-1')).toBe(true);
    expect(selectMessageExists(messages, 'nonexistent')).toBe(false);
  });
});
