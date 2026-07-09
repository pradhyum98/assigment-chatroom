import { useCallback } from 'react';
import { useAppSelector } from '../store/hooks';
import { CryptoService } from '../services/cryptoService';

import { secretStore } from '../services/secretStore';

export const useCrypto = () => {
  const { user } = useAppSelector((state) => state.auth);

  const getRoomKey = useCallback(async (roomId: string, encryptedRoomKeys?: Record<string, string>): Promise<CryptoKey | null> => {
    if (!user?._id) return null;
    const encryptedKeyForMe = encryptedRoomKeys ? encryptedRoomKeys[user._id] : undefined;
    return await secretStore.getOrUnwrapRoomKey(roomId, encryptedKeyForMe);
  }, [user?._id]);


  const encryptPayload = useCallback(async (text: string, roomKey: CryptoKey) => {
    return await CryptoService.encryptMessage(text, roomKey);
  }, []);

  const decryptPayload = useCallback(async (ciphertext: string, iv: string, roomKey: CryptoKey) => {
    return await CryptoService.decryptMessage(ciphertext, iv, roomKey);
  }, []);

  return { getRoomKey, encryptPayload, decryptPayload };
};
