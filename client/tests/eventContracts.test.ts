import { EventContractRegistry, RoomEventType, UserEventType } from '../src/services/EventContracts';
import { test, expect } from 'vitest';

test('EventContractRegistry covers all backend RoomEventType values', () => {
  const allBackendRoomEventTypes = Object.values(RoomEventType);
  
  for (const type of allBackendRoomEventTypes) {
    const contract = EventContractRegistry[type];
    expect(contract).toBeDefined();
    expect(contract.streamType).toBe('room');
    expect(contract.handlerName).toBeDefined();
    expect(contract.schema).toBeDefined();
  }
});

test('EventContractRegistry covers all backend UserEventType values', () => {
  const allBackendUserEventTypes = Object.values(UserEventType);
  
  for (const type of allBackendUserEventTypes) {
    const contract = EventContractRegistry[type];
    expect(contract).toBeDefined();
    expect(contract.streamType).toBe('user');
    expect(contract.handlerName).toBeDefined();
    expect(contract.schema).toBeDefined();
  }
});
