import { useCallback } from 'react';
import { useAppSelector } from '../store/hooks';
import { CryptoService } from '../services/cryptoService';

import { secretStore } from '../services/secretStore';

export const useCrypto = () => {
  const { user } = useAppSelector((state) => state.auth);

  const getRoomKey = useCallback(async (roomId: string, encryptedRoomKeys?: Record<string, any>): Promise<CryptoKey | null> => {
    if (!user?._id) return null;
    const raw = encryptedRoomKeys ? encryptedRoomKeys[user._id] : undefined;
    // Server stores { encryptedKey, identityVersion } — extract the string, or use directly if legacy plain string
    const encryptedKeyForMe: string | undefined =
      raw && typeof raw === 'object' ? raw.encryptedKey : raw;
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
