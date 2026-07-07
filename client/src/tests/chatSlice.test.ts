import { describe, it, expect } from 'vitest';
import chatReducer, { 
  upsertMessage, 
  reconcileConfirmedMessage, 
  addMessage, 
  selectMessageExists,
  type Message 
} from '../features/chat/chatSlice';

describe('chatSlice Reducers & Selectors', () => {
  const getInitialState = () => ({
    messages: [] as Message[],
    loading: false,
    error: null as string | null,
    typingUsers: {},
  });

  it('addMessage appends a message if it does not exist', () => {
    const state = getInitialState();
    const message: Message = {
      messageId: 'msg-1',
      senderId: 'user-1',
      senderName: 'Alice',
      roomId: 'room-1',
      content: 'Hello',
      timestamp: new Date().toISOString(),
    };

    const nextState = chatReducer(state, addMessage(message));
    expect(nextState.messages.length).toBe(1);
    expect(nextState.messages[0].messageId).toBe('msg-1');
  });

  it('upsertMessage appends new message and handles updates for existing messages', () => {
    let state = getInitialState();
    
    const message1: Message = {
      messageId: 'msg-1',
      clientMsgId: 'client-uuid-1',
      senderId: 'user-1',
      senderName: 'Alice',
      roomId: 'room-1',
      content: 'Hello',
      timestamp: new Date().toISOString(),
      isOptimistic: true,
    };

    // Insert new optimistic message
    state = chatReducer(state, upsertMessage(message1));
    expect(state.messages.length).toBe(1);
    expect(state.messages[0].isOptimistic).toBe(true);

    // Upsert confirmed server version (match by clientMsgId)
    const confirmedMessage: Message = {
      _id: 'db-id-1',
      messageId: 'msg-1-final',
      clientMsgId: 'client-uuid-1',
      senderId: 'user-1',
      senderName: 'Alice',
      roomId: 'room-1',
      content: 'Hello (Confirmed)',
      timestamp: new Date().toISOString(),
      isOptimistic: false,
    };

    state = chatReducer(state, upsertMessage(confirmedMessage));
    expect(state.messages.length).toBe(1); // Still 1 message, no duplicates
    expect(state.messages[0]._id).toBe('db-id-1');
    expect(state.messages[0].messageId).toBe('msg-1-final');
    expect(state.messages[0].content).toBe('Hello (Confirmed)');
    expect(state.messages[0].isOptimistic).toBe(false);
  });

  it('reconcileConfirmedMessage correctly updates optimistic placeholder and sets isOptimistic to false', () => {
    let state = getInitialState();
    
    const optimistic: Message = {
      messageId: 'temp-id',
      clientMsgId: 'uuid-999',
      senderId: 'user-1',
      senderName: 'Alice',
      roomId: 'room-1',
      content: 'Sending...',
      timestamp: new Date().toISOString(),
      isOptimistic: true,
    };

    state = chatReducer(state, upsertMessage(optimistic));

    const serverMsg: Message = {
      _id: 'mongo-id-999',
      messageId: 'server-real-id',
      clientMsgId: 'uuid-999',
      senderId: 'user-1',
      senderName: 'Alice',
      roomId: 'room-1',
      content: 'Sent!',
      timestamp: new Date().toISOString(),
    };

    state = chatReducer(state, reconcileConfirmedMessage({ clientMsgId: 'uuid-999', serverMessage: serverMsg }));
    expect(state.messages.length).toBe(1);
    expect(state.messages[0]._id).toBe('mongo-id-999');
    expect(state.messages[0].messageId).toBe('server-real-id');
    expect(state.messages[0].content).toBe('Sent!');
    expect(state.messages[0].isOptimistic).toBe(false);
  });

  it('selectMessageExists returns true if message exists by messageId, _id, or clientMsgId', () => {
    const messages: Message[] = [
      {
        _id: 'db-1',
        messageId: 'msg-1',
        clientMsgId: 'client-1',
        senderId: 'user-1',
        senderName: 'Alice',
        roomId: 'room-1',
        content: 'Hello',
        timestamp: new Date().toISOString(),
      }
    ];

    expect(selectMessageExists(messages, 'db-1')).toBe(true);
    expect(selectMessageExists(messages, 'msg-1')).toBe(true);
    expect(selectMessageExists(messages, 'client-1')).toBe(true);
    expect(selectMessageExists(messages, 'non-existent')).toBe(false);
  });
});
